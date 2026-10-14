import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { signIn } from "../../../src/cli/commands";
import { assemble } from "../../../src/compartments";
import { db } from "../../../src/db";
import { createServer } from "../../../src/server";
import { connect, opened } from "../../../src/test-socket";
import type { Raw } from "../heart";
import { example } from "../index";
import { extract } from "./extract";
import { built, format, gaps, readPage, told } from "./told";
import { said, send, writesOf, type Load } from "./writes";

const field = (name: string, type = "text") => ({ name, type });

describe("the model as told, against the model as built", () => {
  // Told on the page: two stories and the team; built: one of them retold, one new, the team held and holding otherwise, and a board.
  const page: Raw = {
    models: { name: "Leave" },
    stories: {
      "1": { id: 1, text: "Ann asks for a week off.", actor: "ann", kind: "does" },
      "2": { id: 2, text: "Ann cannot approve her own", actor: "ann", kind: "cannot" },
    },
    documents: {
      "1": { id: 1, name: "team", root: "teams", own: 0, holds: { teams: { parent: null, fields: [field("name")] }, requests: { parent: "teams", fields: [field("starts", "date"), field("status")] }, notes: { parent: "teams", fields: [] } }, held_by: ["ann", "mo"], stories: [1, "2", "9"] },
      "2": { id: 2, name: "inbox", root: "requests", holds: {}, stories: [] },
    },
  };
  const app: Load = {
    stories: [
      { text: "ann  asks for a week off", actor: "ann", kind: "does", touches: [] },
      { text: "Ann cannot approve her own", actor: "bo", kind: "does", touches: [] },
      { text: "Mo approves", actor: "mo", kind: "does", touches: [] },
    ],
    documents: [
      { name: "team", root: "teams", own: true, held_by: ["mo", "ann", "bo"], serves: [0, 2], fields: [field("name")], holds: [{ entity: "requests", under: "people", fields: [field("starts"), field("ends")] }, { entity: "people", under: "teams", fields: [] }] },
      { name: "board", root: "boards", own: false, held_by: [], serves: [2], fields: [], holds: [] },
    ],
    skipped: [],
  };

  test("stories by their words, documents by their names: each gap a question for the teller", () => {
    expect(gaps(told(page), built(app))).toEqual([
      `"Ann cannot approve her own" was told as ann cannot, and is built as bo does: which is it?`,
      `"Mo approves" the app tells, and it was never told: was it meant?`,
      `team is shared as told, each person's own as built: which is it?`,
      `team is held by ann, mo as told, by ann, bo, mo as built: who holds it?`,
      `team's requests hangs under teams as told, under people as built: which is it?`,
      `team's requests has starts, status as told, starts, ends as built: which fields?`,
      `team holds notes as told, and the app does not: still wanted?`,
      `team holds people as built, and it was never told: was it meant?`,
      `team serves "Ann cannot approve her own" as told, and not as built: still wanted?`,
      `inbox was told, and the app has no such document: still wanted?`,
      `board the app has, and it was never told: was it meant?`,
    ]);
    const lost = { ...page, stories: { ...page.stories, "3": { id: 3, text: "Bo signs in", actor: "visitor", kind: "does" } } };
    expect(gaps(told(lost), built(app))).toContain(`"Bo signs in" was told, and the app does not tell it: still wanted?`);
    const moved = { ...page, documents: { "1": { ...page.documents!["1"]!, root: "people" } } };
    expect(gaps(told(moved), built(app))).toContain(`team is rooted at people as told, at teams as built: which is it?`);
    expect(gaps(told({ models: { name: "Empty" } }), built({ stories: [], documents: [{ ...app.documents[1]!, serves: [] }], skipped: [] }))).toEqual([`board the app has, and it was never told: was it meant?`]);
    expect(gaps(told({ models: { name: "Empty" }, documents: { "1": { id: 1, name: "board", root: "boards", holds: { boards: { parent: null, fields: [] } } } } }), built({ stories: [], documents: [{ ...app.documents[1]!, own: true, serves: [] }], skipped: [] }))).toEqual([`board is shared as told, each person's own as built: which is it?`]);
  });

  test("the report: the gaps, or that there are none", () => {
    expect(format("leave", ["a?", "b?"])).toBe("# leave: as told on the model page, as built\n\n2 gaps\n\n- a?\n- b?");
    expect(format("leave", ["a?"])).toBe("# leave: as told on the model page, as built\n\n1 gap\n\n- a?");
    expect(format("leave", [])).toBe("# leave: as told on the model page, as built\n\nNo gaps: the app is the model as told.");
  });
});

describe("Peter tells leave's stories on the model page and Claude builds leave; model:check leave --against-page names each gap", () => {
  let load: Load;
  let server: ReturnType<typeof createServer>;
  let session: string;
  let url: string;
  beforeAll(async () => {
    load = writesOf((await extract("leave")).heart);
    server = createServer(example, 0);
    url = server.url.href.replace(/^http/, "ws");
    session = (await signIn(url, { email: "claude@modeling.example", password: "claude-password" }))!;
    db.exec("BEGIN"); // the seeded model comes back after
  }, 60000);
  afterAll(async () => {
    await server.idle();
    db.exec("ROLLBACK");
    await assemble(example).documents.release(new Set());
    server.stop(true);
  });

  // writes.test.ts's, here so leave's stories are run once: what loading leave writes
  test("leave: its 23 stories, the team and each person's session, as the model's seed has them by hand", () => {
    expect(load.stories).toHaveLength(23);
    expect(load.stories[0]).toEqual({ text: "Ann drags across two days in Bo's week, and sees the clash before she asks", actor: "ann", kind: "does", touches: ["sessions"] });
    expect(load.stories[20]).toMatchObject({ actor: "visitor", kind: "does", post: "/login" });
    expect(load.stories[2]!.kind).toBe("cannot");
    const [team, session] = load.documents;
    expect(team).toMatchObject({ name: "team", root: "teams", own: false, held_by: ["ann", "bo", "mo"], serves: [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18], fields: [{ name: "name", type: "text" }] });
    expect(team!.holds.map((h) => [h.entity, h.under])).toEqual([["people", "teams"], ["requests", "teams"]]);
    expect(team!.holds[1]!.fields.map((f) => f.name)).toEqual(["person_id", "starts", "ends", "status", "answered_by"]);
    expect(session).toMatchObject({ name: "session", root: "sessions", own: true, serves: [0, 2, 19, 22], holds: [] });
    expect(load.skipped).toEqual([]);
  });

  test("leave loaded into an empty model reads back with no gaps; one story's teller and one document's holders changed on the page, exactly those two show", async () => {
    const ws = connect({ url }, session);
    await opened(ws);
    const seeded = await readPage(url, session);
    for (const id of Object.keys(seeded.documents ?? {})) await said(ws, [{ op: "remove", path: `/documents/${id}` }]);
    for (const id of Object.keys(seeded.stories ?? {})) await said(ws, [{ op: "remove", path: `/stories/${id}` }]);
    await send(ws, load);
    const loaded = await readPage(url, session);
    expect(gaps(told(loaded), built(load))).toEqual([]);

    const [id, story] = Object.entries(loaded.stories!).find(([, s]) => s.text.startsWith("Mo approves Bo's week"))!;
    const [team] = Object.entries(loaded.documents!).find(([, d]) => d.name === "team")!;
    await said(ws, [{ op: "replace", path: `/stories/${id}/actor`, value: "ann" }]);
    await said(ws, [{ op: "replace", path: `/documents/${team}/held_by`, value: ["ann", "mo"] }]);
    const saved = `${process.env.TMPDIR ?? "/tmp"}/told-${crypto.randomUUID()}.json`;
    await Bun.write(saved, JSON.stringify(await readPage(url, session)));
    expect(gaps(told(await Bun.file(saved).json()), built(load))).toEqual([
      `"${story.text}" was told as ann does, and is built as mo does: which is it?`,
      `team is held by ann, mo as told, by ann, bo, mo as built: who holds it?`,
    ]);
    await Bun.file(saved).delete();

    await expect(said(ws, [{ op: "add", path: "/stories/-", value: { text: " ", actor: "ann" } }])).rejects.toThrow("refused: A story needs words.");
    ws.close();
  }, 60000);

  test("signed out, the page holds no model to read; and where no page is served, there is nothing to read", async () => {
    await expect(readPage(url, "a-visit")).rejects.toThrow("No model on the page: sign in first");
    await expect(readPage("ws://localhost:1", session)).rejects.toThrow("No model page at ws://localhost:1: is it running?");
  });
});
