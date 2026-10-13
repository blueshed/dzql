import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PatchOp } from "../../src/json-patch";
import { createServer } from "../../src/server";
import { run } from "../../src/harness";
import { Refusal } from "../../src/refusal";
import { chosenOf, derive, may, related, shape, type Model } from "./model";
import { aliases } from "./cli";
import { stories } from "./stories";
import { example } from "./index";

// A model as the rules see it: two stories, the team (for both) holding Person and Request, the
// inbox (for the second) holding Request with a field the team does not give it.
const leave: Model = {
  name: "Leave",
  stories: [
    { id: "1", text: "Ann asks" },
    { id: "2", text: "Mo approves" },
  ],
  documents: [
    { id: "1", name: "team", holds: { Person: [{ name: "name", type: "text" }], Request: [{ name: "starts", type: "date" }] }, held_by: ["Ann", "Mo"], stories: ["1", "2"] },
    { id: "2", name: "inbox", holds: { Request: [{ name: "starts", type: "text" }, { name: "note", type: "text" }] }, held_by: ["Mo"], stories: ["2", "9"] },
  ],
};

/** What `shape` refuses with, or "" when it refuses nothing. */
const refusal = (m: Model, op: PatchOp): string => {
  try {
    shape(m, [op]);
    return "";
  } catch (err) {
    return (err as Refusal).reason;
  }
};

describe("the model, worked out", () => {
  test("an entity is every document's that holds it, its fields from each, first named first; the gaps are said", () => {
    const d = derive(leave);
    expect(d.entities).toEqual([
      { name: "Person", fields: [{ name: "name", type: "text" }], documents: ["1"] },
      { name: "Request", fields: [{ name: "starts", type: "date" }, { name: "note", type: "text" }], documents: ["1", "2"] },
    ]);
    expect([...d.needed]).toEqual(["1", "2"]);
    expect(d.servedBy("2")).toEqual(["1", "2"]);
    expect(d.serves(leave.documents[1]!)).toEqual(["2"]); // story 9 is not told
    const untold = derive({ ...leave, stories: [leave.stories[0]!] });
    expect([...untold.needed]).toEqual(["1"]);
  });

  test("what goes with what is picked: a story's documents and what they hold; a document's stories; an entity's documents and their stories", () => {
    const d = derive(leave);
    const sets = (c: Parameters<typeof related>[2]) => Object.fromEntries(Object.entries(related(leave, d, c)).map(([k, v]) => [k, [...v].sort()]));
    expect(sets({ k: "story", id: "1" })).toEqual({ stories: ["1"], documents: ["1"], entities: ["Person", "Request"] });
    expect(sets({ k: "document", id: "2" })).toEqual({ stories: ["2"], documents: ["2"], entities: ["Request"] });
    expect(sets({ k: "entity", id: "Person" })).toEqual({ stories: ["1", "2"], documents: ["1"], entities: ["Person"] });
    expect(sets({ k: "entity", id: "Gone" })).toEqual({ stories: [], documents: [], entities: ["Gone"] });
  });

  test("what may be picked: a story, a document or an entity, by its id", () => {
    expect(chosenOf("document:2")).toEqual({ k: "document", id: "2" });
    expect([chosenOf("table:2"), chosenOf("story:"), chosenOf(null), chosenOf(undefined)]).toEqual([undefined, undefined, undefined, undefined]);
  });
});

describe("the model's rules", () => {
  test("a story: added and reworded with its words trimmed, never without them; taken back", () => {
    expect(shape(leave, [{ op: "add", path: "/stories/-", value: " Bo asks " }])).toEqual([{ op: "add", path: "/stories/-", value: { text: "Bo asks" } }]);
    expect(shape(leave, [{ op: "replace", path: "/stories/1/text", value: "Ann asks again" }])).toEqual([{ op: "replace", path: "/stories/1/text", value: "Ann asks again" }]);
    expect(shape(leave, [{ op: "remove", path: "/stories/2" }])).toEqual([{ op: "remove", path: "/stories/2" }]);
    expect(shape(leave, [{ op: "replace", path: "/stories/1", value: "x" }])).toEqual([]);
    expect(refusal(leave, { op: "add", path: "/stories/-", value: 7 })).toBe("A story needs words.");
    expect(refusal(leave, { op: "replace", path: "/stories/1/text", value: " " })).toBe("A story needs words.");
  });

  test("a document: described for a story the model has, renamed, held, for other stories, taken out; what it holds an entity at a time", () => {
    expect(shape(leave, [{ op: "add", path: "/documents/-", value: { name: " calendar ", stories: ["1", "8", 2], held_by: ["Ann", " ", 3] } }])).toEqual([
      { op: "add", path: "/documents/-", value: { name: "calendar", stories: ["1", "2"], holds: {}, held_by: ["Ann", "3"] } },
    ]);
    expect(refusal(leave, { op: "add", path: "/documents/-", value: { name: "notes", stories: ["8"] } })).toBe("A document is for a story: name the one it serves.");
    expect(refusal(leave, { op: "add", path: "/documents/-", value: { stories: ["1"] } })).toBe("A document needs a name.");
    expect(refusal(leave, { op: "add", path: "/documents/-" })).toBe("A document needs a name.");
    expect(shape(leave, [{ op: "replace", path: "/documents/1/name", value: " staff " }])).toEqual([{ op: "replace", path: "/documents/1/name", value: "staff" }]);
    expect(shape(leave, [{ op: "replace", path: "/documents/1/held_by", value: "Ann" }])).toEqual([{ op: "replace", path: "/documents/1/held_by", value: [] }]);
    expect(shape(leave, [{ op: "replace", path: "/documents/1/stories", value: ["2"] }])).toEqual([{ op: "replace", path: "/documents/1/stories", value: ["2"] }]);
    expect(refusal(leave, { op: "replace", path: "/documents/1/stories", value: [] })).toBe("A document is for a story: name the one it serves.");
    expect(shape(leave, [{ op: "remove", path: "/documents/2" }])).toEqual([{ op: "remove", path: "/documents/2" }]);
    const team = leave.documents[0]!.holds;
    expect(shape(leave, [{ op: "replace", path: "/documents/1/holds/Holiday", value: [{ name: "date", type: "date" }, { name: "name" }, { name: " " }, null] }])).toEqual([
      { op: "replace", path: "/documents/1/holds", value: { ...team, Holiday: [{ name: "date", type: "date" }, { name: "name", type: "text" }] } },
    ]);
    expect(shape(leave, [{ op: "replace", path: "/documents/1/holds/Person", value: "name" }])).toEqual([{ op: "replace", path: "/documents/1/holds", value: { ...team, Person: [] } }]);
    expect(shape(leave, [{ op: "remove", path: "/documents/1/holds/Person" }])).toEqual([{ op: "replace", path: "/documents/1/holds", value: { Request: team.Request } }]);
    expect(refusal(leave, { op: "replace", path: "/documents/1/holds/ ", value: [] })).toBe("An entity needs a name.");
  });

  test("what may be written: a story or a document the model has, or a new one, and only their own fields", () => {
    const yes: PatchOp[] = [
      { op: "add", path: "/stories/-" },
      { op: "remove", path: "/stories/1" },
      { op: "replace", path: "/stories/1/text" },
      { op: "add", path: "/documents/-" },
      { op: "remove", path: "/documents/2" },
      { op: "replace", path: "/documents/2/holds/Request" },
      { op: "remove", path: "/documents/2/holds/Request" },
      { op: "replace", path: "/documents/2/name" },
      { op: "replace", path: "/documents/2/held_by" },
      { op: "replace", path: "/documents/2/stories" },
    ];
    const no: PatchOp[] = [
      { op: "replace", path: "/stories/-" },
      { op: "add", path: "/stories/-/text" },
      { op: "remove", path: "/stories/9" },
      { op: "replace", path: "/stories/1" },
      { op: "remove", path: "/stories/1/text" },
      { op: "replace", path: "/stories/1/text/x" },
      { op: "replace", path: "/models/name" },
      { op: "remove", path: "/documents/-" },
      { op: "remove", path: "/documents/9" },
      { op: "replace", path: "/documents/2" },
      { op: "add", path: "/documents/2/holds/Request" },
      { op: "replace", path: "/documents/2/holds" },
      { op: "replace", path: "/documents/2/holds/Request/x" },
      { op: "remove", path: "/documents/2/name" },
      { op: "replace", path: "/documents/2/name/x" },
      { op: "replace", path: "/documents/2/colour" },
    ];
    expect(yes.filter((op) => !may(leave, op))).toEqual([]);
    expect(no.filter((op) => may(leave, op))).toEqual([]);
  });

  test("the CLI's verbs are writes to the model, and nothing else", () => {
    expect(aliases.story!(["Bo", "asks"])).toEqual({ doc: "model", ops: [{ op: "add", path: "/stories/-", value: "Bo asks" }] });
    expect(aliases.reword!(["1", "Ann", "asks"])).toEqual({ doc: "model", ops: [{ op: "replace", path: "/stories/1/text", value: "Ann asks" }] });
    expect(aliases.unsay!(["2"])).toEqual({ doc: "model", ops: [{ op: "remove", path: "/stories/2" }] });
    expect(aliases.document!(["calendar", "1", "3"])).toEqual({ doc: "model", ops: [{ op: "add", path: "/documents/-", value: { name: "calendar", stories: ["1", "3"] } }] });
    expect(aliases.holds!(["1", "Request", "starts:date", "status"])).toEqual({ doc: "model", ops: [{ op: "replace", path: "/documents/1/holds/Request", value: [{ name: "starts", type: "date" }, { name: "status", type: "text" }] }] });
    expect(aliases.unhold!(["1", "Request"])).toEqual({ doc: "model", ops: [{ op: "remove", path: "/documents/1/holds/Request" }] });
    expect(aliases.heldby!(["1", "Ann", "Bo"])).toEqual({ doc: "model", ops: [{ op: "replace", path: "/documents/1/held_by", value: ["Ann", "Bo"] }] });
    expect(aliases.serves!(["1", "1", "2"])).toEqual({ doc: "model", ops: [{ op: "replace", path: "/documents/1/stories", value: ["1", "2"] }] });
    expect(aliases.rename!(["1", "the", "team"])).toEqual({ doc: "model", ops: [{ op: "replace", path: "/documents/1/name", value: "the team" }] });
    expect(aliases.drop!(["2"])).toEqual({ doc: "model", ops: [{ op: "remove", path: "/documents/2" }] });
  });
});

describe("modeling, served", () => {
  let server: ReturnType<typeof createServer>;
  beforeAll(() => {
    server = createServer(example, 0);
  });
  afterAll(() => {
    server.stop(true);
  });

  /** Posts the sign-in form, as a browser does: the answer, and the session its cookie names. */
  async function signIn(email: string, password: string, headers: Record<string, string> = {}): Promise<{ res: Response; sessionId?: string }> {
    const res = await fetch(new URL("/login", server.url), { method: "POST", body: new URLSearchParams({ email, password }), redirect: "manual", headers });
    return { res, sessionId: /session_id=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] };
  }

  /** A tab on a session: every message it is sent, and the inspect that says the server is done. */
  async function tab(sessionId: string) {
    const url = new URL("/ws", server.url);
    url.protocol = "ws:";
    // @ts-expect-error Bun's runtime-only `headers` option on WebSocket
    const ws: WebSocket = new WebSocket(url, { headers: { Cookie: `session_id=${sessionId}` } });
    const inbox: { type: string; html?: string; ops?: PatchOp[] }[] = [];
    const answered: (() => void)[] = [];
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === "inspect") return answered.shift()?.();
      inbox.push(message);
    });
    await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
    /** Sends `ops` to the session, and what came back for them. */
    const send = async (ops: PatchOp[]) => {
      inbox.length = 0;
      ws.send(JSON.stringify({ id: 1, doc: "session", ops }));
      ws.send(JSON.stringify({ type: "inspect" }));
      await new Promise<void>((resolve) => answered.push(resolve));
      return inbox.map((m) => m.type);
    };
    await send([]);
    return { ws, send };
  }

  test("signing in: only by the form, from this site, with a password that matches the email", async () => {
    expect((await fetch(new URL("/login", server.url), { redirect: "manual" })).headers.get("location")).toBe("/");
    expect((await signIn("peter@modeling.example", "peter-password", { origin: "https://elsewhere.example" })).res.status).toBe(403);
    expect((await signIn("peter@modeling.example", "wrong")).sessionId).toBeUndefined();
    expect((await signIn("nobody@modeling.example", "peter-password", { cookie: "session_id=a-visit" })).sessionId).toBeUndefined();
    expect((await signIn(" Peter@Modeling.example ", "peter-password")).sessionId).toBeString();
  });

  test("a session picks, picks again to put it down, and signs out; it never says who it is", async () => {
    const { sessionId } = await signIn("peter@modeling.example", "peter-password");
    const { ws, send } = await tab(sessionId!);
    expect(await send([{ op: "replace", path: "/chosen", value: "story:1" }])).toEqual(["patch", "render"]);
    expect(await send([{ op: "replace", path: "/chosen", value: "story:1" }])).toEqual(["patch", "render"]); // put down
    expect(await send([{ op: "remove", path: "/chosen" }])).toEqual(["refused"]); // nothing to put down
    expect(await send([{ op: "replace", path: "/chosen", value: "table:1" }])).toEqual(["refused"]);
    expect(await send([{ op: "replace", path: "/person_id", value: "2" }])).toEqual(["refused"]);
    expect(await send([{ op: "remove", path: "/person_id" }])).toContain("patch");
    expect(await send([{ op: "replace", path: "/chosen", value: "story:1" }])).toEqual(["refused"]); // signed out
    ws.close();
  });

  test("every story passes", async () => {
    const report = await run(example, stories);
    expect(report.outcomes.filter((o) => o.failures.length > 0).map((o) => [o.name, o.failures])).toEqual([]);
  }, 60000);
});
