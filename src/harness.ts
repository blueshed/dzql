import { db } from "./db";
import type { Example } from "./example";
import { assemble } from "./compartments";
import { createServer } from "./server";
import type { Stories, Story, Write } from "./stories";
import { applyPatch, type PatchOp } from "./json-patch";
import { settled } from "./documents";
import { comparable, splitTag } from "./parts";

export { comparable };

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
//
// Canon 2 is checked here too, without a browser: every member's open page is kept as the client
// would keep it -- a full render replaces it, a fragment render is applied target by target -- and
// after the story, its undo and its redo, that page must equal a fresh render. So a write that
// reaches the tables but not someone's open page fails, by name. An applet that takes its
// document's patches itself (`data-doc`) is compared without its props: they follow the patches,
// not the renders. What the morph does with the HTML is the browser tests' to check.

export type Outcome = { name: string; failures: string[] };

/** One write in a story's run, as the wire carried it: who sent what, what every member heard, and what the ledger took. For a sequence drawn from a real run. */
export type Trace = {
  story: string;
  phase: "does" | "cannot" | "undo" | "redo";
  as: string;
  write: Write;
  heard: { member: string; messages: Heard[] }[];
  ledger: { doc: string; undoable: number }[];
};
export type Report = { outcomes: Outcome[]; passed: number; failed: number };

type Member = { name: string; sessionId: string; ws: WebSocket; inbox: string[]; page: string; taken: Map<string, Taken>; answered: (() => void)[] };
type HtmlOp = { op: "replace" | "tag" | "after" | "before" | "remove"; target: string; html?: string };
type Snapshot = Map<string, string>;


type LedgerRow = { id: number; doc: string; undoable: number };

/**
 * The ledger the stories read, to know whether a story has an undo to check and whether a refusal
 * moved nothing: delta's (`delta_ledger`, in the same database), whose fresh entries -- not an
 * undo's or a redo's -- a story's write starts.
 */
function ledgerOf(): { max(): number; since(id: number): LedgerRow[] } {
  const max = db.query<{ id: number | null }, []>("SELECT MAX(id) AS id FROM delta_ledger");
  const since = db.query<LedgerRow, [number]>("SELECT id, doc, undoable FROM delta_ledger WHERE id > ? AND undoes IS NULL ORDER BY id");
  return { max: () => max.get()?.id ?? 0, since: (id) => since.all(id) };
}

const UNDO: Write = { doc: "ledger", ops: [{ op: "remove", path: "/latest" }] };
const REDO: Write = { doc: "ledger", ops: [{ op: "add", path: "/latest" }] };

/** One fragment op applied to a page as the client applies it: the first element the selector names is replaced, put beside, or removed, or given a new opening tag. */
function applyOp(page: string, op: HtmlOp): string {
  if (op.op === "tag") {
    // the part's opening tag, swapped as text, so the page reads exactly as a fresh render would
    const at = page.indexOf(op.target.slice(1, -1)); // `data-eta-part="<key>"`, as the tag carries it
    if (at < 0) return page;
    const start = page.lastIndexOf("<", at);
    const [old] = splitTag(page.slice(start));
    return page.slice(0, start) + op.html! + page.slice(start + old.length);
  }
  let done = false;
  return new HTMLRewriter()
    .on(op.target, {
      element(el) {
        if (done) return;
        done = true;
        if (op.op === "replace") el.replace(op.html!, { html: true });
        else if (op.op === "after") el.after(op.html!, { html: true });
        else if (op.op === "before") el.before(op.html!, { html: true });
        else el.remove();
      },
    })
    .transform(page);
}

export type Heard = { type: string; html?: string; ops?: HtmlOp[]; doc?: string };

// The patch stream, checked. An applet that takes a document's patches (`data-doc`) holds props: the
// ones the last render gave it, with every patch for that document laid on since, at the place in
// its props the document sits (`data-at`, the root by default). That is what the client's applet
// holds, and it must be what a fresh render would give it -- or the ops did not say everything the
// document did, or props that changed for another reason were never sent.

/** An applet that takes a document's patches, as a member's page holds it. */
type Taken = { applet: string; doc: string; at: string; props: string; ops: PatchOp[] };

const unescape = (value: string): string => value.replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");

/** The applets on a page that take a document's patches, by their id (or part, or place). */
export function takersOn(page: string): Map<string, Omit<Taken, "ops">> {
  const found = new Map<string, Omit<Taken, "ops">>();
  new HTMLRewriter()
    .on("[data-doc]", {
      element(el) {
        const applet = el.getAttribute("data-applet") ?? "";
        const key = el.getAttribute("id") ?? el.getAttribute("data-eta-part") ?? `${applet}#${found.size}`;
        found.set(key, { applet, doc: el.getAttribute("data-doc")!, at: el.getAttribute("data-at") ?? "", props: unescape(el.getAttribute("data-props") ?? "null") });
      },
    })
    .transform(page);
  return found;
}

/** A member's applets after a render: one whose props the render changed starts again from them; one it left alone keeps the ops it has taken. */
export function retake(taken: Map<string, Taken>, page: string): void {
  const now = takersOn(page);
  for (const key of taken.keys()) if (!now.has(key)) taken.delete(key);
  for (const [key, a] of now) {
    const held = taken.get(key);
    if (!held || held.props !== a.props || held.doc !== a.doc || held.at !== a.at) taken.set(key, { ...a, ops: [] });
  }
}

/** JSON with its keys in order, so two values compare by what they hold. */
const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));

/** Where what a member's applets hold is not what a fresh page gives them: a failure each, begun with `whose`. */
export function unheld(whose: string, taken: Map<string, Taken>, freshPage: string): string[] {
  const failures: string[] = [];
  const fresh = takersOn(freshPage);
  for (const [key, t] of taken) {
    const f = fresh.get(key);
    if (!f || f.doc !== t.doc) continue; // not on the fresh page: the page's own comparison says so
    const now = holding(t);
    if ("error" in now) failures.push(`${whose} ${t.applet} was sent ${t.doc} ops that do not land on its props: ${now.error}`);
    else if (stable(now.value) !== stable(JSON.parse(f.props))) failures.push(`${whose} ${t.applet} holds what a fresh render does not${excerpt(stable(JSON.parse(f.props)), stable(now.value))}`);
  }
  return failures;
}

/** What an applet holds now: its props with the ops it has taken laid on; or why the ops do not land. */
export function holding(t: Taken): { value: unknown } | { error: string } {
  try {
    return { value: applyPatch(JSON.parse(t.props), t.ops.map((op) => ({ ...op, path: t.at + op.path }))) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** A member's open page after one more message: only renders change it. */
export function hear(page: string, message: Heard): string {
  if (message.type !== "render") return page;
  if (message.html !== undefined) return message.html;
  return (message.ops ?? []).reduce(applyOp, page);
}



export async function run(example: Example, stories: Stories, observe?: (trace: Trace) => void): Promise<Report> {
  const server = createServer(example, 0);
  const { draw, documents } = assemble(example);
  const active = (sessionId: string): Promise<boolean> => settled(documents, () => example.active(sessionId));
  const ledger = ledgerOf();
  const ledgerMax = ledger.max;
  const outcomes: Outcome[] = [];

  async function snapshot(cast: Member[]): Promise<Snapshot> {
    return new Map(await Promise.all(cast.map(async (m) => [m.name, await draw(m.sessionId)] as const)));
  }

  async function connect(name: string): Promise<Member> {
    const url = new URL("/ws", server.url);
    url.protocol = "ws:";
    const sessionId = crypto.randomUUID();
    // @ts-expect-error Bun's runtime-only `headers` option on WebSocket
    const ws: WebSocket = new WebSocket(url, { headers: { Cookie: `session_id=${sessionId}` } });
    const member: Member = { name, sessionId, ws, inbox: [], page: "", taken: new Map(), answered: [] };
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as Heard;
      if (message.type === "inspect") return member.answered.shift()?.();
      member.inbox.push(String(event.data));
      member.page = hear(member.page, message);
      if (message.type === "render") retake(member.taken, member.page);
      if (message.type === "patch") for (const t of member.taken.values()) if (t.doc === message.doc) t.ops.push(...(message.ops as unknown as PatchOp[]));
    });
    await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
    return member;
  }

  /**
   * Waits until every member has heard everything sent so far. Everything a write causes is
   * synchronous on the server, and a socket delivers in order: so each member is asked a question
   * (`inspect`) after the write, and once each has its answer, each has had all that came before
   * it. No clock: a render that is slow to make is still waited for.
   */
  async function settle(cast: Member[]): Promise<void> {
    await Promise.all(
      cast.map((m) => new Promise<void>((resolve) => {
        m.answered.push(resolve);
        m.ws.send(JSON.stringify({ type: "inspect" }));
      })),
    );
  }

  async function send(cast: Member[], who: Member, write: Write): Promise<void> {
    who.ws.send(JSON.stringify(write));
    await settle(cast);
  }

  function differs(a: Snapshot, b: Snapshot, name: string): boolean {
    return a.get(name) !== b.get(name);
  }

  function compare(a: Snapshot, b: Snapshot, cast: Member[], what: string, failures: string[]): void {
    for (const m of cast) if (differs(a, b, m.name)) failures.push(`${what}: ${m.name}'s page differs${excerpt(a.get(m.name)!, b.get(m.name)!)}`);
  }

  /** Canon 2: what each member's open page holds must be what a fresh render shows. */
  /** The patch stream: what each member's applets hold must be what a fresh render gives them. */
  async function held(cast: Member[], when: string, failures: string[]): Promise<void> {
    for (const m of cast) failures.push(...unheld(`${when}, ${m.name}'s`, m.taken, await draw(m.sessionId)));
  }

  async function stale(cast: Member[], when: string, failures: string[]): Promise<void> {
    await held(cast, when, failures);
    for (const m of cast) {
      const fresh = comparable(await draw(m.sessionId));
      const held = comparable(m.page);
      if (held !== fresh) failures.push(`${when}, ${m.name}'s open page is not what a fresh render shows${excerpt(fresh, held)}`);
    }
  }

  async function tell(story: Story): Promise<Outcome> {
    const failures: string[] = [];
    /** A send, witnessed for `observe`: what each member heard from it, and the ledger's new entries. */
    async function told(cast: Member[], who: Member, write: Write, phase: Trace["phase"]): Promise<void> {
      const marks = cast.map((m) => m.inbox.length);
      const ledgerBefore = ledgerMax();
      await send(cast, who, write);
      observe?.({
        story: story.name,
        phase,
        as: who.name,
        write,
        heard: cast.map((m, i) => ({ member: m.name, messages: m.inbox.slice(marks[i]).map((raw) => JSON.parse(raw) as Heard) })),
        ledger: ledger.since(ledgerBefore).map(({ doc, undoable }) => ({ doc, undoable })),
      });
    }
    db.exec("BEGIN");
    const cast: Member[] = [];
    try {
      for (const name of Object.keys(stories.cast)) cast.push(await connect(name));
      await settle(cast);
      for (const m of cast) for (const write of stories.cast[m.name]!) await send(cast, m, write);

      const who = cast.find((m) => m.name === story.as);
      if (!who) return { name: story.name, failures: [`no one in the cast is called ${story.as}`] };

      if ("cannot" in story) {
        const before = await snapshot(cast);
        const ledgerBefore = ledgerMax();
        await told(cast, who, story.cannot, "cannot");
        compare(before, await snapshot(cast), cast, "refused, but", failures);
        await stale(cast, "after the refusal", failures);
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

      const before = await snapshot(cast);
      const ledgerBefore = ledgerMax();
      who.inbox.length = 0;
      await told(cast, who, story.does, "does");
      if (process.env.STORY_TRACE) for (const raw of who.inbox) console.log(`        ${who.name} heard: ${raw.slice(0, 160)}`);
      const after = await snapshot(cast);
      const entries = ledger.since(ledgerBefore);
      await stale(cast, "after the story", failures);

      // Only what the story says is asked: `seen` must notice, `unseen` must not; anyone in
      // neither is left alone (a home page with counts on it changes for many reasons).
      for (const m of cast) {
        if (seen.has(m.name)) {
          if (!differs(before, after, m.name)) failures.push(`${m.name} did not see it${where(seen.get(m.name))}`);
        } else if (story.unseen?.includes(m.name) && differs(before, after, m.name)) failures.push(`${m.name} noticed, and should not have`);
      }

      if (entries.length === 0) return { name: story.name, failures }; // off the ledger: nothing to undo
      if (!(await active(who.sessionId))) return { name: story.name, failures }; // the author has gone (logged out): no undo is theirs to press

      const facts = entries.every((e) => e.undoable === 0);
      await told(cast, who, UNDO, "undo");
      const afterUndo = await snapshot(cast);
      await stale(cast, "after undo", failures);
      if (facts) compare(after, afterUndo, cast, "a fact, yet undo changed it", failures);
      else {
        compare(before, afterUndo, cast, "undo did not restore", failures);
        if (!(await active(who.sessionId))) return { name: story.name, failures }; // the undo was their going (a name taken back): no redo is theirs to press
        await told(cast, who, REDO, "redo");
        compare(after, await snapshot(cast), cast, "redo did not restore", failures);
        await stale(cast, "after redo", failures);
      }
      return { name: story.name, failures };
    } finally {
      for (const m of cast) m.ws.close();
      await Promise.all(cast.map((m) => new Promise((resolve) => (m.ws.readyState === WebSocket.CLOSED ? resolve(undefined) : m.ws.addEventListener("close", resolve, { once: true })))));
      await server.idle(); // every close handled, and what it set going
      db.exec("ROLLBACK");
      await documents.release(new Set()); // the next story reads from the rolled-back database
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
