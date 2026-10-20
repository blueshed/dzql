/**
 * The examples, run as their READMEs say. (The recipe, the skill's runnable app:
 * tests/recipe.test.ts; the Postgres ones are dzql's.)
 *
 *   kanban      -- two browsers on one board: a card one clicks moves on both;
 *                  and run.ts, the headless story, runs through
 *   sites-bbox  -- a box told the sites that come into it, move in it, and leave it
 *   lists       -- sign-in by link and who may open what; two browsers, and Ann's undo leaves
 *                  Bo's change; an undo someone else's change is in the way of, refused; a
 *                  database version one left, migrated at start-up, every row kept, undo fenced
 *   lobby       -- two browsers: one joins, the other sees them, and sees them go; the kinds
 *                  on the wire (memory, static, source)
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { call, connectWs, openDoc, type DeltaOp } from "../src/client/client";
import { createLocal } from "../src/server/local";
import { defineDoc, defineSchema, importTables, migrate, migrationStatus, registerDocs } from "../src/server/sqlite";
import { waitFor } from "../src/testing";
import { migrations as listsHistory } from "../examples/lists/resources/lists/migrations";
import { migrations as peopleHistory } from "../examples/lists/resources/people/migrations";
import { schema as people } from "../examples/lists/resources/people/people-api";
import { bboxStory, browserOn, cookieOf, runExample, signedIn, stop, until, type Proc } from "./helpers/examples";

test("sites-bbox on SQLite: a box is told the sites that come into it, move in it, and leave it", async () => {
  const server = runExample("sites-bbox/routes.ts");
  try {
    const [, url, world] = await until(server, /(ws:\S+)[\s\S]*"(world:\d+)"/);
    await bboxStory(url!, url!, world!);
  } finally {
    await stop(server);
  }
});

describe("kanban", () => {
  test("two browsers on board:1: a card clicked in one moves to the next column in both", async () => {
    const server = runExample("kanban/routes.ts");
    const browsers: Proc[] = [];
    const browser = (more: Record<string, string>) => {
      const p = Bun.spawn(["bun", join(import.meta.dir, "helpers/kanban-browser.ts")], {
        cwd: join(import.meta.dir, "../examples/kanban"),   // its tsconfig: railroad's JSX
        env: { ...process.env, PORT: port!, SEE: "write the kanban example", IN: "In progress", ...more },
        stdout: "pipe", stderr: "pipe",
      });
      browsers.push(p);
      return p;
    };
    let port: string | undefined;
    try {
      [, port] = await until(server, /localhost:(\d+)/);
      expect((await fetch(`http://localhost:${port}/`)).status).toBe(200);
      const watcher = browser({});
      await until(watcher, /ready/);
      const clicker = browser({ CLICK: "write the kanban example" });
      for (const b of [clicker, watcher]) {
        const [, shown] = await until(b, /board (.*)/);
        expect(JSON.parse(shown!)["In progress"]).toContain("write the kanban example");
        expect(JSON.parse(shown!)["Todo"]).not.toContain("write the kanban example");
      }
    } finally {
      await stop(server, ...browsers);
    }
  }, 20_000);

  test("run.ts: bob's board shows alice's rename, move and new card; charlie, opening late, the same", async () => {
    const run = runExample("kanban/run.ts");
    const hang = setTimeout(() => run.kill(), 15_000);   // a hang is killed before the test's timeout, so the finally runs
    try {
      const out = await new Response(run.stdout).text();
      expect(await run.exited).toBe(0);
      const told = out.slice(out.indexOf("bob received"), out.indexOf("3. bob.data.get()"));
      expect(told).toContain('"path": "/kanban_columns/2/title"');   // told the fields that changed, not the rows
      expect(told).toContain('"path": "/kanban_cards/1/kanban_columns_id"');
      const bob = out.slice(out.indexOf("3. bob.data.get()"), out.indexOf("4. charlie"));
      expect(bob).toContain('"title": "In flight"');
      expect(bob).toContain('"title": "draft release notes"');
      expect(out.slice(out.indexOf("4. charlie"))).toContain('"title": "draft release notes"');
    } finally {
      clearTimeout(hang);
      await stop(run);   // never left running with its pool open
    }
  }, 20_000);
});

describe("lists", () => {
  let files = 0;
  /** A database file of its own, gone after the test. */
  const database = () => join(tmpdir(), `delta-lists-${process.pid}-${++files}.db`);
  const forget = (db: string) => { for (const end of ["", "-wal", "-shm"]) rmSync(db + end, { force: true }); };

  /** The lists server on `db`, as its README runs it; `as(id)`, the development picker's cookie for person `id`. */
  async function listsOn(db: string) {
    const server = runExample("lists/routes.ts", { LISTS_DB: db });
    const [, site] = await until(server, /Listening on (http:\/\/[^/\s]+)/);
    const as = async (id: number) => cookieOf(await fetch(`${site}/api/dev/as/${id}`, { method: "POST", headers: { origin: site! } }));
    return { server, site: site!, as };
  }
  const titles = (doc: any) => Object.values<any>(doc.items).map((i) => i.title);

  test("sign-in by link, and who may open what: nobody until signed in; people: for all; a list for its members alone", async () => {
    const db = database();
    const { server, site, as } = await listsOn(db);
    const sockets: { close(): void }[] = [];
    const socket = async (cookie?: string) => { const s = await signedIn(site, cookie); sockets.push(s); return s; };
    try {
      const nobody = await socket();
      expect((await nobody.ask({ action: "open", doc: "people:" })).error.code).toBe(401);
      expect((await nobody.ask({ action: "call", method: "me" })).result).toBeNull();

      // Ann's link, from the command the README gives; its tap signs her in, once
      const cli = Bun.spawnSync(["bun", join(import.meta.dir, "../src/cli.ts"), "link", db, "1", "--origin", site]);
      const token = /#\/in\/(\S+)/.exec(cli.stdout.toString())![1];
      const tap = (t: string) => fetch(`${site}/api/in/${t}`, { method: "POST", headers: { origin: site } });
      const tapped = await tap(token!);
      expect(tapped.status).toBe(200);
      const ann = await socket(cookieOf(tapped));
      expect((await ann.ask({ action: "call", method: "me" })).result).toEqual({ id: 1, name: "Ann" });
      expect((await tap(token!)).status).toBe(400);   // used once

      // a link Ann makes for Bo signs Bo in
      const { url } = (await ann.ask({ action: "call", method: "link", params: { person: 2 } })).result;
      const bo = await socket(cookieOf(await tap(url.split("#/in/")[1])));
      expect((await bo.ask({ action: "call", method: "me" })).result).toEqual({ id: 2, name: "Bo" });

      // people: is shared, for anyone signed in
      const cy = await socket(await as(3));
      expect(Object.values<any>((await cy.ask({ action: "open", doc: "people:" })).result.people).map((p) => p.name).sort()).toEqual(["Ann", "Bo", "Cy"]);

      // the lists each is on, theirs alone (owns: @person)
      const on = async (who: typeof ann, me: number) => Object.values<any>((await who.ask({ action: "open", doc: `mine:${me}` })).result.members).map((m) => m.lists_id);
      expect(await on(ann, 1)).toEqual([1, 2]);
      expect(await on(bo, 2)).toEqual([1]);
      expect((await bo.ask({ action: "open", doc: "mine:1" })).error.code).toBe(404);

      // a list for its members (owns: @id->members[lists_id=$].person): not there for anyone else, to read or write
      expect((await bo.ask({ action: "open", doc: "list:1" })).result.lists.title).toBe("Shopping");
      expect((await cy.ask({ action: "open", doc: "list:1" })).error.code).toBe(404);
      expect((await cy.ask({ action: "delta", doc: "list:1", ops: [{ op: "add", path: "/items/-", value: { title: "Cy's" } }] })).error.code).toBe(404);
      expect((await cy.ask({ action: "open", doc: "list:3" })).result.lists.title).toBe("Books");
    } finally {
      for (const s of sockets) s.close();
      await stop(server);
      forget(db);
    }
  }, 20_000);

  test("two browsers, Ann and Bo on Shopping: each sees only their lists, and Ann's undo takes back her item and leaves Bo's", async () => {
    const db = database();
    const { server, site, as } = await listsOn(db);
    const port = new URL(site).port;
    const browsers: Proc[] = [];
    const browser = (env: Record<string, string>) => {
      const b = browserOn("lists", "lists-browser.ts", { PORT: port, LIST: "Shopping", END: "eggs", ...env });
      browsers.push(b);
      return b;
    };
    try {
      const ann = browser({ COOKIE: await as(1), STEPS: JSON.stringify([["add", "milk"], ["see", "eggs"], ["undo"]]) });
      const bo = browser({ COOKIE: await as(2), STEPS: JSON.stringify([["see", "milk"], ["add", "eggs"]]) });
      expect((await until(ann, /lists (.*)/))[1]).toBe("Shopping,Holiday");
      expect((await until(bo, /lists (.*)/))[1]).toBe("Shopping");
      for (const b of [ann, bo]) expect((await until(b, /list (.*)/))[1]).toBe("eggs");   // milk gone on both, eggs kept
      expect(await ann.exited).toBe(0);
    } finally {
      await stop(server, ...browsers);
      forget(db);
    }
  }, 20_000);

  test("undo beside someone else, on the wire: each walks back their own; one with Bo's change in the way is refused, and changes nothing", async () => {
    const db = database();
    const { server, site, as } = await listsOn(db);
    const [ann, bo] = [await signedIn(site, await as(1)), await signedIn(site, await as(2))];
    try {
      const open = async (who: typeof ann) => (await who.ask({ action: "open", doc: "list:1" })).result;
      const write = async (who: typeof ann, op: DeltaOp) => (await who.ask({ action: "delta", doc: "list:1", ops: [op] })).result;
      const added = async (who: typeof ann, title: string) => Number((await write(who, { op: "add", path: "/items/-", value: { title } })).ops[0].path.split("/")[2]);
      await open(ann);
      await open(bo);

      const milk = await added(ann, "milk");
      await added(bo, "eggs");
      expect((await ann.ask({ action: "undo" })).result.ops).toEqual([{ op: "remove", path: `/items/${milk}` }]);
      expect(titles(await open(bo))).toEqual(["eggs"]);
      expect((await ann.ask({ action: "redo" })).result.ops[0]).toMatchObject({ op: "add", path: `/items/${milk}` });   // back under its id
      expect(titles(await open(bo))).toEqual(["milk", "eggs"]);

      // Ann adds bread, Bo ticks it: Ann's undo would remove a row Bo has changed since
      const bread = await added(ann, "bread");
      await write(bo, { op: "replace", path: `/items/${bread}/done`, value: true });
      const refused = (await ann.ask({ action: "undo" })).result;
      expect(refused).toMatchObject({ doc: "list:1", ops: [], conflict: [`/items/${bread}`] });
      expect((await open(ann)).items[bread]).toMatchObject({ title: "bread", done: true });
      // Bo's undo is his own: his tick
      expect((await bo.ask({ action: "undo" })).result.ops).toEqual([{ op: "replace", path: `/items/${bread}`, value: expect.objectContaining({ title: "bread", done: false }) }]);
      expect(titles(await open(ann))).toEqual(["milk", "eggs", "bread"]);
    } finally {
      ann.close();
      bo.close();
      await stop(server);
      forget(db);
    }
  }, 20_000);

  test("a database version one left: migrated at start-up, every row kept under its new name, and undo fenced across it", async () => {
    const db = database();
    // The database as version one left it: its history then (002-title not yet), its rows, and a write on its ledger
    const one = defineSchema({
      lists:   { columns: { title: "text" }, temporal: false },
      members: { parent: "lists", columns: { person: "integer" }, temporal: false },
      items:   { parent: "lists", columns: { text: "text", done: { type: "boolean", default: false } }, temporal: false },
    });
    const old = new Database(db, { create: true });
    await migrate(old, peopleHistory, { app: "people" });
    await migrate(old, listsHistory.slice(0, 1), { app: "lists" });
    importTables(old, people, { tables: { people: [{ id: 1, name: "Ann" }, { id: 2, name: "Bo" }] } });
    importTables(old, one, {
      tables: {
        lists: [{ id: 1, title: "Shopping" }],
        members: [{ id: 1, lists_id: 1, person: 1 }, { id: 2, lists_id: 1, person: 2 }],
        items: [{ id: 1, lists_id: 1, text: "milk", done: true }, { id: 2, lists_id: 1, text: "eggs", done: false }],
      },
    });
    const v1 = createLocal();
    registerDocs(v1.server, old, one, [defineDoc("list:", { root: "lists", include: ["members", "items"] })], [], { ledger: true });
    await v1.call("open", { doc: "list:1" });
    await v1.call("delta", { doc: "list:1", cursor: "ann", ops: [{ op: "add", path: "/items/-", value: { text: "bread" } }] });
    old.close();

    const { server, site, as } = await listsOn(db);
    const ann = await signedIn(site, await as(1));
    try {
      // every row, its words under their new name
      const list = (await ann.ask({ action: "open", doc: "list:1" })).result;
      expect(Object.values<any>(list.items).map(({ id, title, done }) => ({ id, title, done }))).toEqual([
        { id: 1, title: "milk", done: true }, { id: 2, title: "eggs", done: false }, { id: 3, title: "bread", done: false },
      ]);
      expect(Object.values<any>(list.items).some((i) => "text" in i)).toBe(false);
      // the write before the migration is history, and not undoable: its paths name what has moved
      const [bread] = (await ann.ask({ action: "history", doc: "list:1" })).result;
      expect(bread).toMatchObject({ undoable: false, ops: [{ op: "add", path: "/items/3" }] });
      // and a write after it is
      await ann.ask({ action: "delta", doc: "list:1", ops: [{ op: "add", path: "/items/-", value: { title: "tea" } }] });
      expect((await ann.ask({ action: "undo" })).result.ops).toEqual([{ op: "remove", path: "/items/4" }]);
    } finally {
      ann.close();
      await stop(server);
    }

    try {
      const kept = new Database(db);
      // the cursor that wrote bread before the migration walks nothing now
      const v2 = createLocal();
      registerDocs(v2.server, kept, (await import("../examples/lists/resources/lists/lists-api")).schema, [defineDoc("list:", { root: "lists", include: ["items"] })], [], { ledger: true });
      expect((await v2.call("undo", { cursor: "ann" })).result).toBeNull();
      // each migration ran once; the definitions and the history agree (the README's `make`: nothing to make)
      const status = await migrationStatus(kept, listsHistory, { app: "lists" });
      expect(status.ran.map((r) => r.id)).toEqual(["001-lists", "002-title"]);
      expect(status.pending).toEqual([]);
      kept.close();
      const make = Bun.spawnSync(["bun", join(import.meta.dir, "../src/cli.ts"), "migrations", "make", "examples/lists/resources/lists/lists-api.ts", "--dir", "examples/lists/resources/lists/migrations"], { cwd: join(import.meta.dir, "..") });
      expect(make.stdout.toString()).toContain("nothing to make");
    } finally {
      forget(db);
    }
  }, 20_000);
});

describe("lobby", () => {
  test("two browsers: one joins, and the other sees them in their colour; it closes, and they go", async () => {
    const server = runExample("lobby/routes.ts");
    const browsers: Proc[] = [];
    try {
      const [, port] = await until(server, /localhost:(\d+)/);
      const watcher = browserOn("lobby", "lobby-browser.ts", { PORT: port!, SEE: "Ann:seagreen|" });
      browsers.push(watcher);
      await until(watcher, /ready/);
      const ann = browserOn("lobby", "lobby-browser.ts", { PORT: port!, NAME: "Ann", COLOUR: "seagreen", SEE: "Ann:seagreen" });
      browsers.push(ann);
      await until(watcher, /here Ann:seagreen\n/);
      expect(await ann.exited).toBe(0);   // gone: its socket closed
      await until(watcher, /here \n/);    // and the lobby told the watcher so
      expect(await watcher.exited).toBe(0);
    } finally {
      await stop(server, ...browsers);
    }
  }, 20_000);

  test("the kinds on the wire: who is here is told to everyone holding it, written by the server alone; colours fixed; the load one reading", async () => {
    const server = runExample("lobby/routes.ts");
    const [, port] = await until(server, /localhost:(\d+)/);
    const url = `ws://localhost:${port}/ws`;
    const [a, b] = [connectWs(url), connectWs(url)];
    try {
      const [atA, atB] = [openDoc<any>("here:lobby", a), openDoc<any>("here:lobby", b)];
      await Promise.all([atA.ready, atB.ready]);
      const told: DeltaOp[][] = [];
      atA.onOps((ops) => told.push(ops));

      const { id } = await call<{ id: string }>("join", { name: "Bo", colour: "orchid" }, b);
      await waitFor(() => told.length === 1);
      expect(told[0]).toEqual([{ op: "add", path: `/people/${id}`, value: { name: "Bo", colour: "orchid" } }]);
      await waitFor(() => atB.data.get().people[id]?.name === "Bo");   // and to Bo's own page
      expect(await atB.send([{ op: "remove", path: `/people/${id}` }]).catch((e) => e.code)).toBe(403);   // never over the socket

      const colours = openDoc<any>("colours:", a);
      await colours.ready;
      expect(colours.data.get().colours).toContain("seagreen");
      expect(await colours.send([{ op: "add", path: "/colours/-", value: "pink" }]).catch((e) => e.code)).toBe(403);

      const [loadA, loadB] = [openDoc<any>("load:server", a), openDoc<any>("load:server", b)];
      await Promise.all([loadA.ready, loadB.ready]);
      expect(loadA.data.get()).toMatchObject({ reading: expect.any(Number), at: expect.any(Number), stale: false });
      expect(loadB.data.get()).toEqual(loadA.data.get());   // one reading, shared

      b.close();   // Bo's socket goes, and so does Bo
      await waitFor(() => told.length === 2);
      expect(told[1]).toEqual([{ op: "remove", path: `/people/${id}` }]);
    } finally {
      a.close();
      b.close();
      await stop(server);
    }
  }, 20_000);
});
