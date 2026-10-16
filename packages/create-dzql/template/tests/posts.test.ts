import { test, expect, afterAll, setDefaultTimeout } from "bun:test";
import { call, connectWs, openDoc } from "@blueshed/delta/client";
import { openPglite } from "dzql/pglite";
import { startServer } from "../src/server";
import type { SignedIn } from "../src/resources/auth/auth-api";
import type { Posts } from "../src/resources/posts/posts-api";
import { browser } from "./browser";

// The posts, as people use them: register, write a post, see it arrive in another window, change it,
// take it away; and someone else sees it with no way to change it. Postgres is kept in memory
// (PGlite), so the tests need no server. The Bun.WebView rules are at the top of browser.ts.

setDefaultTimeout(60_000); // first browser start can be slow

const pool = await openPglite();
const server = await startServer({ port: 0, dev: false, pool });
const { view, open, waitFor, replaceText, withOtherWindow, close } = browser(() => server.url);

afterAll(async () => {
  close();
  await server.stop(true);
  await pool.end();
});

let people = 0;
/** Someone new: a name, and an email and password no one else has. */
const someone = (name: string) => ({ name, email: `${name.toLowerCase()}${++people}@example.com`, password: `${name} writes` });

/** A socket at the server, registered as someone new: who they are, and the socket. */
async function registered(name: string) {
  const client = connectWs(new URL("/ws", server.url).href);
  const me = await call<SignedIn>("register", someone(name), client);
  return { me, client };
}

/** Register in a window: the form's second face, filled in and sent. */
async function registerIn(page: Bun.WebView, until: (expr: string) => Promise<void>, who: ReturnType<typeof someone>) {
  await until(`document.querySelector("button.switch")`);
  await page.click("button.switch");
  await until(`document.querySelector("input[name=name]")`);
  await page.click("input[name=name]");
  await page.type(who.name);
  await page.click("input[name=email]");
  await page.type(who.email);
  await page.click("input[name=password]");
  await page.type(who.password);
  await page.click("form.sign-in button.primary");
  await until(`document.querySelector(".who")?.textContent.includes(${JSON.stringify(who.name)})`);
}

const titles = (page: Bun.WebView) => page.evaluate<string[]>(`[...document.querySelectorAll(".posts .title")].map((e) => e.textContent)`);

test("a post is written through your own posts, never through everyone's, and nobody opens another's", async () => {
  const ada = await registered("Ada");
  const bob = await registered("Bob");
  try {
    const everyone = openDoc<Posts>("posts:", ada.client);
    await everyone.ready;
    await expect(everyone.send([{ op: "add", path: "/posts/-", value: { title: "x", content: "y" } }])).rejects.toMatchObject({ code: 403 });

    const mine = openDoc<Posts>(`mine:${ada.me.id}`, ada.client);
    await mine.ready;
    await mine.send([{ op: "add", path: "/posts/-", value: { title: "Hello", content: "First post" } }]);
    const [post] = Object.values(mine.data.peek()!.posts);
    expect(post).toMatchObject({ author_id: ada.me.id, title: "Hello", content: "First post" });

    // Bob opening Ada's posts finds nothing there, and so can change nothing of hers
    await expect(bob.client.send({ action: "open", doc: `mine:${ada.me.id}` })).rejects.toMatchObject({ code: 404 });
    // nor can an author be given: a post added through your own is yours
    const bobs = openDoc<Posts>(`mine:${bob.me.id}`, bob.client);
    await bobs.ready;
    await bobs.send([{ op: "add", path: "/posts/-", value: { title: "Mine", content: "Bob's", author_id: ada.me.id } }]).catch(() => {});
    expect(Object.values(bobs.data.peek()!.posts).every((p) => p.author_id === bob.me.id)).toBe(true);
  } finally {
    ada.client.close();
    bob.client.close();
  }
});

test("register, publish, see it arrive in another window, edit it, delete it; another person sees it and cannot change it", async () => {
  await open();
  await registerIn(view, waitFor, someone("Cy"));
  await withOtherWindow(async (other, waitForOther) => {
    await registerIn(other, waitForOther, someone("Di"));

    // Cy publishes: it shows in Cy's window, and arrives in Di's with no reload
    await view.click("input[name=title]");
    await view.type("A shed of our own");
    await view.click("textarea[name=content]");
    await view.type("Who has the key?");
    await view.click("button.publish");
    await waitFor(`[...document.querySelectorAll(".posts .title")].some((e) => e.textContent === "A shed of our own")`);
    await waitForOther(`[...document.querySelectorAll(".posts .title")].some((e) => e.textContent === "A shed of our own")`);

    // Di sees it with no Edit and no Delete; Cy sees both
    expect(await other.evaluate<number>(`document.querySelectorAll(".posts button.edit, .posts button.delete").length`)).toBe(0);
    expect(await view.evaluate<number>(`document.querySelectorAll(".posts button.edit").length`)).toBe(1);

    // Cy edits it in the sheet: both windows show the new title
    await view.click(".posts button.edit");
    await waitFor(`document.querySelector(".sheet input[name=title]")`);
    await replaceText(".sheet input[name=title]", "The key is under the pot");
    await view.click(".sheet button.save");
    await waitFor(`!document.querySelector(".sheet")`);
    await waitForOther(`[...document.querySelectorAll(".posts .title")].some((e) => e.textContent === "The key is under the pot")`);
    expect(await titles(view)).toContain("The key is under the pot");

    // Cy deletes it: gone from both windows
    await view.click(".posts button.delete");
    await waitFor(`![...document.querySelectorAll(".posts .title")].some((e) => e.textContent === "The key is under the pot")`);
    await waitForOther(`![...document.querySelectorAll(".posts .title")].some((e) => e.textContent === "The key is under the pot")`);
  });
});

test("a reload keeps you signed in; signed out, you sign in again with your email and password", async () => {
  const eve = someone("Eve");
  await view.evaluate(`localStorage.clear()`); // nobody signed in: the last test left its person
  await open();
  await registerIn(view, waitFor, eve);
  await open(); // a reload: the page signs in again with the token it kept
  await waitFor(`document.querySelector(".who")?.textContent.includes("Eve")`);

  await view.click("button.sign-out");
  await waitFor(`document.querySelector("form.sign-in")`);
  await view.click("input[name=email]");
  await view.type(eve.email);
  await view.click("input[name=password]");
  await view.type(eve.password);
  await view.click("form.sign-in button.primary");
  await waitFor(`document.querySelector(".who")?.textContent.includes("Eve")`);
});
