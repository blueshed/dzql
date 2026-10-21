/**
 * A document's `owns` as a path (`../paths.ts`), the same on every backend: SQLite and the JSON
 * file here, dzql's Postgres compiled. A person opens, writes through and walks a document whose
 * path reaches them; one it does not reach is not there (404); a write that would take the row
 * out of their reach is refused (403), so a row is never handed away; a path through a table that
 * keeps versions reads its current rows; and a path that cannot be followed is refused at
 * registration, naming the document. Each backend's file supplies `start`.
 *
 *   permissionCases("sqlite", () => ({ start: async (docs) => ... }));
 */
import { describe, expect, test } from "bun:test";
import { defineDoc, defineSchema, type DocDef } from "../schema";
import type { DeltaAuth } from "../server/auth";
import { waitFor } from "./support";


export type Person = { id: number; name: string };

/** Who is signed in is what the caller carries (`createLocal().as(person)`); the path compares their id. */
export const permissionAuth: DeltaAuth<Person> = {
  gate: (c: any) => (c.data?.identity as Person | undefined) ?? { error: "Authentication required" },
  asSqlArg: (p) => p.id,
};

export const permissionSchema = defineSchema({
  people: { columns: { name: "text", team_id: "integer?" }, temporal: false },   // team_id: the team a person is on, if any
  orgs: { columns: { name: "text" }, temporal: false },
  members: { columns: { org_id: "integer", person_id: "integer", active: "boolean" } },   // keeps versions
  venues: { columns: { org_id: "integer", name: "text" }, temporal: false },
  posts: { columns: { author_id: "integer", title: "text" }, temporal: false },
  tasks: { parent: "people", columns: { title: "text" }, temporal: false },   // a person's own
});

/** Ann and Ben in North, Cy in South, Ben once in South and no longer; Ann and Ben on team 1, Cy on none, a task each. */
export const permissionSeed = {
  tables: {
    people: [{ id: 1, name: "Ann", team_id: 1 }, { id: 2, name: "Ben", team_id: 1 }, { id: 3, name: "Cy", team_id: null }],
    orgs: [{ id: 1, name: "North" }, { id: 2, name: "South" }],
    members: [
      { id: 1, org_id: 1, person_id: 1, active: true },
      { id: 2, org_id: 1, person_id: 2, active: true },
      { id: 3, org_id: 2, person_id: 3, active: true },
      { id: 4, org_id: 2, person_id: 2, active: false },
    ],
    venues: [{ id: 1, org_id: 1, name: "Hall" }, { id: 2, org_id: 2, name: "Barn" }],
    posts: [{ id: 1, author_id: 1, title: "Ann's" }, { id: 2, author_id: 2, title: "Ben's" }],
    tasks: [{ id: 1, people_id: 1, title: "Ann's task" }, { id: 2, people_id: 2, title: "Ben's task" }, { id: 3, people_id: 3, title: "Cy's task" }],
  },
};

export const permissionDocs = {
  /** One's own post: the row's author. */
  post: defineDoc("post:", { root: "posts", include: [], owns: "@author_id" }),
  /** A venue, for the active members of its org: two hops, a condition, through a table that keeps versions. */
  venue: defineDoc("venue:", { root: "venues", include: [], owns: "@org_id->members[org_id=$]{active}.person_id" }),
  /** An org's venues, for its active members: the path starts at the name's value. */
  venuesOf: defineDoc("venues-of:", { root: "venues", include: [], scope: { org_id: ":org" }, owns: "members[org_id=@org_id]{active}.person_id" }),
  /** Every venue, for North's active members: a list has no row to start from, so its path starts at a table. */
  venues: defineDoc("venues:", { root: "venues", include: [], owns: "members[org_id=1]{active}.person_id" }),
  /** Every membership, for anyone signed in. */
  members: defineDoc("members:", { root: "members", include: [], owns: "AUTHENTICATED" }),
  /** Nobody's. */
  sealed: defineDoc("sealed:", { root: "orgs", include: [], owns: "FALSE" }),
  /** Every post, for anyone, signed in or not; written by someone signed in (its rule). */
  board: defineDoc("board:", { root: "posts", include: [], owns: "ANYONE", accept: (_op, { who }) => who !== undefined || "Sign in to post" }),
  /** A person and their own tasks, for them. */
  mine: defineDoc("mine:", { root: "people", include: ["tasks"], owns: "@id" }),
  /** A team's people and their tasks, for its members: a scoped list holds only what hangs under the people it admits. */
  team: defineDoc("team:", { root: "people", include: ["tasks"], scope: { team_id: ":team" }, owns: "people[team_id=@team_id].id" }),
};

const ann: Person = { id: 1, name: "Ann" };
const ben: Person = { id: 2, name: "Ben" };
const cy: Person = { id: 3, name: "Cy" };
const NOT_FOUND = { code: 404, message: "Not found" };

export interface PermissionProcess {
  /** A caller signed in as `person`; with none, a caller nobody is signed in on. */
  as(person?: Person): { call(action: string, msg: Record<string, unknown>): Promise<any> };
  /** What the process tells, on every channel, and to whom (`createLocal().onPublish`). */
  onPublish(fn: (channel: string, data: any, to?: { identity: unknown }) => void): () => void;
}

export interface PermissionBackend {
  /** A process with `permissionAuth` over `permissionSchema`, holding `permissionSeed`, with `docs` registered (a ledger kept). */
  start(docs: DocDef[]): Promise<PermissionProcess>;
}

export function permissionCases(name: string, backend: () => PermissionBackend): void {
  const all = Object.values(permissionDocs);
  describe(`${name}: owns as a path`, () => {
    test("@field: one's own post opens and takes writes; another's is not there (404)", async () => {
      const p = await backend().start(all);
      expect((await p.as(ann).call("open", { doc: "post:1" })).result.posts.title).toBe("Ann's");
      expect((await p.as(ann).call("delta", { doc: "post:1", ops: [{ op: "replace", path: "/posts/title", value: "Ann's, edited" }] })).error).toBeUndefined();
      expect((await p.as(ann).call("open", { doc: "post:2" })).error).toEqual(NOT_FOUND);
      expect((await p.as(ann).call("delta", { doc: "post:2", ops: [{ op: "replace", path: "/posts/title", value: "mine now" }] })).error).toEqual(NOT_FOUND);
      expect((await p.as(ben).call("open", { doc: "post:2" })).result.posts.title).toBe("Ben's");
    });

    test("a chain: a venue opens for its org's active members; to an inactive or a non-member it is not there", async () => {
      const p = await backend().start(all);
      expect((await p.as(ann).call("open", { doc: "venue:1" })).error).toBeUndefined();
      expect((await p.as(ben).call("open", { doc: "venue:1" })).error).toBeUndefined();
      expect((await p.as(cy).call("open", { doc: "venue:1" })).error).toEqual(NOT_FOUND);
      expect((await p.as(ben).call("open", { doc: "venue:2" })).error).toEqual(NOT_FOUND);   // a member of South no longer
      expect((await p.as(cy).call("open", { doc: "venue:2" })).error).toBeUndefined();
    });

    test("a path from the name: an org's venues open for its active members, and a name that gives no org opens for nobody", async () => {
      const p = await backend().start(all);
      expect(Object.values((await p.as(ann).call("open", { doc: "venues-of:1" })).result.venues)).toEqual([{ id: 1, org_id: 1, name: "Hall" }]);
      expect((await p.as(ann).call("open", { doc: "venues-of:2" })).error).toEqual(NOT_FOUND);
      expect((await p.as(cy).call("open", { doc: "venues-of:2" })).error).toBeUndefined();
      expect((await p.as(ann).call("open", { doc: "venues-of:" })).error).toEqual(NOT_FOUND);
    });

    test("a membership let go, as the tables keep versions: its old version reaches nobody", async () => {
      const p = await backend().start(all);
      await p.as(cy).call("open", { doc: "members:" });
      expect((await p.as(cy).call("delta", { doc: "members:", ops: [{ op: "replace", path: "/members/1/active", value: false }] })).error).toBeUndefined();
      expect((await p.as(ann).call("open", { doc: "venue:1" })).error).toEqual(NOT_FOUND);
      expect((await p.as(ann).call("open", { doc: "venues-of:1" })).error).toEqual(NOT_FOUND);
      expect((await p.as(ben).call("open", { doc: "venue:1" })).error).toBeUndefined();
    });

    test("a row is never handed away: a write that would take it out of the writer's reach is refused (403), in delta's words with its path, and changes nothing", async () => {
      const p = await backend().start(all);
      await p.as(ann).call("open", { doc: "post:1" });
      const given = await p.as(ann).call("delta", { doc: "post:1", ops: [{ op: "replace", path: "/posts/author_id", value: 2 }] });
      expect(given.error).toEqual({ code: 403, message: "post:1: that would take it out of your reach (its owns: @author_id)" });
      expect((await p.as(ann).call("open", { doc: "post:1" })).result.posts.author_id).toBe(1);
      expect((await p.as(ben).call("open", { doc: "post:1" })).error).toEqual(NOT_FOUND);
      await p.as(ann).call("open", { doc: "venue:1" });
      expect((await p.as(ann).call("delta", { doc: "venue:1", ops: [{ op: "replace", path: "/venues/org_id", value: 2 }] })).error).toEqual({
        code: 403, message: "venue:1: that would take it out of your reach (its owns: @org_id->members[org_id=$]{active}.person_id)",
      });
    });

    test("removing one's own row is no handing away: the post goes", async () => {
      const p = await backend().start(all);
      await p.as(ann).call("open", { doc: "post:1" });
      expect((await p.as(ann).call("delta", { doc: "post:1", ops: [{ op: "remove", path: "/posts/1" }] })).error).toBeUndefined();
      expect((await p.as(ann).call("open", { doc: "post:1" })).error).toEqual(NOT_FOUND);   // gone: a path from a row that is not there reaches nobody
    });

    test("an undo walks only a document whose path reaches the walker", async () => {
      const p = await backend().start(all);
      await p.as(ann).call("open", { doc: "post:1" });
      await p.as(ann).call("delta", { doc: "post:1", ops: [{ op: "replace", path: "/posts/title", value: "changed" }], cursor: "c1" });
      expect((await p.as(ben).call("undo", { cursor: "c1" })).error).toEqual(NOT_FOUND);
      expect((await p.as(ann).call("undo", { cursor: "c1" })).error).toBeUndefined();
      expect((await p.as(ann).call("open", { doc: "post:1" })).result.posts.title).toBe("Ann's");
    });

    test("a list for some people: a path that starts at a table opens every venue for North's active members; to anyone else it is not there", async () => {
      const p = await backend().start(all);
      expect(Object.keys((await p.as(ann).call("open", { doc: "venues:" })).result.venues)).toEqual(["1", "2"]);
      expect((await p.as(cy).call("open", { doc: "venues:" })).error).toEqual(NOT_FOUND);
    });

    test("a person's own rows, which their team sees: a team's list holds its members and their tasks, never another's; to one off the team it is not there, and their own opens for them alone", async () => {
      const p = await backend().start(all);
      const team = (await p.as(ben).call("open", { doc: "team:1" })).result;
      expect(Object.keys(team.people)).toEqual(["1", "2"]);
      expect(Object.values(team.tasks).map((t: any) => t.title)).toEqual(["Ann's task", "Ben's task"]);
      expect((await p.as(cy).call("open", { doc: "team:1" })).error).toEqual(NOT_FOUND);
      expect(Object.values((await p.as(cy).call("open", { doc: "mine:3" })).result.tasks).map((t: any) => t.title)).toEqual(["Cy's task"]);
      expect((await p.as(ann).call("open", { doc: "mine:3" })).error).toEqual(NOT_FOUND);
    });

    test("TRUE, FALSE and AUTHENTICATED: anyone signed in opens members:; nobody opens sealed:", async () => {
      const p = await backend().start(all);
      expect((await p.as(ben).call("open", { doc: "members:" })).error).toBeUndefined();
      expect((await p.as(ann).call("open", { doc: "sealed:1" })).error).toEqual(NOT_FOUND);
    });

    test("ANYONE: a caller nobody is signed in on opens and hears board:, writes it only as its rule says, and is refused every other document (401)", async () => {
      const p = await backend().start(all);
      const nobody = p.as();
      const sent: { channel: string; data: any; to?: { identity: unknown } }[] = [];
      const off = p.onPublish((channel, data, to) => sent.push({ channel, data, to }));
      try {
        expect(Object.keys((await nobody.call("open", { doc: "board:" })).result.posts)).toEqual(["1", "2"]);
        expect((await p.as(cy).call("open", { doc: "board:" })).error).toBeUndefined();   // and anyone signed in
        // its writes are its rule's, told no one (who undefined)
        expect((await nobody.call("delta", { doc: "board:", ops: [{ op: "add", path: "/posts/-", value: { author_id: 3, title: "anon" } }] })).error)
          .toEqual({ code: 400, message: "Sign in to post" });
        expect((await p.as(cy).call("delta", { doc: "board:", ops: [{ op: "add", path: "/posts/-", value: { author_id: 3, title: "Cy's" } }] })).error).toBeUndefined();
        // the caller nobody is signed in on hears it, and is not let go
        await waitFor(() => sent.some((m) => m.channel === "board:" && m.data.ops?.some((o: any) => o.value?.title === "Cy's")));
        expect(sent.filter((m) => m.data?.error)).toEqual([]);
        expect(Object.keys((await nobody.call("open", { doc: "board:" })).result.posts)).toEqual(["1", "2", "3"]);
        // default-deny holds for every other document: a path, AUTHENTICATED, FALSE
        for (const doc of ["post:1", "members:", "venues:", "mine:1", "sealed:1"]) {
          expect([doc, (await nobody.call("open", { doc })).error?.code]).toEqual([doc, 401]);
          expect([doc, (await nobody.call("delta", { doc, ops: [] })).error?.code]).toEqual([doc, 401]);
        }
      } finally {
        off();
      }
    });

    test("a path that cannot be followed is refused at registration, naming the document, the path and what is wrong", async () => {
      const refused = (owns: string, scope?: Record<string, string>) =>
        backend().start([defineDoc("bad:", { root: "venues", include: [], owns, ...(scope ? { scope } : {}) })]);
      await expect(refused("@org_id->clubs[org_id=$].person_id")).rejects.toThrow(`doc "bad:": its owns path cannot be followed: no collection clubs`);
      await expect(refused("@org_id->members[org_id=$].user_id")).rejects.toThrow("members has no column user_id");
      await expect(refused("@name->members[org_id=$].person_id")).rejects.toThrow("venues.name is text, not an integer key");
      await expect(refused("members[org_id=@id]{active}.person_id", { org_id: ":org" })).rejects.toThrow("it starts at @id, which the name does not give (its keys: org_id)");
      expect(() => defineDoc("worse:", { root: "venues", include: [], owns: "@org_id->" })).toThrow(`doc "worse:": an empty hop`);
    });

    test("a document with a path needs no owns or shared beside it; one without still does", async () => {
      await expect(backend().start([permissionDocs.post, defineDoc("open:", { root: "orgs", include: [] })])).rejects.toThrow(/"open:"/);
    });
  });
}
