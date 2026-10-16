import { test, expect, afterAll, setDefaultTimeout } from "bun:test";
import { openPglite } from "dzql/pglite";
import { startServer } from "../src/server";
import { addPerson } from "../src/resources/people/people-api";
import { browser } from "./browser";

// The app as people use it: pick who you are, write a post, see it arrive in another window, change
// it, take it away; someone else sees it with no way to change it; and a link, made for someone new
// in one window, signs them in in another. Postgres is kept in memory (PGlite), so the tests need no
// server. The Bun.WebView rules are at the top of browser.ts.

setDefaultTimeout(60_000); // first browser start can be slow

const pool = await openPglite();
const server = await startServer({ port: 0, dev: false, pool });
const { view, open, waitFor, replaceText, withOtherWindow, close } = browser(() => server.url);
const [ada, bob] = [await addPerson(pool, "Ada"), await addPerson(pool, "Bob")];
await addPerson(pool, "Cy");
await addPerson(pool, "Di");

afterAll(async () => {
  close();
  await server.stop(true);
  await pool.end();
});

/** A socket at the server signed in as `person` (a session cookie, as a link's tap would set): what each request answers. */
async function socketAs(person: number) {
  const url = new URL("/ws", server.url).href.replace("http", "ws");
  const sock = new WebSocket(url, { headers: { cookie: await server.auth.signInAs(person) } } as any);
  await new Promise((ok, no) => ((sock.onopen = ok), (sock.onerror = no)));
  let n = 0;
  const waiting = new Map<number, (msg: any) => void>();
  sock.onmessage = (e) => {
    const msg = JSON.parse(String(e.data));
    waiting.get(msg.id)?.(msg);
    waiting.delete(msg.id);
  };
  const ask = (msg: object) =>
    new Promise<any>((answer) => {
      const id = ++n;
      waiting.set(id, answer);
      sock.send(JSON.stringify({ id, ...msg }));
    });
  return { ask, close: () => sock.close() };
}

/** "Who are you?" in a window: `name`, picked. */
async function pickIn(page: Bun.WebView, until: (expr: string) => Promise<void>, name: string) {
  const button = `[...document.querySelectorAll(".pick button.be")].find((b) => b.textContent === ${JSON.stringify(name)})`;
  await until(button);
  await page.evaluate(`${button}.click()`);
  await until(`document.querySelector(".who")?.textContent.includes(${JSON.stringify(name)})`);
}

const hasTitle = (title: string) => `[...document.querySelectorAll(".posts .title")].some((e) => e.textContent === ${JSON.stringify(title)})`;

test("a post is written through your own posts, never through everyone's; nobody opens another's, or writes as them", async () => {
  const a = await socketAs(ada);
  const b = await socketAs(bob);
  try {
    expect((await a.ask({ action: "call", method: "me" })).result).toEqual({ id: ada, name: "Ada" });
    await a.ask({ action: "open", doc: "posts:" });
    const refused = await a.ask({ action: "delta", doc: "posts:", ops: [{ op: "add", path: "/posts/-", value: { title: "x", content: "y" } }] });
    expect(refused.error.code).toBe(403);

    await a.ask({ action: "open", doc: `mine:${ada}` });
    await a.ask({ action: "delta", doc: `mine:${ada}`, ops: [{ op: "add", path: "/posts/-", value: { title: "Hello", content: "First post" } }] });
    const hers = (await a.ask({ action: "open", doc: `mine:${ada}` })).result.posts;
    expect(Object.values(hers)).toEqual([expect.objectContaining({ author_id: ada, title: "Hello" })]);

    expect((await b.ask({ action: "open", doc: `mine:${ada}` })).error.code).toBe(404);
    await b.ask({ action: "open", doc: `mine:${bob}` });
    await b.ask({ action: "delta", doc: `mine:${bob}`, ops: [{ op: "add", path: "/posts/-", value: { title: "Mine", content: "Bob's", author_id: ada } }] });
    const his = (await b.ask({ action: "open", doc: `mine:${bob}` })).result.posts;
    expect(Object.values(his).every((p: any) => p.author_id === bob)).toBe(true);
  } finally {
    a.close();
    b.close();
  }
});

test("pick who you are, publish, see it arrive in another window, edit it, delete it; another person sees it and cannot change it", async () => {
  await open();
  await pickIn(view, waitFor, "Cy");
  await withOtherWindow(async (other, waitForOther) => {
    await pickIn(other, waitForOther, "Di");

    // Cy publishes: it shows in Cy's window, and arrives in Di's with no reload
    await view.click("input[name=title]");
    await view.type("A shed of our own");
    await view.click("textarea[name=content]");
    await view.type("Who has the key?");
    await view.click("button.publish");
    await waitFor(hasTitle("A shed of our own"));
    await waitForOther(hasTitle("A shed of our own"));

    // Di sees it with no Edit and no Delete; Cy sees both
    expect(await other.evaluate<number>(`document.querySelectorAll(".posts button.edit, .posts button.delete").length`)).toBe(0);
    expect(await view.evaluate<number>(`document.querySelectorAll(".posts button.edit").length`)).toBe(1);

    // Cy edits it in the sheet: both windows show the new title
    await view.click(".posts button.edit");
    await waitFor(`document.querySelector(".sheet input[name=title]")`);
    await replaceText(".sheet input[name=title]", "The key is under the pot");
    await view.click(".sheet button.save");
    await waitFor(`!document.querySelector(".sheet")`);
    await waitForOther(hasTitle("The key is under the pot"));

    // Cy deletes it: gone from both windows
    await view.click(".posts button.delete");
    await waitFor(`!${hasTitle("The key is under the pot")}`);
    await waitForOther(`!${hasTitle("The key is under the pot")}`);
  });
});

test("someone new, and their link: made in one window, it signs them in in another; it keeps them on a reload, and is used once", async () => {
  await open();
  await waitFor(`document.querySelector(".who")`); // Cy, still: the session outlasts a reload
  await view.click("input[name=person]");
  await view.type("Eve");
  await view.click("form.add-person button");
  const eve = `[...document.querySelectorAll(".people li")].find((li) => li.textContent.includes("Eve"))`;
  await waitFor(eve);
  await view.evaluate(`${eve}.querySelector("button.send-link").click()`);
  await waitFor(`document.querySelector(".sent code.link")`);
  const link = await view.evaluate<string>(`document.querySelector(".sent code.link").textContent`);
  expect(link).toStartWith(`${server.url.origin}/#/in/`);

  await withOtherWindow(async (other, waitForOther) => {
    await other.navigate(link);
    await waitForOther(`document.querySelector(".who")?.textContent.includes("Eve")`);
    expect(await other.evaluate<string>("location.hash")).toBe(""); // the token gone from the address
    await other.navigate(`${server.url.origin}/?again`); // a reload: still Eve
    await waitForOther(`document.querySelector(".who")?.textContent.includes("Eve")`);
    await other.click("button.sign-out");
    await waitForOther(`document.querySelector(".pick")`);
    await other.navigate(link); // used: nobody, and told why
    await waitForOther(`document.querySelector(".toast.alert")?.textContent.includes("used")`);
    await waitForOther(`!document.querySelector(".who")`);
  });
});
