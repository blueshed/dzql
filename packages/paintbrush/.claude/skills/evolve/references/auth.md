# Sign in, with no passwords

When people should be someone: their own things, a list only some may see, who wrote what. delta's link sign-in: **a link is someone**. Its tap makes a session, a cookie the page never reads, and the socket is signed in by it. Anyone signed in sends anyone their link; the first person's comes from a command. In development the page asks "Who are you?" and you pick: two windows are two people, and nobody remembers a password. People are a resource of their own, kept in SQLite with a history, as [sqlite.md](sqlite.md) keeps the order.

```ts
// src/resources/people/people-api.ts
/** People: who is here, and signing in as one of them by link (delta's auth-link). Kept in people.db in the data folder. */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import type { WsServer } from "@blueshed/delta/server";
import { wireAuth } from "@blueshed/delta/auth";
import { linkAuth, sqliteLinkStore } from "@blueshed/delta/auth-link";
import { defineDoc, defineSchema, fromFolder, migrate, registerDocs } from "@blueshed/delta/sqlite";

export type Person = { id: number; name: string };
export type People = { people: Record<string, Person> };

export const schema = defineSchema({ people: { columns: { name: "text" }, temporal: false } });
export const docs = [defineDoc("people:", { root: "people", include: [] })]; // everyone, for everyone signed in

/** The people's database, its tables made by its history. */
export async function peopleDb(dataDir: string) {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(`${dataDir}/people.db`, { create: true });
  await migrate(db, await fromFolder(`${import.meta.dir}/migrations`), { app: "people", schema });
  return db;
}

/** Signing in by link on the socket every document rides, and `people:`: answers the auth, for the server's routes. */
export async function peopleDocs(ws: WsServer, dataDir: string) {
  const db = await peopleDb(dataDir);
  const auth = linkAuth<Person>({
    store: sqliteLinkStore(db),
    personOf: (id) => db.query<Person, [number]>("SELECT id, name FROM people WHERE id = ?").get(id),
    people: () => db.query<Person, []>("SELECT id, name FROM people ORDER BY name, id").all(),
  });
  wireAuth(ws, auth); // me, link
  registerDocs(ws, db, schema, docs, [], { auth, shared: true });
  return auth;
}
```

```ts
// src/resources/people/migrations/001-people.ts
// Made by `delta migrations make` from the definitions: what they say beyond the migrations before it.
import { createTable } from "@blueshed/delta/migrations";

export const changes = [
  createTable("people", { columns: { name: { type: "text" } }, temporal: false }),
];
```

The server signs the socket in by its cookie, and serves the tap, sign out and, in development, the picker:

```ts
// src/routes.ts: after import { createWs } from "@blueshed/delta/server";
import { upgradeWithAuth } from "@blueshed/delta/auth";
import { peopleDocs } from "./resources/people/people-api";
```

```ts
// src/routes.ts: after await messageDoc(ws, dataDir);
const auth = await peopleDocs(ws, dataDir); // who is at the socket
```

```ts
// src/routes.ts: after routes: {
  // Link sign-in: the tap, sign out, and in development "Who are you?"
  ...auth.routes,
```

```ts
// src/routes.ts: in place of "/ws": ws.upgrade,
"/ws": upgradeWithAuth(ws, auth), // signed in by the session cookie
```

The first person comes from a command, on your machine or on the server (`railway ssh -- bun run link Sam`). It adds them if they are new, through `people:`, and prints their link:

```ts
// scripts/link.ts
/**
 * `bun run link <name>`: a link to sign in as <name>, made someone new if nobody here has that name.
 * How the first person comes in, before anyone can send them a link. The site is ORIGIN, else
 * Railway's domain, else http://localhost:3000.
 */
import { makeLink, sqliteLinkStore } from "@blueshed/delta/auth-link";
import { createLocal } from "@blueshed/delta/local";
import { registerDocs } from "@blueshed/delta/sqlite";
import { docs, peopleDb, schema, type Person } from "../src/resources/people/people-api";

const name = process.argv.slice(2).join(" ").trim();
if (!name) {
  console.error("Whose link? bun run link <name>");
  process.exit(2);
}
const origin = process.env.ORIGIN ?? (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${process.env.PORT ?? 3000}`);

const db = await peopleDb(process.env.DATA_PATH ?? `${import.meta.dir}/../data`);
const named = () => db.query<Person, [string]>("SELECT id, name FROM people WHERE lower(name) = lower(?) ORDER BY id LIMIT 1").get(name);
let person = named();
if (!person) {
  // someone new, written as the page writes them: delta names their id
  const local = createLocal();
  registerDocs(local.server, db, schema, docs);
  await local.call("open", { doc: "people:" });
  await local.call("delta", { doc: "people:", ops: [{ op: "add", path: "/people/-", value: { name } }] });
  person = named()!;
}
const { url, expires } = await makeLink(sqliteLinkStore(db), person.id, { origin });
console.log(`${person.name}: ${url}\n(used once, until ${expires})`);
db.close();
```

```ts
// package.json: after "dev": "bun --hot src/routes.ts",
"link": "bun scripts/link.ts",
```

The page asks the socket who it is on every connect. Opened by a link, it taps it and starts again, so the socket connects with the cookie the tap set (a document opened as the page loads, like `message`, cannot wait for the tap):

```ts
// src/resources/people/people.ts
import { signal } from "@blueshed/railroad";
import { call, openDoc, type WsClient } from "@blueshed/delta/client";
import type { People, Person } from "./people-api";

export { becomeAs, everyone, signOut, takeLink } from "@blueshed/delta/auth-link/client";

/** Who is at the page: undefined until the socket has said, then someone, or null for nobody. */
export const me = signal<Person | null | undefined>(undefined);

/** On every connect: who the socket is, by the cookie the link's tap (or a pick) set. */
export async function whoAmI(ws: WsClient) {
  me.set(await call<Person | null>("me", {}, ws));
}

/** Everyone here, live. Opened inside a view, it closes when the view goes. */
export const openPeople = () => openDoc<People>("people:");

/** A new link to be `person`, to send them. */
export const linkFor = (person: number) => call<{ url: string; expires: string }>("link", { person });
```

```tsx
// src/resources/people/people-view.tsx
import { list, signal, when } from "@blueshed/railroad";
import { Link, LogOut, UserPlus } from "lucide";
import { bento, go, rowsOf } from "../bento";
import { toast } from "../toast";
import type { Person } from "./people-api";
import { becomeAs, everyone, linkFor, me, openPeople, signOut } from "./people";

const { cell, row, tool, addModal } = bento();

/** People on the box. Signed in: you, everyone here and anyone's link, someone new. Else: who are you? */
export function PeopleCell() {
  const body = <>{when(me, (m$) => <Everyone who={m$.peek() as Person} />, () => when(me.map((m) => m === null), () => <WhoAreYou />))}</>;
  return cell({ name: "People", body });
}

function WhoAreYou() {
  const people = signal<Person[]>([]);
  void everyone<Person>().then((all) => people.set(all)); // nobody, in production
  return (
    <>
      <p class="note">Who are you?</p>
      {when(
        people.map((p) => p.length > 0),
        () => <div class="pick">{list(people, (p) => p.id, (p$) => tool(p$.peek().name, { className: "be", on: () => void becomeAs(p$.peek().id).catch((err) => toast(err.message, "alert")) }))}</div>,
        () => <p class="help">Ask someone here for your link.</p>,
      )}
    </>
  );
}

function Everyone({ who }: { who: Person }) {
  const people = openPeople();
  const all = people.data.map((d) => Object.values(d?.people ?? {}).sort((a, b) => a.name.localeCompare(b.name)));
  const sent = signal("");
  return (
    <>
      {row({ id: "you", what: who.name, note: "you", act: tool("Sign out", { icon: LogOut, kind: "quiet", className: "sign-out", on: () => void signOut() }) })}
      {rowsOf(all, (p) => p.id, (p$) =>
        row({ what: () => p$.get().name, act: tool("Make their link", { icon: Link, iconOnly: true, kind: "quiet", className: "send-link", on: () => void linkFor(p$.peek().id).then(({ url }) => sent.set(url)) }) }), "Nobody yet.")}
      {when(sent, (s$) => <p class="help sent">For them to tap once: <code class="link">{s$}</code></p>)}
      {tool("Someone new", { icon: UserPlus, className: "add-person", on: go("", "new-person") })}
    </>
  );
}

/** Someone new, asked over the box: their name. The people document is opened for it, and closes with it. */
export function NewPerson() {
  const people = openPeople();
  const done = go("");
  return addModal("Someone new", [{ name: "name", label: "Their name" }], ({ name }) => void people.send([{ op: "add", path: "/people/-", value: { name: name!.trim() } }]).then(done, () => toast("Not added", "alert")), done);
}
```

```ts
// src/app.tsx: after import { StatusCell } from "./resources/status/status-view";
import { NewPerson, PeopleCell } from "./resources/people/people-view";
import { takeLink, whoAmI } from "./resources/people/people";
import { toast } from "./resources/toast";
```

```ts
// src/app.tsx: in place of provide(WS, connectWs("/ws"));
// Opened by a link (#/in/<token>)? Its tap signs in, and the page starts again as them
void takeLink().then((taken) => taken && ("error" in taken ? toast(taken.error, "alert") : location.reload()));
provide(WS, connectWs("/ws", { onConnect: whoAmI }));
```

```ts
// src/app.tsx: after MessageCell(),
PeopleCell(),
```

```ts
// src/app.tsx: before return null; // nothing asks
if (at.what === "new-person") return NewPerson();
```

The stories, then their tests: through the socket, nobody until signed in, and a link made by one person signs in another; on the page, pick who you are, add someone new, and their link signs them in in another window.

```ts
// stories.ts: after export const stories = {
  // People
  signIn: story("Nobody sees who is here until signed in, and a link signs someone in, with no password."),
  invite: story("Someone signed in adds someone new and makes their link, and the link signs them in."),
```

```ts
// tests/people.test.ts
import { test, expect, afterAll, setDefaultTimeout } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { startServer } from "../src/routes";
import { stories } from "../stories";
import { browser } from "./browser";

setDefaultTimeout(60_000); // first browser start can be slow

const dataDir = mkdtempSync(`${tmpdir()}/people-`);
const server = await startServer({ port: 0, dev: false, dataDir });
const site = server.url.origin;
const { view, open, waitFor, withOtherWindow, close } = browser(() => server.url);

afterAll(async () => {
  close();
  await server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

/** A socket with `cookie`: what each request answers. */
async function socket(cookie = "") {
  const sock = new WebSocket(`${site.replace("http", "ws")}/ws`, { headers: cookie ? { cookie } : {} } as any);
  await new Promise((ok, no) => ((sock.onopen = ok), (sock.onerror = no)));
  let n = 0;
  const waiting = new Map<number, (msg: any) => void>();
  sock.onmessage = (e) => {
    const msg = JSON.parse(String(e.data));
    waiting.get(msg.id)?.(msg);
  };
  const ask = (msg: object) => new Promise<any>((answer) => (waiting.set(++n, answer), sock.send(JSON.stringify({ id: n, ...msg }))));
  return { ask, close: () => sock.close() };
}
const cookieOf = (res: Response) => res.headers.get("set-cookie")!.split(";")[0]!;

test(`${stories.signIn.name} -- nobody until signed in; a pick signs in, and a link made by one person signs in another`, async () => {
  const nobody = await socket();
  expect((await nobody.ask({ action: "open", doc: "people:" })).error.code).toBe(401);
  nobody.close();

  // the first person, as the command makes them: the picker lists nobody yet
  expect(await (await fetch(`${site}/api/dev/people`)).json()).toEqual([]);
  const proc = Bun.spawnSync(["bun", `${import.meta.dir}/../scripts/link.ts`, "Ann"], { env: { ...process.env, DATA_PATH: dataDir, ORIGIN: site } });
  expect(proc.stdout.toString()).toContain(`Ann: ${site}/#/in/`);

  const [ann] = await (await fetch(`${site}/api/dev/people`)).json();
  const picked = await fetch(`${site}/api/dev/as/${ann.id}`, { method: "POST", headers: { origin: site } });
  const a = await socket(cookieOf(picked));
  await a.ask({ action: "open", doc: "people:" });
  await a.ask({ action: "delta", doc: "people:", ops: [{ op: "add", path: "/people/-", value: { name: "Bob" } }] });
  const bob = ((await (await fetch(`${site}/api/dev/people`)).json()) as { id: number; name: string }[]).find((p) => p.name === "Bob")!.id;
  const { url } = (await a.ask({ action: "call", method: "link", params: { person: bob } })).result;
  a.close();

  const tapped = await fetch(`${site}/api/in/${url.split("#/in/")[1]}`, { method: "POST", headers: { origin: site } });
  const b = await socket(cookieOf(tapped));
  expect((await b.ask({ action: "call", method: "me" })).result).toEqual({ id: bob, name: "Bob" });
  b.close();
});

test(`${stories.invite.name} -- on the page: pick who you are, add someone new, and their link signs them in in another window`, async () => {
  await open();
  await waitFor(`[...document.querySelectorAll(".pick .be")].some((b) => b.textContent === "Ann")`);
  await view.evaluate(`[...document.querySelectorAll(".pick .be")].find((b) => b.textContent === "Ann").click()`);
  await waitFor(`document.querySelector("#you .what")?.textContent === "Ann"`);
  await view.click(".add-person"); // someone new is asked for in a modal
  await waitFor(`document.querySelector("dialog input[name=name]")`);
  await view.click("dialog input[name=name]");
  await view.type("Cy");
  await view.click("dialog .tool.add");
  const cy = `[...document.querySelectorAll('.cell[data-key="people"] .rows .row')].find((r) => r.textContent.includes("Cy"))`;
  await waitFor(cy);
  await view.evaluate(`${cy}.querySelector(".send-link").click()`);
  await waitFor(`document.querySelector(".sent code.link")`);
  const link = await view.evaluate<string>(`document.querySelector(".sent code.link").textContent`);

  await withOtherWindow(async (other, waitForOther) => {
    await other.navigate(link);
    await waitForOther(`document.querySelector("#you .what")?.textContent === "Cy"`);
    await other.click(".sign-out");
    await waitForOther(`document.querySelector(".pick")`);
  });
});
```

- How a link, a session and `mayLink` work: delta-doc's `reference/auth.md`. Who may open a document once there is sign-in: `owns`, a path in the document's definition from its row to the person (`@person` for one's own), or `shared: true`; its `reference/ownership.md` has each shape. Documents registered without `auth`, like `message`, stay open to anyone.
- **In production** nobody is listed: set `ORIGIN` (the site's address, which links name; Railway sets `RAILWAY_PUBLIC_DOMAIN`), and give the first person their link with `bun run link <name>` on the server.
- On Postgres, the links and sessions are dzql's: `postgresLinkStore` from `dzql/auth-link`, and `bunx dzql link`.
