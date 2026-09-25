import { db } from "./db";
import type { Example } from "./example";
import { assemble } from "./compartments";
import { createServer } from "./server";
import type { Stories, Story, Write } from "./stories";
import { applyPatch, type PatchOp } from "./json-patch";
import { settled } from "./documents";
import { onFailure } from "./failed";
import { comparable, splitTag } from "./parts";
import { said } from "./refusal";

export { comparable };

// Runs an example's stories against it, over real sockets, and reports by story name. See
// stories.md ("The harness"). Canon 1 is checked here: for every member of the cast, a fresh
// render from the tables before and after the story, compared -- so a change that reaches a page
// through an applet's patch (a tick) counts the same as one that reaches it as HTML. A member a
// story says sees it on a page is put on that page first (`Stories.page`), since a person sees
// only the page they are on. Then the story is undone and redone as its author, and the pages
// must go back and forth with it; a write the ledger calls a fact (undoable = 0) must survive its
// undo instead, and an author the example no longer counts as active (logged out) gets no undo.
// A `cannot` must change no page, add nothing to the ledger, and be answered: a refusal hands the
// writer's page back, and shows them why when the story says what they are `told`, and nothing
// else. For a `does`, nobody the story does not say sees it may notice it: a story names everyone
// whose page changes. Delivery is checked as well as pages: a member the story says is `unseen`
// must be told of no document -- no patch -- by the write, its undo or its redo, and anything the
// kernel reports failing while a story runs (a message, a drawing, a change being told) fails the
// story. Each story runs inside one database transaction that is rolled back afterwards, so every
// story starts from the cast alone.
//
// Canon 2 is checked here too, without a browser: every member's open page is kept as the client
// would keep it -- a full render replaces it, a fragment render is applied target by target -- and
// after the story, its undo and its redo, that page must equal a fresh render. So a write that
// reaches the tables but not someone's open page fails, by name. An applet that takes its
// document's patches itself (`data-doc`) is compared without its props: they follow the patches,
// not the renders. What the morph does with the HTML is the browser tests' to check.

export type Outcome = { name: string; failures: string[] };
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

/**
 * A control a page offers (src/html.ts `write`): the document, op and path it writes, and the value
 * a button carries (`data-value`, sent as a string). A field or a form writes whatever is typed, so
 * any value; so does the page's address (`data-page-write`). An applet draws its own controls in
 * the browser: one on a document (`data-doc`) offers any write to it, and one whose mount says what
 * it writes (`data-writes`, src/html.ts) any write under that path.
 */
export type Control = { doc: string; op?: string; path?: string; value?: string; free: boolean; under?: true };

/** Every control on a page, as the server drew it. */
export function controlsOn(page: string): Control[] {
  const found: Control[] = [];
  const spec = (attr: string | null) => (attr === null ? undefined : (JSON.parse(unescape(attr)) as { doc: string; op: string; path: string }));
  new HTMLRewriter()
    .on("[data-write]", {
      element(el) {
        const s = spec(el.getAttribute("data-write"))!;
        const value = el.getAttribute("data-value");
        found.push({ ...s, value: value === null ? undefined : unescape(value), free: ["form", "input", "textarea", "select"].includes(el.tagName) });
      },
    })
    .on("[data-page-write]", { element: (el) => void found.push({ ...spec(el.getAttribute("data-page-write"))!, free: true }) })
    .on("[data-applet][data-doc]", { element: (el) => void found.push({ doc: el.getAttribute("data-doc")!, free: true }) })
    .on("[data-writes]", {
      element(el) {
        const said = JSON.parse(unescape(el.getAttribute("data-writes")!)) as { doc: string; path: string } | { doc: string; path: string }[];
        for (const w of Array.isArray(said) ? said : [said]) found.push({ ...w, free: true, under: true });
      },
    })
    .transform(page);
  return found;
}

/** Where a page stands: its address, which the kernel's client mirrors in the URL (`data-page`). */
export const placeOf = (page: string): string | undefined => {
  const m = /\sdata-page="([^"]*)"/.exec(page);
  return m ? unescape(m[1]!) : undefined;
};

/** The same document: named whole on one side and by its type alone on the other (`room`, `room:general`) counts. */
const sameDoc = (a: string, b: string): boolean => a === b || a.startsWith(`${b}:`) || b.startsWith(`${a}:`);

/** Does `c` send this op to this document? A free control sends any value; a button only its own. */
export function offers(c: Control, doc: string, op: PatchOp): boolean {
  if (!sameDoc(c.doc, doc)) return false;
  if (c.under) return op.path === c.path || op.path.startsWith(`${c.path}/`); // an applet's own, under its path
  if (c.op === undefined) return true; // an applet on the document
  if (c.op !== op.op || c.path !== op.path) return false;
  return c.free || (c.value === undefined ? !("value" in op) || op.value === undefined : "value" in op && String(op.value) === c.value);
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



export async function run(example: Example, stories: Stories): Promise<Report> {
  const server = createServer(example, 0);
  const { draw, documents } = assemble(example);
  const active = (sessionId: string): Promise<boolean> => settled(documents, () => example.active(sessionId));
  const ledger = ledgerOf();
  const ledgerMax = ledger.max;
  const outcomes: Outcome[] = [];
  // what the kernel reports failing goes to the story being told
  let failing: string[] | undefined;
  const hearFailures = onFailure((what, err) => failing?.push(`the server failed ${what}: ${err instanceof Error ? err.message : String(err)}`));

  async function snapshot(cast: Member[]): Promise<Snapshot> {
    return new Map(await Promise.all(cast.map(async (m) => [m.name, await draw(m.sessionId)] as const)));
  }

  /** Signs a member in through the example's own route, as a browser posts its form: the session the answer's cookie names, or undefined for a visitor. */
  async function signIn(name: string): Promise<string | undefined> {
    const how = stories.signIn?.(name);
    if (!how) return undefined;
    const res = await fetch(new URL(how.path, server.url), { method: "POST", body: new URLSearchParams(how.form), redirect: "manual" });
    const sessionId = /(?:^|;\s*|,\s*)session_id=([^;,\s]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1];
    if (!sessionId) throw new Error(`${name} could not sign in at ${how.path}: ${res.status}`);
    return sessionId;
  }

  async function connect(name: string): Promise<Member> {
    const url = new URL("/ws", server.url);
    url.protocol = "ws:";
    const sessionId = (await signIn(name)) ?? crypto.randomUUID();
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

  /**
   * Puts a member where a story says (`Stories.at`). Where a page says where it stands
   * (`data-page`), it must now stand there: a place the example does not have leaves them where
   * they were, and a story that claims they saw something there has not shown it.
   */
  async function put(cast: Member[], m: Member, where: string, failures: string[]): Promise<void> {
    if (!stories.at) return;
    await send(cast, m, stories.at(where));
    const stands = placeOf(m.page);
    const asked = where.split(" @ ")[0]!;
    if (stands !== undefined && stands !== asked) failures.push(`${m.name} could not be put on ${JSON.stringify(where)}: their page is at ${JSON.stringify(stands)}`);
  }

  /** Where each member's inbox stands now, to ask later what they were sent since. */
  const mark = (cast: Member[]): Map<Member, number> => new Map(cast.map((m) => [m, m.inbox.length]));

  /** What `m` has been sent since `from`, parsed. */
  const sentSince = (m: Member, from: Map<Member, number>): Heard[] => m.inbox.slice(from.get(m)).map((raw) => JSON.parse(raw) as Heard);

  /** An `unseen` member is told of nothing: sent no document's ops. */
  function untold(cast: Member[], unseen: string[] | undefined, from: Map<Member, number>, when: string, failures: string[]): void {
    for (const m of cast) {
      if (!unseen?.includes(m.name)) continue;
      const docs = new Set(sentSince(m, from).filter((h) => h.type === "patch").map((h) => h.doc));
      for (const doc of docs) failures.push(`${when}, ${m.name} was told of ${doc}, and should not have been`);
    }
  }

  function differs(a: Snapshot, b: Snapshot, name: string): boolean {
    return a.get(name) !== b.get(name);
  }

  function compare(a: Snapshot, b: Snapshot, cast: Member[], what: string, failures: string[]): void {
    for (const m of cast) if (differs(a, b, m.name)) failures.push(`${what}: ${m.name}'s page differs${excerpt(a.get(m.name)!, b.get(m.name)!)}`);
  }

  /** The patch stream: what each member's applets hold must be what a fresh render gives them. */
  async function held(cast: Member[], when: string, failures: string[]): Promise<void> {
    for (const m of cast) failures.push(...unheld(`${when}, ${m.name}'s`, m.taken, await draw(m.sessionId)));
  }

  /** Canon 2: what each member's open page holds must be what a fresh render shows. */
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
    failing = failures;
    db.exec("BEGIN");
    const cast: Member[] = [];
    try {
      for (const name of Object.keys(stories.cast)) cast.push(await connect(name));
      await settle(cast);
      for (const m of cast) for (const write of stories.cast[m.name]!) await send(cast, m, write);

      const who = cast.find((m) => m.name === story.as);
      if (!who) return { name: story.name, failures: [`no one in the cast is called ${story.as}`] };

      if ("cannot" in story) {
        if (story.from !== undefined) await put(cast, who, story.from, failures);
        const before = await snapshot(cast);
        const ledgerBefore = ledgerMax();
        const from = mark(cast);
        // P3: a button on the author's page that sends exactly this, refused without a word, is a control that always fails
        const buttons = controlsOn(who.page).filter((c) => !c.free && c.op !== undefined);
        if (story.told === undefined && story.cannot.ops.every((op) => buttons.some((c) => offers(c, story.cannot.doc, op)))) failures.push(`${who.name}'s page offers this, and it is refused without a word: a control that always fails`);
        await send(cast, who, story.cannot);
        if (!sentSince(who, from).some((h) => h.type === "render")) failures.push(`refused, but ${who.name} was not answered: a refusal hands the page back`);
        const after = await snapshot(cast);
        if (story.told !== undefined) {
          // told why: the one change the writer's page may show
          const page = after.get(who.name)!;
          if (!page.includes(said(story.told))) failures.push(`refused, but ${who.name} was not told "${story.told}"`);
          after.set(who.name, page.replace(said(story.told), ""));
        }
        compare(before, after, cast, "refused, but", failures);
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
        else if (where !== undefined) await put(cast, m, where, failures);
      }


      if (story.from !== undefined) await put(cast, who, story.from, failures);
      // P1: the author's page offers a control for it -- unless it comes from outside any page
      const offered = controlsOn(who.page);
      if (!story.outside) for (const op of story.does.ops) if (!offered.some((c) => offers(c, story.does.doc, op))) failures.push(`${who.name} has no control on their page for ${op.op} ${op.path} on ${story.does.doc}`);

      const before = await snapshot(cast);
      const ledgerBefore = ledgerMax();
      const stood = placeOf(who.page);
      let from = mark(cast);
      await send(cast, who, story.does);
      // Where the write left its author: answering a modal puts it away (off the ledger, a visit),
      // so the undo and the redo are looked at from where each was taken -- where the author stands
      // is theirs, not the write's.
      const landed = placeOf(who.page);
      const moved = stories.at && stood !== undefined && landed !== undefined && stood !== landed;
      // it landed: a document changed, and someone was told (a refusal changes none)
      if (!cast.some((m) => sentSince(m, from).some((h) => h.type === "patch" && h.doc !== "refusal"))) failures.push(`nothing landed: ${who.name}'s write was refused`);
      if (process.env.STORY_TRACE) for (const raw of who.inbox.slice(from.get(who))) console.log(`        ${who.name} heard: ${raw.slice(0, 160)}`);
      untold(cast, story.unseen, from, "after the story", failures);
      const after = await snapshot(cast);
      const entries = ledger.since(ledgerBefore);
      await stale(cast, "after the story", failures);

      // `seen` must notice, and everyone else must not (R3): nobody's page changes unless the story
      // says so. An `unseen` member is further told of nothing (above).
      for (const m of cast) {
        if (seen.has(m.name)) {
          if (!differs(before, after, m.name)) failures.push(`${m.name} did not see it${where(seen.get(m.name))}`);
        } else if (differs(before, after, m.name)) failures.push(`${m.name} noticed, and should not have${excerpt(before.get(m.name)!, after.get(m.name)!)}`);
      }

      if (entries.length === 0) return { name: story.name, failures }; // off the ledger: nothing to undo
      if (!(await active(who.sessionId))) return { name: story.name, failures }; // the author has gone (logged out): no undo is theirs to press

      const facts = entries.every((e) => e.undoable === 0);
      from = mark(cast);
      await send(cast, who, UNDO);
      if (moved) await send(cast, who, stories.at!(stood!));
      const afterUndo = await snapshot(cast);
      await stale(cast, "after undo", failures);
      untold(cast, story.unseen, from, "after undo", failures);
      if (facts) compare(after, afterUndo, cast, "a fact, yet undo changed it", failures);
      else {
        compare(before, afterUndo, cast, "undo did not restore", failures);
        if (!(await active(who.sessionId))) return { name: story.name, failures }; // the undo was their going (a name taken back): no redo is theirs to press
        from = mark(cast);
        await send(cast, who, REDO);
        if (moved) await send(cast, who, stories.at!(landed!));
        compare(after, await snapshot(cast), cast, "redo did not restore", failures);
        await stale(cast, "after redo", failures);
        untold(cast, story.unseen, from, "after redo", failures);
      }
      return { name: story.name, failures };
    } finally {
      for (const m of cast) m.ws.close();
      await Promise.all(cast.map((m) => new Promise((resolve) => (m.ws.readyState === WebSocket.CLOSED ? resolve(undefined) : m.ws.addEventListener("close", resolve, { once: true })))));
      await server.idle(); // every close handled, and what it set going
      db.exec("ROLLBACK");
      await documents.release(new Set()); // the next story reads from the rolled-back database
      failing = undefined;
    }
  }

  try {
    const only = process.env.STORY; // run only the stories whose name contains this
    for (const story of stories.stories) if (!only || story.name.includes(only)) outcomes.push(await tell(story));
  } finally {
    hearFailures();
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
