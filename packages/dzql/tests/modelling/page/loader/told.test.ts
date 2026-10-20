import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sessionIn } from "dzql/rendering/scope";
import { links } from "../../../../src/modelling/page/signin";
import { assemble } from "dzql/rendering/resources/index";
import { db } from "dzql/rendering/db";
import { createServer } from "dzql/rendering/server";
import { connect, opened } from "dzql/rendering/test-socket";
import type { Raw } from "../../../../src/modelling/page/heart";
import { app as example } from "../../../../src/modelling/page/routes";
import { extract } from "../../../../src/modelling/page/loader/extract";
import { built, format, gaps, matched, readPage, told } from "../../../../src/modelling/page/loader/told";
import { said, send, writesOf, type Load } from "../../../../src/modelling/page/loader/writes";

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
    // each person's own is the app's session: what it keeps beside the told fields is the app's, and only a told field missing is a gap (cafe-d's feedback)
    const seat = (fields: string[]) => built({ stories: [], documents: [{ name: "seat", root: "sessions", own: true, held_by: [], serves: [], fields: fields.map((n) => field(n)), holds: [] }], skipped: [] });
    const told_ = told({ models: { name: "Cafe" }, documents: { "1": { id: 1, name: "seat", root: "sessions", own: 1, holds: { sessions: { parent: null, fields: [field("table")] } } } } });
    expect(gaps(told_, seat(["table", "role", "page"]))).toEqual([]);
    expect(gaps(told_, seat(["role"]))).toEqual(["seat's sessions has table as told, role as built: which fields?"]);
    // the model's tellers are roles, the cast people: holders compared as the roles they play; the own document found by its root under the app's own name
    const cafe = told({ models: { name: "Cafe" }, stories: { "1": { id: 1, text: "The manager seats a table", actor: "manager", kind: "does" } }, documents: { "1": { id: 1, name: "floor", root: "tables", holds: { tables: { parent: null, fields: [] } }, held_by: ["manager"], stories: [1] }, "2": { id: 2, name: "visit", root: "visits", own: 1, holds: { visits: { parent: null, fields: [] } } } } });
    const app_ = built({ stories: [{ text: "Mo seats table 1", actor: "mo", kind: "does", touches: [], model: 1 } as never], documents: [{ name: "floor", root: "tables", own: false, held_by: ["mo"], serves: [0], fields: [], holds: [] }, { name: "session", root: "visits", own: true, held_by: [], serves: [], fields: [], holds: [] }], skipped: [] });
    expect(gaps(cafe, app_)).toEqual([]);
  });

  test("an app story that names the model story it tells (`model: 2`) matches it though the words and the teller differ; one that names none goes by its words", () => {
    const general: Raw = {
      models: { name: "Cafe" },
      stories: {
        "1": { id: 1, text: "A customer orders a coffee", actor: "customer", kind: "does" },
        "2": { id: 2, text: "A customer cannot order onto a bill that is paid", actor: "customer", kind: "cannot" },
        "3": { id: 3, text: "Staff close the till", actor: "staff", kind: "does" },
      },
      documents: { "1": { id: 1, name: "bill", root: "bills", own: 0, holds: { bills: { parent: null, fields: [] } }, held_by: ["customer"], stories: [1, 2] } },
    };
    const cast: Load = {
      stories: [
        { text: "Ann orders a flat white", actor: "ann", kind: "does", model: 1, touches: [] },
        { text: "Ann cannot order onto a paid bill", actor: "ann", kind: "does", model: 2, touches: [] },
        { text: "Staff close the till", actor: "staff", kind: "does", touches: [] },
        { text: "Bo pays for Ann", actor: "bo", kind: "does", model: 9, touches: [] },
      ],
      documents: [{ name: "bill", root: "bills", own: false, held_by: ["customer"], serves: [0, 1], fields: [], holds: [] }],
      skipped: [],
    };
    const [t, b] = [told(general), built(cast)];
    expect(gaps(t, b)).toEqual([
      `"Bo pays for Ann" tells model story 9, and the page has no story 9: which does it tell?`,
      `"A customer cannot order onto a bill that is paid" was told as customer cannot, and is built as ann does: which is it?`,
      `"Bo pays for Ann" the app tells, and it was never told: was it meant?`,
    ]);
    expect(matched(t, b)).toEqual({ number: ["1", "2"], words: ["3"] });
    expect(format("cafe", [], matched(t, b))).toBe("# cafe: as told on the model page, as built\n\nStories matched by the model story they name: 1 and 2; by their words: 3.\n\nNo gaps: the app is the model as told.");
    expect(format("cafe", [], { number: [], words: ["3"] })).toBe("# cafe: as told on the model page, as built\n\nStories matched by their words: 3.\n\nNo gaps: the app is the model as told.");
    expect(format("cafe", ["a?"], { number: [], words: [] })).toBe("# cafe: as told on the model page, as built\n\n1 gap\n\n- a?");
  });

  test("the report: the gaps, or that there are none", () => {
    expect(format("leave", ["a?", "b?"])).toBe("# leave: as told on the model page, as built\n\n2 gaps\n\n- a?\n- b?");
    expect(format("leave", ["a?"])).toBe("# leave: as told on the model page, as built\n\n1 gap\n\n- a?");
    expect(format("leave", [])).toBe("# leave: as told on the model page, as built\n\nNo gaps: the app is the model as told.");
  });
});

describe("Peter tells leave's stories on the model page and Claude builds leave; model:check leave --against-page names each gap", () => {
  let load: Load;
  let server: Awaited<ReturnType<typeof createServer>>;
  let session: string;
  let url: string;
  beforeAll(async () => {
    load = writesOf((await extract("leave")).heart);
    server = await createServer(example, 0);
    url = `${server.url.href.replace(/^http/, "ws")}model`; // the model is a route of its own, at /model
    session = sessionIn((await fetch(links.say(server.url.origin)[1]!.slice("Claude: ".length), { redirect: "manual" })).headers.get("set-cookie"))!; // Claude's link
    db.exec("BEGIN"); // the seeded model comes back after
  }, 60000);
  afterAll(async () => {
    await server.idle();
    db.exec("ROLLBACK");
    await assemble(example).documents.release(new Set());
    server.stop(true);
  });

  // writes.test.ts's, here so leave's stories are run once: what loading leave writes
  test("leave: every story, the team and each person's session, as the model's seed has them by hand", async () => {
    const { stories } = await import("../../../../examples/leave/stories"); // leave's own, so a story added there moves nothing here
    expect(load.stories.map((s) => s.text)).toEqual(Object.values(stories.stories).map((s) => s.name));
    expect(load.stories.find((s) => s.post === "/login")).toMatchObject({ actor: "visitor", kind: "does" });
    expect(load.stories.some((s) => s.kind === "cannot")).toBe(true);
    const at = (start: string) => load.stories.findIndex((s) => s.text.startsWith(start));
    const [team, session] = ["team", "session"].map((name) => load.documents.find((d) => d.name === name)); // read in the order of its resources' folders
    expect(team).toMatchObject({ name: "team", root: "teams", own: false, held_by: ["ann", "bo", "mo"], fields: [{ name: "name", type: "text" }] });
    expect(team!.serves).toContain(at("Ann asks for her draft, and Mo and Bo see it"));
    expect(team!.holds.map((h) => [h.entity, h.under])).toEqual([["people", "teams"], ["requests", "teams"]]);
    expect(team!.holds[1]!.fields.map((f) => f.name)).toEqual(expect.arrayContaining(["person_id", "starts", "ends", "status", "answered_by"]));
    expect(session).toMatchObject({ name: "session", root: "sessions", own: true, holds: [] });
    expect(session!.serves).toContain(at("Ann drags across two days in Bo's week"));
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
