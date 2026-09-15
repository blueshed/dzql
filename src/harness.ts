import { db } from "./db";
import type { Example } from "./example";
import { assemble } from "./compartments";
import { createServer } from "./server";
import type { Stories, Story, Write } from "./stories";

// Runs an example's stories against it, over real sockets, and reports by story name. See
// stories.md ("The harness"). Canon 1 is checked here: for every member of the cast, a fresh
// render from the tables before and after the story, compared -- so a change that reaches a page
// through an applet's patch (a tick) counts the same as one that reaches it as HTML. A member a
// story says sees it on a page is put on that page first (`Stories.page`), since a person sees
// only the page they are on. Then the story is undone and redone as its author, and the pages
// must go back and forth with it; a write the ledger calls a fact (undoable = 0) must survive its
// undo instead, and an author the example no longer counts as active (logged out) gets no undo.
// A `cannot` must change no page and add nothing to the ledger. Each story runs inside one
// database transaction that is rolled back afterwards, so every story starts from the cast alone.

export type Outcome = { name: string; failures: string[] };
export type Report = { outcomes: Outcome[]; passed: number; failed: number };

type Member = { name: string; sessionId: string; ws: WebSocket; inbox: string[]; last: number };
type Snapshot = Map<string, string>;

const SETTLE_MS = Number(process.env.STORY_SETTLE_MS ?? 40);
const SETTLE_CAP_MS = 2000;

const ledgerMaxStmt = db.query<{ id: number | null }, []>("SELECT MAX(id) AS id FROM ledger");
const ledgerSinceStmt = db.query<{ id: number; doc: string; undoable: number }, [number]>("SELECT id, doc, undoable FROM ledger WHERE id > ? ORDER BY id");

const UNDO: Write = { doc: "ledger", ops: [{ op: "remove", path: "/latest" }] };
const REDO: Write = { doc: "ledger", ops: [{ op: "add", path: "/latest" }] };

function ledgerMax(): number {
  return ledgerMaxStmt.get()?.id ?? 0;
}

export async function run(example: Example, stories: Stories): Promise<Report> {
  const server = createServer(example, 0);
  const { renderFor } = assemble(example);
  const outcomes: Outcome[] = [];

  function snapshot(cast: Member[]): Snapshot {
    return new Map(cast.map((m) => [m.name, renderFor(m.sessionId)]));
  }

  async function connect(name: string): Promise<Member> {
    const url = new URL("/ws", server.url);
    url.protocol = "ws:";
    const sessionId = crypto.randomUUID();
    // @ts-expect-error Bun's runtime-only `headers` option on WebSocket
    const ws: WebSocket = new WebSocket(url, { headers: { Cookie: `session_id=${sessionId}` } });
    const member: Member = { name, sessionId, ws, inbox: [], last: Date.now() };
    ws.addEventListener("message", (event) => {
      member.inbox.push(String(event.data));
      member.last = Date.now();
    });
    await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
    return member;
  }

  /** Waits until no member has heard anything for SETTLE_MS: everything a write causes is synchronous on the server, so this is the wire going quiet. */
  async function settle(cast: Member[]): Promise<void> {
    const start = Date.now();
    for (;;) {
      const quietFor = Date.now() - Math.max(...cast.map((m) => m.last));
      if (quietFor >= SETTLE_MS || Date.now() - start > SETTLE_CAP_MS) return;
      await Bun.sleep(SETTLE_MS - quietFor);
    }
  }

  async function send(cast: Member[], who: Member, write: Write): Promise<void> {
    who.last = Date.now();
    who.ws.send(JSON.stringify(write));
    await settle(cast);
  }

  function differs(a: Snapshot, b: Snapshot, name: string): boolean {
    return a.get(name) !== b.get(name);
  }

  function compare(a: Snapshot, b: Snapshot, cast: Member[], what: string, failures: string[]): void {
    for (const m of cast) if (differs(a, b, m.name)) failures.push(`${what}: ${m.name}'s page differs${excerpt(a.get(m.name)!, b.get(m.name)!)}`);
  }

  async function tell(story: Story): Promise<Outcome> {
    const failures: string[] = [];
    db.exec("BEGIN");
    const cast: Member[] = [];
    try {
      for (const name of Object.keys(stories.cast)) cast.push(await connect(name));
      await settle(cast);
      for (const m of cast) for (const write of stories.cast[m.name]!) await send(cast, m, write);

      const who = cast.find((m) => m.name === story.as);
      if (!who) return { name: story.name, failures: [`no one in the cast is called ${story.as}`] };

      if ("cannot" in story) {
        const before = snapshot(cast);
        const ledgerBefore = ledgerMax();
        await send(cast, who, story.cannot);
        compare(before, snapshot(cast), cast, "refused, but", failures);
        if (ledgerMax() !== ledgerBefore) failures.push("refused, but the ledger moved");
        return { name: story.name, failures };
      }

      // Who should notice, and where: a list leaves them where the cast put them; a record puts
      // each where it says, in the example's own grammar for "where" (`Stories.at`).
      const seen = new Map<string, string | undefined>(Array.isArray(story.seen) ? story.seen.map((n) => [n, undefined]) : Object.entries(story.seen));
      for (const [name, where] of seen) {
        const m = cast.find((c) => c.name === name);
        if (!m) failures.push(`no one in the cast is called ${name}`);
        else if (where !== undefined && stories.at) await send(cast, m, stories.at(where));
      }

      const before = snapshot(cast);
      const ledgerBefore = ledgerMax();
      who.inbox.length = 0;
      await send(cast, who, story.does);
      if (process.env.STORY_TRACE) for (const raw of who.inbox) console.log(`        ${who.name} heard: ${raw.slice(0, 160)}`);
      const after = snapshot(cast);
      const entries = ledgerSinceStmt.all(ledgerBefore);

      // Only what the story says is asked: `seen` must notice, `unseen` must not; anyone in
      // neither is left alone (a home page with counts on it changes for many reasons).
      for (const m of cast) {
        if (seen.has(m.name)) {
          if (!differs(before, after, m.name)) failures.push(`${m.name} did not see it${where(seen.get(m.name))}`);
        } else if (story.unseen?.includes(m.name) && differs(before, after, m.name)) failures.push(`${m.name} noticed, and should not have`);
      }

      if (entries.length === 0) return { name: story.name, failures }; // off the ledger: nothing to undo
      if (!example.active(who.sessionId)) return { name: story.name, failures }; // the author has gone (logged out): no undo is theirs to press

      const facts = entries.every((e) => e.undoable === 0);
      await send(cast, who, UNDO);
      const afterUndo = snapshot(cast);
      if (facts) compare(after, afterUndo, cast, "a fact, yet undo changed it", failures);
      else {
        compare(before, afterUndo, cast, "undo did not restore", failures);
        await send(cast, who, REDO);
        compare(after, snapshot(cast), cast, "redo did not restore", failures);
      }
      return { name: story.name, failures };
    } finally {
      for (const m of cast) m.ws.close();
      await Promise.all(cast.map((m) => new Promise((resolve) => (m.ws.readyState === WebSocket.CLOSED ? resolve(undefined) : m.ws.addEventListener("close", resolve, { once: true })))));
      await Bun.sleep(SETTLE_MS);
      db.exec("ROLLBACK");
    }
  }

  try {
    const only = process.env.STORY; // run only the stories whose name contains this
    for (const story of stories.stories) if (!only || story.name.includes(only)) outcomes.push(await tell(story));
  } finally {
    server.stop(true);
  }
  const failed = outcomes.filter((o) => o.failures.length > 0).length;
  return { outcomes, passed: outcomes.length - failed, failed };
}

export function print(report: Report): void {
  for (const o of report.outcomes) {
    console.log(`${o.failures.length ? "FAIL" : " ok "}  ${o.name}`);
    for (const f of o.failures) console.log(`        ${f}`);
  }
  console.log(`\n${report.passed} passed, ${report.failed} failed`);
}

function where(page: string | undefined): string {
  return page === undefined ? "" : ` on ${JSON.stringify(page)}`;
}

/** With STORY_DIFF set, where two pages first part company -- for the builder, not the report. */
function excerpt(a: string, b: string): string {
  if (!process.env.STORY_DIFF) return "";
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const from = Math.max(0, i - 40);
  return `\n          expected …${a.slice(from, i + 80)}…\n          got      …${b.slice(from, i + 80)}…`;
}
