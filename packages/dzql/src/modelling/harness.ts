import type { Example, StoryStore } from "../rendering/example";
import { cookieNameFor } from "../rendering/scope";
import { assemble, type Assembled } from "../rendering/resources";
import { hear, type Heard, type HeardOp } from "../rendering/resources/render";
// a page as the browser keeps it is rendering's; said here too, as the stories hold pages so
export { hear, type Heard };
import { createServer } from "../rendering/server";
import { isPost, STORY_KEYS, toldOf, unprovenOf, writeOf, type Gesture, type Post, type Stories, type Story, type Write } from "./stories";
import { isTest, isVerb, walked, type PatchOp, type WriteId } from "../rendering/json-patch";
import { activeDocuments, Pending, setActiveDocuments, settled, type Documents } from "../rendering/documents";
import { onFailure } from "../rendering/failed";
import { comparable, decoded } from "../rendering/parts";
import { tell as tellSession, toldNothing, toldTo, type Line } from "../rendering/refusal";
import { esc } from "../rendering/html";
import { Hand, sameDoc, sameWrite, worded } from "./by-hand";
import { allOpenSockets, resolveName, sees } from "../rendering/resources/audience";
import { shownTo } from "../rendering/reading";
import type { Resource, Kind } from "../rendering/resources/resource";
import { prefixDoc, splitDoc } from "../rendering/names";
import { size, sum, tap } from "./costs";
import { controlsOn, goesTo, offers, placeOf, writesOn, type Control, type Writing } from "./harness/controls";
import { holding, propsCost, retake, takersOn, taking, type PropsCost, type Taken } from "./harness/applets";
import { anyOne, holds, keysOf, pathsIn, valueAt } from "./harness/paths";
// what a page offers, what its applets hold, and the paths in a document: each a module of its own (src/modelling/harness/), said here too
export { controlsOn, goesTo, offers, placeOf, writesOn, type Control } from "./harness/controls";
export { holding, MOST_PROPS, propsCost, retake, takersOn, taking } from "./harness/applets";
export { anyOne, holds, pathsIn, valueAt } from "./harness/paths";

// Runs an example's stories against it, over real sockets, and reports by story name: what each
// step checks is docs/stories.md, "The harness". Canon 1 compares every member's page, drawn from
// the server's copy, before and after; Canon 2 holds each open page, kept as the client keeps it,
// to a fresh render from delta's tables; by hand (src/modelling/by-hand.ts) a story is done in a browser the
// size of a phone; and what each step hands each page is counted (src/modelling/costs.ts `tap`) and held to
// a budget. Each story runs in a transaction rolled back after it.

/** What a story handed each member's page: the write's own size (none when a tab opens or closes; `opens` when it opens), and each member handed anything by its step, by its undo, and by its redo, when it has them. */
export type Wire = { write?: number; opens?: true; handed: Handed[]; undo?: Handed[]; redo?: Handed[] };
/** What one member's page was handed: its bytes as the page takes them, as they crossed the wire (compressed), and the biggest part of them. */
export type Handed = { member: string; bytes: number; sent: number; most: Part };
/** A piece of what a page was handed, by what it is (`largest`), and its bytes before compression. */
export type Part = { part: string; bytes: number };

export type Outcome = { name: string; failures: string[]; wire?: Wire };

/** One step of a story's run, for `run`'s observer: who wrote what (or closed their tab), what every member was sent, and what the ledger took. For a sequence drawn from a real run. */
export type Trace = {
  story: string;
  phase: "does" | "cannot" | "undo" | "redo" | "closesTab" | "opensTab";
  as: string;
  /** None when a tab opens or closes. */
  write?: Write | Post;
  heard: { member: string; messages: Heard[] }[];
  /** What each member's page read as the step was taken: the documents in front of them, as `<docType>:<docId>` (src/reading.ts). */
  holds: { member: string; docs: string[] }[];
  /** What the ledger took: the ops as written, and their inverse -- which holds what was there before. */
  ledger: { doc: string; undoable: number; ops: PatchOp[]; inverse: PatchOp[] }[];
};
/** What the stories found that does not fail them: what props cost (`propsCost`), each kind for each applet once, in the first story that sent it; a control the wire refuses, on the page it was first drawn on (`miswritten`); and a permit wider than its stories (`hiddenVerbs`), by the document it is on. */
export type Warning = { story: string; says: string };
export type Report = { outcomes: Outcome[]; passed: number; failed: number; warnings?: Warning[]; byHand?: ByHand; /** The stories with no body yet (`story(name)`, no body): a test of the app tells each. */ unproven?: string[] };

/** The stories done by hand in a browser (`byHand`, or a story's own `gesture`): how many, how many presses (a button pressed, a form typed into and sent, a drag), how many writes sent as an applet declares them, and how long it took. */
export type ByHand = { stories: number; presses: number; applets: number; ms: number };

/** A tab as the server holds it. */
type Tab = ReturnType<typeof allOpenSockets>[number];
/** A member of the cast: a tab of a session (`ws`), the socket the server holds for it (`socket`), and the name the tap knows it by (`tap`). */
type Member = { name: string; cookie: string; sessionId: string; ws: WebSocket; socket: Tab; tap: string; inbox: string[]; page: string; taken: Map<string, Taken>; answered: (() => void)[] };
type Snapshot = Map<string, string>;


type LedgerRow = Awaited<ReturnType<StoryStore["since"]>>[number];

/**
 * The ledger the stories read, to know whether a story has an undo to check and whether a refusal
 * moved nothing: delta's (`delta_ledger`, in the same database), whose fresh entries -- not an
 * undo's or a redo's -- a story's write starts. An app with no document on the ledger yet (a new
 * one, its stories told before anything is built) has none: nothing moves it.
 */
async function sqliteStore(): Promise<StoryStore> {
  // the app's own SQLite, opened only when a run asks for it: importing the harness opens nothing
  const { db } = await import("../rendering/db");
  const kept = db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'delta_ledger'").get() !== null;
  const max = kept ? db.query<{ id: number | null }, []>("SELECT MAX(id) AS id FROM delta_ledger") : undefined;
  const since = kept ? db.query<{ id: number; doc: string; undoable: number; ops: string; inverse: string }, [number]>("SELECT id, doc, undoable, ops, inverse FROM delta_ledger WHERE id > ? AND undoes IS NULL ORDER BY id") : undefined;
  return {
    begin: async () => void db.exec("BEGIN"),
    end: async () => void db.exec("ROLLBACK"),
    last: async () => max?.get()?.id ?? 0,
    since: async (id) => (since?.all(id) ?? []).map((e) => ({ id: e.id, doc: e.doc, undoable: e.undoable !== 0, ops: JSON.parse(e.ops) as PatchOp[], inverse: JSON.parse(e.inverse) as PatchOp[] })),
  };
}

/** Is a document stored, in delta's tables (no `kind`), which `open_at` reads and the wire writes? */
const isStored = (owner: { kind?: Kind } | undefined): boolean => owner?.kind === undefined;
/** A time after every write: a document opened as it stood then (`open_at`) is its rows as they stand. */
const AFTER_EVERY_WRITE = "9999-12-31T23:59:59.999Z";

const UNDO: Write = walked("undo");
const REDO: Write = walked("redo");


/** Is this a story's gesture (`Gesture`, src/modelling/stories.ts): a press on one selector, or a drag from one to another, and nothing else? */
const isGesture = (g: unknown): boolean => {
  if (typeof g !== "object" || g === null || Object.keys(g).length !== 1) return false;
  const { press, drag } = g as Record<string, unknown>;
  return typeof press === "string" || (Array.isArray(drag) && drag.length === 2 && drag.every((s) => typeof s === "string"));
};

/** A place's own address: what `where` says before any " @ " (what else the place holds). */
const placeIn = (where: string): string => where.split(" @ ")[0]!;

/** Does `c` post this form to its route: a plain form that posts there? */
const postsTo = (c: Control, how: Post): boolean => c.op === "post" && c.path === how.path;

/** One way on: from where a member stood, the control on their page there that took them to `to`. */
type Step = { from: string; to: string; control: Control };

/** The most ways by hand the harness tries to one place, each leaving out a step a person could not take. */
const MOST_TRIES = 20;

const stepKey = (step: Step): string => `${step.from}\n${JSON.stringify(step.control)}`;

/** The most places the harness walks for one member, looking for a way to a place a story names: enough for any page's drawers, not for a calendar's every month. */
const MOST_PLACES = 400;

// The patch stream, checked: what an applet holds must be what a fresh render gives it (`unheld`).

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

/** The part a render op is about: the one its HTML carries (a part replaced, put in, or given a new tag), or the last its target names (one taken out). */
function partOf(op: HeardOp): string {
  const carried = /data-eta-part="([^"]*)"/.exec(op.html ?? "");
  if (carried) return decoded(carried[1]!);
  const named = [...op.target.matchAll(/data-eta-part="((?:\\.|[^"\\])*)"/g)].at(-1);
  return named ? named[1]!.replaceAll('\\"', '"') : op.target;
}

/**
 * The biggest part of the messages a page was handed, and its bytes before compression: of a render
 * in parts, each op, by the part it is about (`partOf`); else each message whole -- "the whole
 * page", a document's patch ("room:general patch"), or one of another kind by its type.
 */
export function largest(raws: string[]): Part {
  const parts = raws.flatMap((raw): Part[] => {
    const message = JSON.parse(raw) as Heard;
    if (message.type === "render" && message.html === undefined) return message.ops!.map((op) => ({ part: partOf(op), bytes: Buffer.byteLength(JSON.stringify(op)) }));
    return [{ part: message.type === "render" ? "the whole page" : message.type === "patch" ? `${message.doc} patch` : message.type, bytes: Buffer.byteLength(raw) }];
  });
  return parts.reduce((most, p) => (p.bytes > most.bytes ? p : most));
}

/** A page without the versions its watching mounts say they hold (`data-v`): each change moves one on, an undo too, and nobody sees it. */
export const unversioned = (page: string): string => page.replace(/\sdata-v="\d+"/g, "");


/** Names, as a sentence says them: `ann`, `ann and bo`, `ann, bo and mo`. */
const listed = (names: string[]): string => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/**
 * Why a story is not one kind of story with only that kind's keys (`STORY_KEYS`), if it is not. A
 * story file runs without being type-checked, and a key the harness does not read would otherwise
 * be dropped without a word: `{ does, closesTab }` would close a tab and never write.
 */
function misshapen(story: Story): string[] {
  const given = Object.entries(story).filter(([, value]) => value !== undefined).map(([key]) => key);
  const kinds = (Object.keys(STORY_KEYS) as (keyof typeof STORY_KEYS)[]).filter((kind) => given.includes(kind));
  if (kinds.length !== 1) return [`a story is one of does, cannot, closesTab or opensTab, and this one has ${kinds.length ? kinds.join(" and ") : "none"}`];
  const kind = kinds[0]!;
  const takes: readonly string[] = ["name", "as", "premise", ...STORY_KEYS[kind]];
  const why = given.filter((key) => !takes.includes(key)).map((key) => `a ${kind} story takes no ${key}`);
  if (kind === "closesTab" && story.closesTab !== true) why.push(`closesTab is true, or left out: this one is ${JSON.stringify(story.closesTab)}`);
  if (kind === "opensTab" && typeof story.opensTab !== "string") why.push(`opensTab is the address the tab opens at: this one is ${JSON.stringify(story.opensTab)}`);
  if (story.gesture !== undefined && !isGesture(story.gesture)) why.push(`a gesture is { press: selector } or { drag: [from, to] }: this one is ${JSON.stringify(story.gesture)}`);
  else if (story.gesture !== undefined && story.offPage) why.push("a story from no page (offPage) has no gesture");
  const posted = story.does ?? story.cannot;
  if (posted && isPost(posted)) {
    if (typeof posted.path !== "string" || !posted.path.startsWith("/") || typeof posted.form !== "object" || posted.form === null || !Object.values(posted.form).every((v) => typeof v === "string")) why.push(`a post is a route's path and a form of strings: this one is ${JSON.stringify(posted)}`);
    for (const key of ["undone", "redone", "gesture"] as const) if (story[key] !== undefined) why.push(`a post takes no ${key}: a route writes as the server, and its form is posted as it is drawn`);
  }
  why.push(...unbudgeted(story.budget, "a"));
  return why;
}

/** Why a budget is not a number of bytes, if it is not: a whole one, more than none. `whose` begins what is said. */
const unbudgeted = (budget: unknown, whose: string): string[] =>
  budget === undefined || (Number.isInteger(budget) && (budget as number) > 0) ? [] : [`${whose} budget is a whole number of bytes: this one is ${JSON.stringify(budget)}`];

const count = (bytes: number): string => bytes.toLocaleString("en");
/** Each step of a story, as a budget's failure names it. */
const STEP: Record<Trace["phase"], string> = { does: "write", cannot: "refusal", closesTab: "tab closing", opensTab: "tab opening", undo: "undo", redo: "redo" };

/**
 * One run of an example's stories, as each step of it needs it: the example, its stories, the server
 * and the tap its cast's sockets go through, the example's documents and resources as the server
 * assembled them, and what the run keeps as it goes. Every step below takes it first (`r`).
 */
type Run = {
  example: Example;
  stories: Stories;
  observe?: (trace: Trace) => void;
  server: ReturnType<typeof createServer>;
  /** The cast's sockets go through it, so what each page is handed is counted as it crossed the wire. */
  tapped: Awaited<ReturnType<typeof tap>>;
  draw: Assembled["draw"];
  page: Assembled["page"];
  documents: Documents;
  byDocType: Map<string, Resource>;
  /** The app's store, as the stories begin and end each story on it and read its ledger: dzql's SQLite unless the app says (`Example.store`). */
  store: StoryStore;
  /** The refusals a control of the page's own sends, when told: tried by hand. */
  tryable: Set<Story>;
  /** Where what the kernel reports failing goes: the story being told's failures. */
  failing?: string[];
  /** The story being told, which what a render costs in props goes to (`warn`), once for each applet and kind. */
  telling?: string;
  warned: Map<string, Warning>;
  /** The state being walked (`reach`), whose pages are kept. */
  walked?: State;
  /**
   * What each of the cast met, whatever they were doing: every document a page of theirs read (a
   * session's own by its type alone) and every control one offered, for `hiddenVerbs`.
   */
  met: Map<string, { reads: Set<string>; offered: Map<string, Control> }>;
  /** Each page checked, with what it read: once. */
  wired: Set<number | bigint>;
  /** Each control the wire refuses, by what is said of it: once. */
  miswired: Map<string, Warning>;
  /** How many writes the cast has sent: each its own id. */
  writes: number;
  /** How many tabs the cast has opened: each its own name at the tap. */
  opened: number;
  /** The server's sockets that are the cast's tabs, while open: a tab opening is the one of its session not among them. */
  owned: Set<Tab>;
};

/** Where a person can go (`reach`): every page a member is drawn while a walk is under way, kept by where it stands: member → place → controls, by what each writes. */
type State = { pages: Map<string, Map<string, Map<string, Control>>>; starts: Map<string, string | undefined> };

const active = (r: Run, sessionId: string): Promise<boolean> => settled(r.documents, () => r.example.active(sessionId));
const warn = (r: Run, found: PropsCost): void => {
  const key = `${found.kind} ${found.applet}`;
  if (r.telling !== undefined && !r.warned.has(key)) r.warned.set(key, { story: r.telling, says: found.says });
};

function keep(r: Run, m: Member): void {
  const controls = controlsOn(m.page);
  const mine = r.met.get(m.name) ?? r.met.set(m.name, { reads: new Set(), offered: new Map() }).get(m.name)!;
  for (const c of controls) mine.offered.set(JSON.stringify(c), c);
  for (const doc of inFront(r, [m])[0]!.docs) {
    const { docType, docId } = splitDoc(doc);
    if (!r.byDocType.get(docType)?.perSession) mine.reads.add(doc);
    else if (docId === m.sessionId) mine.reads.add(docType);
  }
  const at = placeOf(m.page);
  if (!r.walked || at === undefined) return;
  const byPlace = r.walked.pages.get(m.name) ?? r.walked.pages.set(m.name, new Map()).get(m.name)!;
  const here = byPlace.get(at) ?? byPlace.set(at, new Map()).get(at)!;
  for (const c of controls) here.set(JSON.stringify(c), c);
}

/**
 * Canon 2's fresh render: the page drawn from storage. Each document it reads is opened again
 * from delta's tables (`open_at`). One the tables do not hold is nothing, as the kernel holds a
 * document delta cannot open, so a row they lost fails; only one with no tables at all -- a
 * resource's `memory`, `source` or `static` kind, kept where delta keeps it -- is the server's copy. The page reads the
 * active copy, so this one is made active while it draws, and only then: a drawing is synchronous.
 */
async function fresh(r: Run, m: Member): Promise<string> {
  const stored = new Map<string, unknown>();
  const copy: Documents = {
    ...r.documents,
    read: <T>(doc: string): T => {
      if (!stored.has(doc)) throw new Pending(doc);
      return stored.get(doc) as T;
    },
    // the version a watching mount holds is not compared (`comparable`): the page read from storage says none
    version: (doc: string): undefined => void copy.read(doc),
    load: async (doc: string) => {
      if (!isStored(r.byDocType.get(splitDoc(doc).docType))) return void stored.set(doc, await settled(r.documents, () => r.documents.read(doc)));
      const { result, error } = await r.example.delta.call("open_at", { doc, at: AFTER_EVERY_WRITE });
      if (error && error.code !== 404) throw new Error(`${doc} could not be read from storage: ${error.message}`);
      else stored.set(doc, result);
    },
  };
  return drawFrom(r, copy, m);
}

/** Where a member's tab stands, as the server holds it: what its page is drawn at. */
const addressOf = (m: Member): string => m.socket.data.address ?? "";

/** A member's page as the server draws it: their session's, where their tab is. */
const drawn = (r: Run, m: Member): Promise<string> => r.draw(m.sessionId, addressOf(m));

/** A page drawn from `copy`, made the active documents while it draws, and only then: a drawing is synchronous. */
function drawFrom(r: Run, copy: Documents, m: Member): Promise<string> {
  return settled(copy, () => {
    const serving = activeDocuments();
    setActiveDocuments(copy);
    try {
      return r.page(m.sessionId, addressOf(m));
    } finally {
      setActiveDocuments(serving);
    }
  });
}

/** A member's page as though they had been told nothing (src/rendering/refusal.ts), as a snapshot has it (`unversioned`): what they were told, left out, is checked on its own. */
const unsaid = async (r: Run, m: Member): Promise<string> => unversioned(await drawFrom(r, toldNothing(r.documents, m.sessionId), m));

/** Every member's page, drawn as a page is and without its watching mounts' versions (`unversioned`): `quiet`'s as though they had been told nothing, since what they are told is checked on its own (`checkTold`). */
async function snapshot(r: Run, cast: Member[], quiet?: Member): Promise<Snapshot> {
  return new Map(await Promise.all(cast.map(async (m) => [m.name, m === quiet ? await unsaid(r, m) : unversioned(await drawn(r, m))] as const)));
}

/** Posts a form to a route as a browser posts it: from the page's own site, with the session's cookie if it has one. The route's answer, not followed. */
const postForm = (r: Run, how: Post, cookie?: string): Promise<Response> =>
  fetch(new URL(how.path, r.server.url), { method: "POST", body: new URLSearchParams(how.form), redirect: "manual", headers: { Origin: r.server.url.origin, ...(cookie && { Cookie: `${cookieNameFor(r.example.at)}=${cookie}` }) } });

/**
 * The session a new cookie names, as the server finds it (`Example.session`), told nothing yet.
 * Each story is rolled back, so a session's number comes round again in the next; what a
 * session is told is kept in memory, off the tables, and would otherwise be the last story's.
 */
const sessionOf = async (r: Run, cookie: string): Promise<string> => {
  const sessionId = await (r.example.session?.(cookie) ?? cookie);
  await tellSession(sessionId);
  return sessionId;
};

/** The cookie an answer sets, if it sets one. */
const cookieOf = (r: Run, res: Response): string | undefined => new RegExp(`(?:^|;\\s*|,\\s*)${cookieNameFor(r.example.at)}=([^;,\\s]+)`).exec(res.headers.get("set-cookie") ?? "")?.[1];

/** Signs a member in through the example's own route, as a browser posts its form: the cookie the answer sets, or undefined for a visitor. */
async function signIn(r: Run, name: string): Promise<string | undefined> {
  const how = r.stories.signIn?.(name);
  if (!how) return undefined;
  const res = await postForm(r, how);
  const cookie = cookieOf(r, res);
  // a member the route will not sign in: every story fails with it, said, and nothing more is run (cafe-e's feedback: it was a stack trace)
  if (!cookie) throw Object.assign(new Error(`${name} could not sign in at ${how.path}: ${res.status}`), { unsigned: true });
  return cookie;
}

async function connect(r: Run, name: string): Promise<Member> {
  const cookie = (await signIn(r, name)) ?? crypto.randomUUID();
  const member = { name, cookie, sessionId: await sessionOf(r, cookie), inbox: [], answered: [] } as Partial<Member> as Member; // its tab is `open`'s
  await open(r, member);
  return member;
}

/**
 * Opens a tab of `member`'s session, as a page loading does: a socket of its own, at the address
 * its URL names (`at`; none, a socket that names none), and the page it is drawn.
 */
async function open(r: Run, member: Member, at?: string): Promise<void> {
  const tap = `${member.name.replace(/\W/g, "-")}-${++r.opened}`;
  const url = at === undefined ? r.tapped.url : `${r.tapped.url}?at=${encodeURIComponent(at)}`;
  // @ts-expect-error Bun's runtime-only `headers` option on WebSocket
  const ws: WebSocket = new WebSocket(url, { headers: { Cookie: `${cookieNameFor(r.example.at)}=${member.cookie}`, "X-Tap": tap } });
  Object.assign(member, { ws, tap, page: "", taken: new Map() });
  const name = member.name;
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as Heard;
    if (message.type === "inspect") return member.answered.shift()?.();
    member.inbox.push(String(event.data));
    propsCost(name, member.page, message).forEach((found) => warn(r, found));
    member.page = hear(member.page, message);
    if (message.type === "render") {
      retake(member.taken, member.page, message);
      keep(r, member);
    }
    if (message.type === "patch") taking(member.taken, message as unknown as { doc: string; version: number; ops: PatchOp[] });
  });
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  // the server opened it as it answered: its socket, the one of the session's the cast does not hold
  member.socket = allOpenSockets().find((s) => s.data.sessionId === member.sessionId && !r.owned.has(s))!;
  r.owned.add(member.socket);
}

/** What a session is told now (src/rendering/refusal.ts). */
const toldNow = (r: Run, sessionId: string): Promise<Line | undefined> => settled(r.documents, () => toldTo(sessionId));

/**
 * Posts a form to a route as `who`'s browser does (`postForm`), and waits for what the route set
 * going: its writes, told from delta's stream as any change is. A redirect is followed as a
 * browser follows it: their tab goes, and the page it lands on is theirs, in the session the
 * answer's cookie names if it names one -- so what `from` marks for them is that page's. Refused
 * when the route answers a 4xx (its words, the reason) or tells them a reason on the page they
 * came from (`tell`).
 */
async function posting(r: Run, cast: Member[], who: Member, how: Post, from: Map<Member, number>): Promise<{ status: number; reason?: string }> {
  const toldBefore = JSON.stringify((await toldNow(r, who.sessionId)) ?? null);
  const res = await postForm(r, how, who.cookie);
  await r.server.idle();
  if (res.status >= 400) {
    await settle(r, cast);
    return { status: res.status, reason: (await res.text()).trim() };
  }
  const line = await toldNow(r, who.sessionId);
  await settle(r, cast); // the tab that posted has heard what the route set going, before it goes
  if (res.status >= 300) {
    await closeTab(r, who);
    await r.server.idle();
    const cookie = cookieOf(r, res);
    if (cookie) Object.assign(who, { cookie, sessionId: await sessionOf(r, cookie) });
    from.set(who, who.inbox.length);
    const to = new URL(res.headers.get("location") ?? "", r.server.url); // the tab opens where the route sends it
    await open(r, who, decodeURI(to.pathname.slice((r.example.at ?? "").length).replace(/^\//, "") + to.search));
    await settle(r, cast);
  }
  return { status: res.status, ...(line?.reason !== undefined && JSON.stringify(line) !== toldBefore && { reason: line.reason }) };
}

/**
 * Waits until every member has heard everything sent so far. Everything a write causes is
 * synchronous on the server, and a socket delivers in order: so each member is asked a question
 * (`inspect`) after the write, and once each has its answer, each has had all that came before
 * it. No clock: a render that is slow to make is still waited for.
 */
async function settle(r: Run, cast: Member[]): Promise<void> {
  await Promise.all(
    cast.map((m) => new Promise<void>((resolve) => {
      m.answered.push(resolve);
      m.ws.send(JSON.stringify({ type: "inspect" }));
    })),
  );
  for (const m of cast) await checkWire(r, m); // quiet: each page is the one last drawn, and what it read is that drawing's
}

// The wire, checked: a control the server will not take leaves its page still, with no
// word why. So every control on every page drawn is held to what the server asks of its write.

/** Every control on `m`'s page, as it stands, held to the wire (`miswritten`): one that fails is a warning, on the page it was first drawn on. */
async function checkWire(r: Run, m: Member): Promise<void> {
  const ws = m.socket;
  const key = Bun.hash(`${m.page}\0${shownTo(ws).join()}`);
  if (r.wired.has(key)) return;
  r.wired.add(key);
  const at = placeOf(m.page);
  for (const w of writesOn(m.page)) {
    const wrong = await miswritten(r, ws, w);
    const says = wrong && `${w.control}, ${w.op} ${w.path} on ${w.doc}: ${wrong}`;
    if (says && !r.miswired.has(says)) r.miswired.set(says, { story: `a control the wire refuses, on ${at === undefined ? `${m.name}'s page` : JSON.stringify(at)}`, says });
  }
}

/** Why the server would refuse what a control writes from the page `ws` holds, if it would: its op, its path, a document the page did not read, or a replace of nothing. */
async function miswritten(r: Run, ws: Tab, w: Writing): Promise<string | undefined> {
  if (!isVerb(w.op) && w.op !== "test") return `${w.op} is not add, replace, remove or test`;
  if (!keysOf(w.path)) return `${w.path} is not a JSON Pointer`;
  const target = await settled(r.documents, () => resolveName(r.byDocType, w.doc, ws));
  if (!target || !(await settled(r.documents, () => sees(target.owner, ws, target.docId)))) return `the page did not read ${w.doc}`;
  if (w.op !== "replace") return undefined;
  const { owner, docId } = target;
  const value = valueAt(await settled(r.documents, () => r.documents.read(prefixDoc(owner.docType, docId))), owner.under ?? "");
  if (holds(value, w.path)) return undefined;
  if (!owner.shape) return `${w.doc} holds nothing at ${w.path} to replace`;
  // the example's own words, which its shape translates: its permit must take them, or say why not
  try {
    return (await settled(r.documents, () => owner.permit?.(ws, { op: "replace", path: w.path, value: w.value }, docId))) ? undefined : `${w.doc} holds nothing at ${w.path}, and its permit refuses it without a word`;
  } catch {
    return undefined; // refused, and says why
  }
}

/** A document as the wire names it: a session's own by its type alone. */
const wireNamed = (r: Run, doc: string): string => (r.byDocType.get(splitDoc(doc).docType)?.perSession ? splitDoc(doc).docType : doc);

/** What `m`'s page read, as the wire names it, the kernel's `told` left out: what a failure about them says. */
const readBy = (r: Run, m: Member): string => [...new Set(inFront(r, [m])[0]!.docs.map((doc) => wireNamed(r, doc)))].filter((d) => d !== "told").join(", ") || "nothing";

/** The documents a step changed, as the wire names them: each its ledger took, and each anyone was told of. */
const changedSince = (r: Run, cast: Member[], from: Map<Member, number>, entries: LedgerRow[] = []): string[] =>
  [...new Set([...entries.map((e) => wireNamed(r, e.doc)), ...cast.flatMap((m) => sentSince(r, m, from).flatMap((h) => (h.type === "patch" && h.doc !== "told" ? [h.doc!] : [])))])];

/** Sends a write as `who`, with an id of its own as a page sends it, and waits for the wire to go quiet: the id, to find its answer by. */
async function send(r: Run, cast: Member[], who: Member, write: Write): Promise<number> {
  const id = ++r.writes;
  who.ws.send(JSON.stringify({ id, ...write }));
  await settle(r, cast);
  return id;
}

/**
 * Puts a member where a story says (`Stories.goTo`). Where a page says where it stands
 * (`data-page`), it must now stand there: a place the example does not have leaves them where
 * they were, and a story that claims they saw something there has not shown it.
 */
async function put(r: Run, cast: Member[], m: Member, where: string, failures: string[]): Promise<void> {
  if (!r.stories.goTo) return;
  await send(r, cast, m, r.stories.goTo(where));
  const stands = placeOf(m.page);
  if (stands !== undefined && stands !== placeIn(where)) failures.push(`${m.name} could not be put on ${JSON.stringify(where)}: their page is at ${JSON.stringify(stands)}`);
}

/** What else `where` holds, past its place (" @ "): the ops of goTo's write for it that going to the place sends none of. Undefined where it says no more than its place. */
function past(r: Run, where: string): Write | undefined {
  const place = placeIn(where);
  if (place === where) return undefined;
  const going = r.stories.goTo!(place).ops.map((op) => JSON.stringify(op));
  const all = r.stories.goTo!(where);
  return { doc: all.doc, ops: all.ops.filter((op) => !going.includes(JSON.stringify(op))) };
}

/** The documents in front of each member: what the page last drawn for their tab read. */
const inFront = (r: Run, cast: Member[]): Trace["holds"] => cast.map((m) => ({ member: m.name, docs: shownTo(m.socket) }));

/** Where each member's inbox stands now, to ask later what they were sent since. */
const mark = (r: Run, cast: Member[]): Map<Member, number> => new Map(cast.map((m) => [m, m.inbox.length]));

/** What `m` has been sent since `from`, parsed. */
const sentSince = (r: Run, m: Member, from: Map<Member, number>): Heard[] => m.inbox.slice(from.get(m)).map((raw) => JSON.parse(raw) as Heard);

/** What answered write `id`, sent by `m` since `from`: its own echo (a patch), its refusal, or nothing. */
const answerTo = (r: Run, m: Member, id: WriteId, from: Map<Member, number>): Heard | undefined => sentSince(r, m, from).find((h) => h.id === id && (h.type === "patch" || h.type === "refused"));

/** Did something land since `from`: a document changed, and someone was told (what a session is told of a write changes none)? */
const landedSince = (r: Run, cast: Member[], from: Map<Member, number>): boolean => cast.some((m) => sentSince(r, m, from).some((h) => h.type === "patch" && h.doc !== "told"));

/**
 * The story's own premise, made after the cast's writes: each write as its member. Why it does
 * not hold, if it does not: then the story is not told. A write that changes nothing fails it,
 * whether refused or already so -- the wire answers both `refused` -- since a premise says what
 * a story starts from, and a write that moved nothing says it wrongly.
 */
async function premise(r: Run, cast: Member[], story: Story): Promise<string[]> {
  const why: string[] = [];
  for (const [name, writes] of Object.entries(story.premise ?? {})) {
    const m = cast.find((c) => c.name === name);
    if (!m) why.push(`the premise names ${name}, and no one in the cast is called that`);
    else for (const write of writes) {
      const from = mark(r, cast);
      const answer = answerTo(r, m, await send(r, cast, m, write), from);
      if (answer?.type !== "patch") why.push(`the premise did not hold: ${name}'s write to ${write.doc} changed nothing${answer?.reason ? `: "${answer.reason}"` : ""}`);
    }
  }
  return why;
}

/**
 * What one step of the story (`phase`) handed each of `cast` since `from`, the step's last
 * message the question `settle` asked: each member handed anything, their bytes as the page
 * takes them and as they crossed the wire (the tap's count), and the biggest part. Kept on the
 * outcome -- the story's own step beside its write's size, an undo and a redo beside it -- and
 * held to the story's budget, or else the example's.
 */
function spent(r: Run, story: Story, outcome: Outcome, phase: Trace["phase"], cast: Member[], from: Map<Member, number>): void {
  const handed = cast.flatMap((m): Handed[] => {
    const raws = m.inbox.slice(from.get(m));
    if (raws.length === 0) return [];
    const heard = r.tapped.heard(m.tap, raws);
    return [{ member: m.name, bytes: sum(heard, "bytes"), sent: sum(heard), most: largest(raws) }];
  });
  if (phase === "undo" || phase === "redo") outcome.wire![phase] = handed;
  else {
    const write = story.does ?? story.cannot;
    outcome.wire = { ...(write && { write: Buffer.byteLength(JSON.stringify(write)) }), ...(phase === "opensTab" && { opens: true as const }), handed };
  }
  const [budget, whose] = story.budget !== undefined ? [story.budget, "story's"] : [r.stories.budget, "example's"];
  if (budget === undefined) return;
  for (const h of handed) {
    if (h.bytes > budget) outcome.failures.push(`${h.member}'s page was handed ${count(h.bytes)} bytes on the ${STEP[phase]}, more than the ${whose} budget of ${count(budget)}: the most, ${h.most.part}, ${size(h.most.bytes)}`);
  }
}

/** An `untold` member is told of nothing: sent no document's ops. */
function checkUntold(r: Run, cast: Member[], untold: string[] | undefined, from: Map<Member, number>, when: string, failures: string[]): void {
  for (const m of cast) {
    if (!untold?.includes(m.name)) continue;
    const docs = new Set(sentSince(r, m, from).filter((h) => h.type === "patch").map((h) => h.doc));
    for (const doc of docs) failures.push(`${when}, ${m.name} was told of ${doc}, and should not have been: ${m.name}'s page read ${readBy(r, m)}`);
  }
}

/**
 * What `who` was told by what they just did (src/rendering/refusal.ts): shown on their page, in its own
 * words, and what the story says, where it says. It is theirs, and of that moment -- the page
 * before it never said it, nor will the page after their next write -- so their pages are
 * compared without it; and a walk that is told just what the step before it was (`before`, and
 * what that was) was told nothing of its own. The line, for the next step to be told apart from.
 */
async function checkTold(r: Run, who: Member, when: string, expected: string | undefined, failures: string[], before?: { line: Line | undefined; what: string }): Promise<Line | undefined> {
  const line = await toldNow(r, who.sessionId);
  const words = line?.said ?? line?.reason;
  if (line && before && JSON.stringify(line) === JSON.stringify(before.line)) failures.push(`${when}, ${who.name} is still told "${words}", what ${before.what} told them`);
  else if (expected !== undefined && line?.said !== expected) failures.push(`${when}, ${who.name} was not told "${expected}"${words === undefined ? "" : `: they were told "${words}"`}`);
  else if (words !== undefined && !shows(r, unversioned(await drawn(r, who)), await unsaid(r, who), words)) failures.push(`${when}, ${who.name} was told "${words}", and their page does not show it`);
  return line;
}

/** Does `page` show what its member was told, in its own words, where the same page told nothing (`without`) does not? */
const shows = (r: Run, page: string, without: string, words: string): boolean => page !== without && page.includes(esc(words));

function compare(r: Run, a: Snapshot, b: Snapshot, cast: Member[], what: string, failures: string[]): void {
  for (const m of cast) if (a.get(m.name) !== b.get(m.name)) failures.push(`${what}: ${m.name}'s page differs${excerpt(a.get(m.name)!, b.get(m.name)!)}`);
}

/** `seen` must notice, and everyone else must not (R3): nobody's page changes unless the story says so. One who does not is told what their page read, and what `changed` (a write, or a tab closing). */
function noticed(r: Run, before: Snapshot, after: Snapshot, looking: Member[], seen: Map<string, string | undefined>, failures: string[], changed: string): void {
  for (const m of looking) {
    const differs = before.get(m.name) !== after.get(m.name);
    if (seen.has(m.name)) {
      if (!differs) failures.push(`${m.name} did not see it${where(seen.get(m.name))}: ${m.name}'s page read ${readBy(r, m)}${changed}`);
    } else if (differs) failures.push(`${m.name} noticed, and should not have${excerpt(before.get(m.name)!, after.get(m.name)!)}`);
  }
}

/** What a step changed, as a failure ends with it; nothing, when it changed nothing. */
const naming = (r: Run, what: string, docs: string[]): string => (docs.length === 0 ? "" : `; ${what} ${docs.join(", ")}`);

/** Closes a member's tab, as a browser does: resolved once it is closed. The server has then been told, and what it sets going is `server.idle()`'s to wait for. */
function closeTab(r: Run, m: Member): Promise<unknown> {
  r.owned.delete(m.socket);
  if (m.ws.readyState === WebSocket.CLOSED) return Promise.resolve();
  const closed = new Promise((resolve) => m.ws.addEventListener("close", resolve, { once: true }));
  m.ws.close();
  return closed;
}

/** Canon 2: what each member's applets hold (the patch stream), then what their open page holds, must be what a fresh render gives them. */
async function stale(r: Run, cast: Member[], when: string, failures: string[]): Promise<void> {
  const pages: string[] = [];
  for (const m of cast) pages.push(await fresh(r, m));
  cast.forEach((m, i) => failures.push(...unheld(`${when}, ${m.name}'s`, m.taken, pages[i]!)));
  for (const [i, m] of cast.entries()) {
    const drawn = comparable(pages[i]!);
    const held = comparable(m.page);
    if (held !== drawn) failures.push(`${when}, ${m.name}'s open page is not what a fresh render shows${excerpt(drawn, held)}`);
  }
}

async function tell(r: Run, story: Story): Promise<Outcome> {
  const unshaped = [...misshapen(story), ...(story.budget === undefined ? unbudgeted(r.stories.budget, "the example's") : [])];
  if (unshaped.length > 0) return { name: story.name, failures: unshaped }; // not a story the harness can tell: nothing is run
  const failures: string[] = [];
  const outcome: Outcome = { name: story.name, failures };
  r.failing = failures;
  r.telling = story.name;
  await r.store.begin();
  const cast: Member[] = [];
  try {
    try {
      await gather(r, cast);
    } catch (e) {
      if ((e as { unsigned?: true }).unsigned) return { name: story.name, failures: [(e as Error).message] };
      throw e;
    }

    const who = cast.find((m) => m.name === story.as);
    if (!who) return { name: story.name, failures: [`no one in the cast is called ${story.as}`] };
    /**
     * One step of the story (`phase`): `act`, from where each of `cast`'s inboxes stands (`from`);
     * then, for `observe`, what each was sent and what the ledger took; and what it handed each
     * page, kept and held to the budget (`spent`). A post its route redirects moves its author's
     * `from` on (`posting`): what they were sent before that is still the step's, for `observe`.
     */
    const step = async <T>(phase: Trace["phase"], write: Write | Post | undefined, cast: Member[], act: (from: Map<Member, number>) => Promise<T>): Promise<{ from: Map<Member, number>; done: T }> => {
      const from = mark(r, cast);
      const seen = r.observe && { from: new Map(from), entry: await r.store.last(), holds: inFront(r, cast) };
      const done = await act(from);
      if (seen)
        r.observe!({
          story: story.name,
          phase,
          as: who.name,
          write,
          heard: cast.map((m) => ({ member: m.name, messages: sentSince(r, m, seen.from) })),
          holds: seen.holds,
          ledger: (await r.store.since(seen.entry)).map(({ doc, undoable, ops, inverse }) => ({ doc, undoable: undoable ? 1 : 0, ops, inverse })),
        });
      spent(r, story, outcome, phase, cast, from);
      return { from, done };
    };
    /** `write` sent as a step: what answered it. */
    const sent = (phase: Trace["phase"], write: Write, cast: Member[]) => step(phase, write, cast, async (from) => answerTo(r, who, await send(r, cast, who, write), from));
    const why = await premise(r, cast, story);
    if (why.length > 0) return { name: story.name, failures: [...failures, ...why] }; // not the state the story starts from: nothing it finds would be true of it

    if (story.cannot !== undefined) {
      if (story.from !== undefined) await put(r, cast, who, story.from, failures);
      const before = await snapshot(r, cast, who);
      const ledgerBefore = await r.store.last();
      const tried = story.cannot;
      let reason: string | undefined;
      let onPage = true; // where the refusal is told: on their page, or, for a route's 4xx, the page the browser shows in its place
      if (isPost(tried)) {
        // a route's refusal: a 4xx, or a reason told on the page it came from
        if (controlsOn(who.page).some((c) => postsTo(c, tried))) r.tryable.add(story);
        const { done: answer } = await step("cannot", tried, cast, (from) => posting(r, cast, who, tried, from));
        if (answer.status < 400 && answer.reason === undefined) failures.push(`refused, but it landed: the route answered ${who.name}'s post to ${tried.path} with ${answer.status}, and told them nothing`);
        ({ reason } = answer);
        onPage = answer.status < 400;
      } else {
        // P3: a button on the author's page that sends exactly this, refused without a word, is a control that always fails
        const controls = controlsOn(who.page, failures);
        const buttons = controls.filter((c) => !c.free);
        // a control of the page's own that sends it is one to try by hand; with none, that none does is the point
        const own = controls.filter((c) => !c.pattern);
        if (tried.ops.every((op) => own.some((c) => offers(c, tried.doc, op)))) r.tryable.add(story);
        if (story.told === undefined && tried.ops.every((op) => buttons.some((c) => offers(c, tried.doc, op)))) failures.push(`${who.name}'s page offers this, and it is refused without a word: a control that always fails`);
        const { done: answer } = await sent("cannot", tried, cast);
        if (answer?.type === "patch") failures.push(`refused, but it landed: ${who.name}'s write was echoed back to them`);
        else if (!answer) failures.push(`refused, but ${who.name} was not answered: no refusal carried their write's id`);
        reason = answer?.type === "refused" ? answer.reason : undefined;
      }
      const after = await snapshot(r, cast);
      if (story.told !== undefined) {
        // told why: by the refusal of their own write, and on their page, the one change it may show
        const without = await unsaid(r, who);
        if (reason !== story.told) failures.push(`refused, but ${who.name} was not told "${story.told}"${reason === undefined ? "" : `: they were told "${reason}"`}`);
        else if (onPage && !shows(r, after.get(who.name)!, without, story.told)) failures.push(`refused and told "${story.told}", but ${who.name}'s page does not show it`);
        after.set(who.name, without);
      }
      compare(r, before, after, cast, "refused, but", failures);
      await stale(r, cast, "after the refusal", failures);
      if ((await r.store.last()) !== ledgerBefore) failures.push("refused, but the ledger moved");
      return outcome;
    }

    // Who should notice, and where: a list leaves them where the cast put them; a record puts
    // each where it says, in the example's own grammar for "where" (`Stories.goTo`).
    const seen = new Map<string, string | undefined>(Array.isArray(story.seen) ? story.seen.map((n) => [n, undefined]) : Object.entries(story.seen));
    for (const [name, where] of seen) {
      const m = cast.find((c) => c.name === name);
      if (!m) failures.push(`no one in the cast is called ${name}`);
      else if (where !== undefined) await put(r, cast, m, where, failures);
    }

    if (story.closesTab) {
      // No write: the author's socket goes, and whoever is still looking is told what follows
      // (who is in a room). No control is looked for, and there is nothing to undo.
      const looking = cast.filter((m) => m !== who);
      if (seen.has(who.name)) failures.push(`${who.name} closed their tab: they are not there to see it`);
      const before = await snapshot(r, looking);
      const { from } = await step("closesTab", undefined, looking, async () => {
        await closeTab(r, who);
        await r.server.idle(); // the close handled, and what it set going
        await settle(r, looking);
      });
      if (!landedSince(r, looking, from)) failures.push(`nothing landed: closing ${who.name}'s tab changed nothing`);
      checkUntold(r, looking, story.untold, from, "after the tab closed", failures);
      const after = await snapshot(r, looking);
      await stale(r, looking, "after the tab closed", failures);
      noticed(r, before, after, looking, seen, failures, naming(r, "the tab closing changed", changedSince(r, looking, from)));
      return outcome;
    }

    if (story.opensTab !== undefined) {
      // No write: a tab of the author's session opens at an address, as a link, a bookmark or a
      // reload does, and must be drawn standing there. Whoever is looking -- the author's tab
      // already open among them, which stays where it is -- sees only what the server tells of it.
      // No control is looked for, and there is nothing to undo; the new tab closes after.
      const at = story.opensTab;
      const tab = { name: `${who.name}'s new tab`, cookie: who.cookie, sessionId: who.sessionId, inbox: [], answered: [] } as Partial<Member> as Member;
      if (story.from !== undefined) await put(r, cast, who, story.from, failures);
      const before = await snapshot(r, cast);
      const { from } = await step("opensTab", undefined, cast, async () => {
        await open(r, tab, at);
        await settle(r, [...cast, tab]);
      });
      try {
        const stands = placeOf(tab.page);
        if (stands !== at) failures.push(`${who.name}'s tab, opened at ${JSON.stringify(at)}, stands at ${JSON.stringify(stands)}`);
        checkUntold(r, cast, story.untold, from, "after the tab opened", failures);
        const after = await snapshot(r, cast);
        await stale(r, [...cast, tab], "after the tab opened", failures);
        noticed(r, before, after, cast, seen, failures, naming(r, "the tab opening changed", changedSince(r, cast, from)));
      } finally {
        await closeTab(r, tab);
        await r.server.idle();
      }
      return outcome;
    }

    if (story.from !== undefined) await put(r, cast, who, story.from, failures);
    const does = story.does;
    // P1: the author's page offers a control for it -- unless it comes from no page (`offPage`)
    const offered = controlsOn(who.page, failures);
    if (!story.offPage) {
      if (isPost(does)) {
        if (!offered.some((c) => postsTo(c, does))) failures.push(`${who.name} has no form on their page that posts to ${does.path}`);
      } else for (const op of does.ops) if (!offered.some((c) => offers(c, does.doc, op))) failures.push(`${who.name} has no control on their page for ${op.op} ${op.path} on ${does.doc}`);
    }

    const before = await snapshot(r, cast, who);
    const ledgerBefore = await r.store.last();
    const stood = placeOf(who.page);
    let { from, done: unlanded } = isPost(does)
      ? await step("does", does, cast, async (from) => {
          const answer = await posting(r, cast, who, does, from);
          return answer.status >= 400 || answer.reason !== undefined ? `nothing landed: the route refused ${who.name}'s post to ${does.path}${answer.reason ? `: "${answer.reason}"` : ` with ${answer.status}`}` : undefined;
        })
      : await step("does", does, cast, async (from) => {
          const answer = answerTo(r, who, await send(r, cast, who, does), from);
          return answer?.type === "patch" ? undefined : answer ? `nothing landed: ${who.name}'s write was refused${await refusedBy(r, who, does)}${answer.reason ? `: "${answer.reason}"` : ""}` : `${who.name}'s write was not answered: no echo carried its id`;
        });
    if (unlanded) failures.push(unlanded);
    // Where the write left its author: answering a modal puts it away (off the ledger, a visit),
    // so the undo and the redo are looked at from where each was taken -- where the author stands
    // is theirs, not the write's.
    const landed = placeOf(who.page);
    const moved = r.stories.goTo && stood !== undefined && landed !== undefined && stood !== landed;
    if (process.env.STORY_TRACE) for (const raw of who.inbox.slice(from.get(who))) console.log(`        ${who.name} heard: ${raw.slice(0, 160)}`);
    checkUntold(r, cast, story.untold, from, "after the story", failures);
    const after = await snapshot(r, cast);
    const wrote = await checkTold(r, who, "after the story", undefined, failures);
    const quietAfter = new Map(after).set(who.name, await unsaid(r, who)); // what the undo and the redo are compared with
    const entries = await r.store.since(ledgerBefore);
    await stale(r, cast, "after the story", failures);

    noticed(r, before, quietAfter, cast, seen, failures, naming(r, "the write was to", changedSince(r, cast, from, entries))); // what the author was told is checked on its own (above); an `untold` member is further told of nothing
    if (isPost(does)) return outcome; // a route writes as the server: nothing of the author's to undo

    // off the ledger, or the author has gone (logged out): no undo is theirs to press
    if (entries.length === 0 || !(await active(r, who.sessionId))) {
      if (story.undone !== undefined) failures.push(`no undo follows to tell ${who.name} "${story.undone}"`);
      if (story.redone !== undefined) failures.push(`no redo follows to tell ${who.name} "${story.redone}"`);
      return outcome;
    }

    const neverUndone = entries.every((e) => !e.undoable);
    ({ from } = await sent("undo", UNDO, cast));
    const undid = await checkTold(r, who, "after undo", story.undone, failures, { line: wrote, what: "the write" }); // where the undo left them, before they are put back
    if (moved) await send(r, cast, who, r.stories.goTo!(stood!));
    const afterUndo = await snapshot(r, cast, who);
    await stale(r, cast, "after undo", failures);
    checkUntold(r, cast, story.untold, from, "after undo", failures);
    if (neverUndone) compare(r, quietAfter, afterUndo, cast, "never undone, yet undo changed it", failures);
    else compare(r, before, afterUndo, cast, "undo did not restore", failures);
    // a write never undone has nothing to redo; and the undo may have been their going (a name taken back): no redo is theirs to press
    if (neverUndone || !(await active(r, who.sessionId))) {
      if (story.redone !== undefined) failures.push(`no redo follows to tell ${who.name} "${story.redone}"`);
    } else {
      ({ from } = await sent("redo", REDO, cast));
      await checkTold(r, who, "after redo", story.redone, failures, { line: undid, what: "the undo" });
      if (moved) await send(r, cast, who, r.stories.goTo!(landed!));
      compare(r, quietAfter, await snapshot(r, cast, who), cast, "redo did not restore", failures);
      await stale(r, cast, "after redo", failures);
      checkUntold(r, cast, story.untold, from, "after redo", failures);
    }
    return outcome;
  } finally {
    await disband(r, cast);
    r.failing = undefined;
    r.telling = undefined;
  }
}

/** The cast, connected, each member where their own writes put them: where every story starts, inside a transaction. */
async function gather(r: Run, cast: Member[]): Promise<void> {
  for (const name of Object.keys(r.stories.cast)) cast.push(await connect(r, name));
  await settle(r, cast);
  for (const m of cast) for (const write of r.stories.cast[m.name]!) await send(r, cast, m, write);
}

/** Every tab closed, and the transaction rolled back: the next story reads from the database as the seed left it. */
async function disband(r: Run, cast: Member[]): Promise<void> {
  await Promise.all(cast.map((m) => closeTab(r, m)));
  await r.server.idle(); // every close handled, and what it set going
  await r.store.end();
  await r.documents.release(new Set());
}

/**
 * The ways from `start` to each of `places` for `name`, in `state`, over the controls their pages
 * there offered: a place's own is its address, before any " @ ". A place on the way that
 * `name` has not stood on is stood on now (`visit`), so the way through any page is found; and so
 * is each of `places` reached, so what its own page sends is known (what follows " @ "). Without
 * `visit`, only the pages already walked, leaving out each step in `blocked` (a way by hand).
 */
async function waysFor(r: Run, state: State, name: string, start: string | undefined, places: Set<string>, visit?: (place: string) => Promise<void>, blocked = new Set<string>()): Promise<Map<string, Step[]>> {
  const via = new Map<string, Step | undefined>();
  if (start !== undefined) via.set(start, undefined);
  const queue = start === undefined ? [] : [start];
  const missing = () => [...places].some((p) => !via.has(p));
  while (queue.length > 0 && missing() && via.size < MOST_PLACES) {
    const at = queue.shift()!;
    if (visit && !state.pages.get(name)?.has(at)) await visit(at);
    // a page's own controls before an applet's: by hand, what the page draws is pressed
    const here = [...(state.pages.get(name)?.get(at)?.values() ?? [])].sort((a, b) => Number(!!a.pattern) - Number(!!b.pattern));
    for (const control of here) {
      const to = goesTo(control, r.stories.goTo!);
      if (to === undefined || via.has(to) || blocked.has(stepKey({ from: at, to, control }))) continue;
      via.set(to, { from: at, to, control });
      queue.push(to);
    }
  }
  const ways = new Map<string, Step[]>();
  for (const place of places) {
    if (!via.has(place)) continue;
    if (visit && !state.pages.get(name)?.has(place)) await visit(place);
    const steps: Step[] = [];
    for (let step = via.get(place); step; step = via.get(step.from)) steps.unshift(step);
    ways.set(place, steps);
  }
  return ways;
}

/**
 * Walks the places `wanted` names from where `story` starts -- the cast, then its premise -- in
 * a cast of its own, rolled back after: where each member stood, their pages there, and the ways
 * to each place. Undefined when the premise does not hold: the story says so when it is told.
 * With `aside`, for a story done by hand, each place a step of a way leads to from where it
 * starts is stood on too, so a step a person cannot take can be left for another way, whichever
 * other stories are told.
 */
async function walk(r: Run, story: Story, wanted: Map<string, Set<string>>, aside: boolean): Promise<{ state: State; ways: Map<string, Map<string, Step[]>> } | undefined> {
  const state: State = { pages: new Map(), starts: new Map() };
  const walking: Member[] = [];
  await r.store.begin();
  try {
    await gather(r, walking);
    if ((await premise(r, walking, story)).length > 0) return undefined;
    r.walked = state;
    for (const m of walking) {
      state.starts.set(m.name, placeOf(m.page));
      keep(r, m);
    }
    const ways = new Map<string, Map<string, Step[]>>();
    for (const [name, places] of wanted) {
      const m = walking.find((w) => w.name === name)!;
      const visit = async (place: string) => void (await send(r, walking, m, r.stories.goTo!(place)));
      const found = await waysFor(r, state, name, state.starts.get(name), places, visit);
      ways.set(name, found);
      const pages = state.pages.get(name)!;
      if (aside) for (const { from } of [...found.values()].flat()) for (const c of [...pages.get(from)!.values()]) {
        const to = goesTo(c, r.stories.goTo!);
        if (to !== undefined && !pages.has(to)) await visit(to);
      }
    }
    return { state, ways };
  } finally {
    r.walked = undefined;
    await disband(r, walking);
  }
}

/**
 * Can each story's author get to its `from`, and each member it puts somewhere in `seen` get
 * there, by the controls their pages offer? A place a story names that no control leads to fails
 * that story, by name: the harness put them there, and a person could not. After " @ ", what
 * else the place holds (find's word, a reading) must be sent by a control on the page there.
 * Places on the way that no story stood on are walked in a cast of their own, rolled back after.
 */
async function reach(r: Run, told: { story: Story; outcome: Outcome }[], byHandToo: (story: Story) => boolean): Promise<Map<Story, State>> {
  const startsFrom = new Map<Story, State>();
  const named = told.filter(({ story }) => misshapen(story).length === 0 && r.stories.cast[story.as] !== undefined);
  const placesOf = (story: Story): [name: string, where: string, why: string][] => [
    ...(story.from !== undefined ? [[story.as, story.from, "the story has them act"] as [string, string, string]] : []),
    ...("seen" in story && story.seen && !Array.isArray(story.seen) ? Object.entries(story.seen).filter(([name]) => r.stories.cast[name]).map(([name, where]) => [name, where, "the story has them see it"] as [string, string, string]) : []),
  ];
  // the stories by where they start: the cast alone, or each premise
  const starting = new Map<string, { story: Story; outcome: Outcome }[]>();
  for (const t of named) {
    if (placesOf(t.story).length === 0) continue;
    const start = JSON.stringify(t.story.premise ?? {});
    (starting.get(start) ?? starting.set(start, []).get(start)!).push(t);
  }

  for (const group of starting.values()) {
    const wanted = new Map<string, Set<string>>();
    for (const { story } of group) for (const [name, where] of placesOf(story)) (wanted.get(name) ?? wanted.set(name, new Set()).get(name)!).add(placeIn(where));
    const found = await walk(r, group[0]!.story, wanted, group.some(({ story }) => byHandToo(story)));
    if (!found) continue; // its premise does not hold: the story says so
    const { state, ways } = found;
    const lead = (name: string, where: string, why: string): string | undefined => {
      if (state.starts.get(name) === undefined) return undefined; // a page that says nowhere it stands (a welcome): nowhere to go
      const place = placeIn(where);
      if (!ways.get(name)?.has(place)) return `no control leads ${name} to ${JSON.stringify(place)}, where ${why}`;
      const rest = past(r, where);
      if (!rest) return undefined;
      const there = [...(state.pages.get(name)?.get(place)?.values() ?? [])];
      const unsent = rest.ops.filter((op) => !there.some((c) => offers(c, rest.doc, op)));
      return unsent.length === 0 ? undefined : `no control leads ${name} to ${JSON.stringify(where)}, where ${why}: nothing on their page at ${JSON.stringify(place)} sends ${unsent.map((op) => `${op.op} ${op.path}`).join(", ")}`;
    };
    for (const { story, outcome } of group) {
      outcome.failures.push(...placesOf(story).map(([name, where, why]) => lead(name, where, why)).filter((f): f is string => f !== undefined));
      startsFrom.set(story, state);
    }
  }
  return startsFrom;
}

/**
 * The story by hand, in a browser that is the author's tab (src/modelling/by-hand.ts): from where the
 * story starts, the controls that lead to where it is done, pressed one by one, each landing
 * where it leads -- a step a person cannot take (covered on a phone, say) left for another way,
 * and only when none is left a failure; then the story's write, done with the control that sends
 * it (pressed, typed into and sent, or chosen) or by the story's own `gesture`, which must send
 * the story's write, and land; or, for a refusal a control of the page's own sends, pressed so,
 * and it must not land. A step or a write that only an applet's own control sends is sent as the
 * applet declares it, unless the story says its gesture. Everything else the story says was
 * checked when it was told; this checks that a person could do it. A story with nothing to do
 * by hand (a tab closing, a write from no page, a refusal no control sends where the cast
 * stands) is not pressed.
 */
async function byHand(r: Run, story: Story, hand: Hand, tally: ByHand, state: State | undefined): Promise<string[]> {
  if (story.closesTab || !r.stories.cast[story.as]) return [];
  const tried = story.does !== undefined ? (story.offPage ? undefined : story.does) : r.tryable.has(story) ? story.cannot : undefined;
  const seenAt = story.does !== undefined && story.seen && !Array.isArray(story.seen) ? story.seen[story.as] : undefined;
  const target = story.opensTab === undefined ? (story.from ?? seenAt) : undefined; // a tab opening is entered at its address, and nothing more
  if (!tried && target === undefined && story.opensTab === undefined) return [];
  tally.stories++;
  const failures: string[] = [];
  const by = (what: string): string[] => (failures.push(`by hand, ${what}`), failures);
  await r.store.begin();
  const cast: Member[] = [];
  let opened = false;
  try {
    await gather(r, cast);
    const who = cast.find((m) => m.name === story.as)!;
    if ((await premise(r, cast, story)).length > 0) return []; // the story says so when it is told
    const start = story.opensTab ?? placeOf(who.page); // a tab opened at an address: the browser opens there, and must stand there
    opened = true;
    const wrong = await hand.enter(who.cookie, start);
    if (wrong) return by(wrong);

    let none = false; // the last press found nothing on the page that could send its write at all
    /** Sends `write` from the page -- by `gesture`, where the story says one -- or as an applet declares it when only an applet's own control sends it; why a person could not, if they could not. */
    const press = async (write: Write, gesture?: Gesture): Promise<string | undefined> => {
      const own = controlsOn(who.page).filter((c) => write.ops.some((op) => offers(c, write.doc, op)));
      if (!gesture && own.length > 0 && own.every((c) => c.pattern)) {
        tally.applets++;
        await hand.declare(write); // from the browser's tab, as its applet would send it
        await settle(r, cast);
        return undefined;
      }
      tally.presses++;
      const pressed = gesture ? await hand.gesture(gesture) : await hand.press(write.doc, write.ops);
      await settle(r, cast);
      if ("failure" in pressed) return (none = !!pressed.none), pressed.failure;
      if (pressed.sent.length !== 1 || !sameWrite(pressed.sent[0]!, write)) return `the page sent ${pressed.sent.map(worded).join("; ")}`;
      return undefined;
    };

    if (target !== undefined && r.stories.goTo && start !== undefined && state) {
      const place = placeIn(target);
      const blocked = new Set<string>();
      let first: string | undefined;
      for (let at = start; at !== place; ) {
        const way = blocked.size < MOST_TRIES ? (await waysFor(r, state, who.name, at, new Set([place]), undefined, blocked)).get(place) : undefined;
        if (!way) return first === undefined ? failures : by(`${who.name} could not get to ${JSON.stringify(place)}: ${first}`); // none at all: said when the story was told
        for (const step of way) {
          const why = await press(r.stories.goTo(step.to));
          const stands = why === undefined ? await hand.standsAt(step.to) : await hand.here();
          at = stands ?? step.from;
          if (why === undefined && stands === step.to) {
            await send(r, cast, who, r.stories.goTo(step.to)); // the harness's own tab of theirs goes there too: the page it holds is the one they press on
            continue;
          }
          blocked.add(stepKey(step));
          first ??= `the way to ${JSON.stringify(step.to)} from ${JSON.stringify(step.from)}: ${why ?? `pressed, it left their page at ${JSON.stringify(stands)}`}`;
          break;
        }
      }
      const rest = past(r, target);
      if (rest)
        for (const op of rest.ops) {
          const why = await press({ doc: rest.doc, ops: [op] });
          if (why !== undefined) return by(`${who.name} could not ${op.op} ${op.path} at ${JSON.stringify(place)}: ${why}`);
        }
    }
    if (tried && isPost(tried)) {
      // a form posted to a route: the browser goes where the route sends it, so what landed is what it was told there
      const toldBefore = JSON.stringify((await toldNow(r, who.sessionId)) ?? null);
      tally.presses++;
      const sent = await hand.post(tried);
      if ("failure" in sent) return story.cannot && sent.none ? failures : by(`${who.name} could not post to ${tried.path}: ${sent.failure}`);
      const line = await toldNow(r, who.sessionId);
      const reason = line?.reason !== undefined && JSON.stringify(line) !== toldBefore ? line.reason : undefined;
      const refused = !sent.app || reason !== undefined;
      if (story.does && refused) return by(`nothing landed: the route refused ${who.name}'s post to ${tried.path}${reason ? `: "${reason}"` : ""}`);
      if (story.cannot && !refused) return by(`${who.name}'s post to ${tried.path} landed, and should have been refused`);
    } else if (tried) {
      const from = mark(r, cast);
      const why = await press(tried, story.gesture);
      if (why !== undefined && story.cannot && none) return failures; // nobody could send it from the page: the refusal is for the wire's, as the story says
      if (why !== undefined) return by(`${who.name} could not ${tried.ops.map((op) => `${op.op} ${op.path}`).join(", ")} on ${tried.doc}: ${why}`);
      const landed = landedSince(r, cast, from) || (await hand.echoed()); // their tab's own echo: a write that moves only it is told to nobody else
      if (story.does && !landed) return by(`nothing landed: ${who.name}'s write was refused`);
      if (story.cannot && landed) return by(`${who.name}'s write landed, and should have been refused`);
      if (story.gesture) await hand.quiet(); // an applet's own code: after its write it must be still
    }
    // what the page sent that nothing pressed asked for: before a press, or after the write
    if (hand.strays.length > 0) by(`${who.name}'s page sent ${hand.strays.map(worded).join("; ")} by itself, unasked`);
    return failures;
  } finally {
    if (opened) {
      // the tab closed, and the server told of it, before the story is rolled back
      await hand.leave();
      const open = await stillOpen(cast.find((m) => m.name === story.as)!.sessionId);
      if (open) failures.push(`by hand, ${story.as}'s tab did not close: ${open}`);
    }
    await disband(r, cast);
  }
}

/** Which of `owner`'s checks refuses `ops` to `docId` from `ws`, if one does: its `permit`, or its `shape`, shaping them to nothing. One that throws refuses. Nothing is written. */
async function refuser(r: Run, owner: Resource, ws: Tab, ops: PatchOp[], docId: string): Promise<"permit" | "shape" | undefined> {
  try {
    if (!(await settled(r.documents, () => ops.every((op) => owner.permit?.(ws, op, docId) ?? false)))) return "permit";
  } catch {
    return "permit";
  }
  try {
    return !owner.shape || (await settled(r.documents, () => owner.shape!(ws, docId, ops))).length > 0 ? undefined : "shape";
  } catch {
    return "shape";
  }
}

/**
 * Would the server take `op` to `docId` from `ws`: permitted, shaped to something, and let by
 * whatever stands in front of the store (the model's guards answer `may`; with none, nothing does).
 */
async function takes(r: Run, owner: Resource, ws: Tab, op: PatchOp, docId: string): Promise<boolean> {
  if ((await refuser(r, owner, ws, [op], docId)) !== undefined) return false;
  const shaped = owner.shape ? await settled(r.documents, () => owner.shape!(ws, docId, [op])) : [op];
  const identity = r.example.who ? r.example.who(ws.data.sessionId) : ws.data.sessionId;
  const asked = await r.example.delta.as(identity).call("may", { doc: prefixDoc(owner.docType, docId), ops: shaped.map((o) => ({ ...o, path: (owner.under ?? "") + o.path })) });
  return ![401, 403].includes(asked.error?.code ?? 0);
}

/**
 * Which check refused `write` from `m`'s page, asked again as the server asks (src/rendering/server.ts
 * `write`), as the failure says it: the page did not read its document, which the wire does not
 * write, or its resource's `permit` or `shape`; past them both, delta. Nothing is written.
 */
async function refusedBy(r: Run, m: Member, write: Write): Promise<string> {
  const ws = m.socket;
  const target = await settled(r.documents, () => resolveName(r.byDocType, write.doc, ws));
  if (!target || !(await settled(r.documents, () => sees(target.owner, ws, target.docId)))) return `, as ${m.name}'s page did not read ${write.doc}: it read ${readBy(r, m)}`;
  const { owner, docId } = target;
  if (!isStored(owner)) return `, as ${write.doc} is a ${owner.kind} document, which the wire does not write`;
  const by = await refuser(r, owner, ws, write.ops.filter((op): op is PatchOp => !isTest(op)), docId);
  return by ? ` by ${owner.docType}'s ${by}` : ` past ${owner.docType}'s permit and shape: delta applied nothing`;
}

/**
 * Hidden verbs: where the cast starts, as each of them, each op on each path of every
 * document their pages read -- and on each path a story or a page writes there -- that no story
 * tells them and no page offered them, a member of a collection as any one (`anyOne`), with the
 * value there and each a story or a page writes to that path. One the server would take is a
 * write nobody would know to make: said, not failed, since a permit may be wider than its stories
 * on purpose. Only the permit and the shape are asked, so nothing is written; Undo and Redo are
 * the kernel's, on every page, and are not asked.
 */
async function hiddenVerbs(r: Run): Promise<Warning[]> {
  const found = new Map<string, Map<string, string[]>>(); // document → verb → who may
  // what goTo writes is the URL bar's, anyone's: for each place a story names
  const places = toldOf(r.stories).flatMap((s) => [s.from, s.opensTab, ...(s.seen && !Array.isArray(s.seen) ? Object.values(s.seen) : [])]);
  const anyone = r.stories.goTo ? ["", ...places].filter((p) => typeof p === "string").map(r.stories.goTo) : [];
  /** Is `n` who is asked about: `name`, or anyone when it names none? */
  const whose = (n: string, name?: string): boolean => name === undefined || n === name;
  /** Each op on `doc` the stories tell `name` (anyone, with none), and each a page of theirs offered. */
  const toldTo = (doc: string, name?: string): { op: string; path: string; value?: unknown; pattern?: true }[] => {
    const writes = [...anyone, ...Object.entries(r.stories.cast).flatMap(([n, ws]) => (whose(n, name) ? ws : [])), ...toldOf(r.stories).flatMap((s) => [...Object.entries(s.premise ?? {}).flatMap(([n, ws]) => (whose(n, name) ? ws : [])), ...(whose(s.as, name) ? [writeOf(s)] : [])])];
    return [...writes.flatMap((w) => (w && sameDoc(w.doc, doc) ? w.ops : [])), ...[...r.met].flatMap(([n, { offered }]) => (whose(n, name) ? [...offered.values()].filter((c) => sameDoc(c.doc, doc)) : []))];
  };
  await r.store.begin();
  const cast: Member[] = [];
  try {
    await gather(r, cast);
    for (const m of cast) {
      const ws = m.socket;
      for (const doc of r.met.get(m.name)!.reads) {
        const { docType, docId } = doc.includes(":") ? splitDoc(doc) : { docType: doc, docId: m.sessionId };
        const owner = r.byDocType.get(docType)!;
        if (!owner.permit || docType === "ledger" || !isStored(owner)) continue;
        const value = valueAt(await settled(r.documents, () => r.documents.read(prefixDoc(docType, docId))), owner.under ?? "");
        const saying = (op: string, path: string): string => `${op} ${anyOne(path, value) || "the document"}`; // a verb, as the warning says it
        const known = new Set(toldTo(doc, m.name).map((w) => saying(w.op, w.path)));
        const written = toldTo(doc); // anyone's: more paths to try, and the values written there
        const paths = new Set([...pathsIn(value), ...written.filter((w) => !w.pattern).map((w) => w.path)]);
        const verbs = found.get(doc) ?? found.set(doc, new Map()).get(doc)!;
        for (const path of paths) {
          const any = anyOne(path, value);
          const values = new Map([valueAt(value, path) ?? null, ...written.filter((w) => w.value !== undefined && anyOne(w.path, value) === any).map((w) => w.value)].map((v) => [JSON.stringify(v), v]));
          for (const verb of ["add", "replace", "remove"] as const) {
            const said = saying(verb, path);
            if (known.has(said) || verbs.get(said)?.includes(m.name)) continue;
            for (const v of verb === "remove" ? [undefined] : values.values()) {
              if (!(await takes(r, owner, ws, { op: verb, path, ...(verb !== "remove" && { value: v }) }, docId))) continue;
              (verbs.get(said) ?? verbs.set(said, []).get(said)!).push(m.name);
              break;
            }
          }
        }
      }
    }
  } finally {
    await disband(r, cast);
  }
  return [...found].flatMap(([doc, verbs]) => {
    const byWho = new Map<string, string[]>();
    for (const [said, who] of verbs) (byWho.get(listed(who)) ?? byWho.set(listed(who), []).get(listed(who))!).push(said);
    return [...byWho].map(([who, said]) => ({ story: `${doc}: a write no story tells and no page offers`, says: `${who} may ${said.join(", ")}` }));
  });
}

export async function run(
  example: Example,
  stories: Stories,
  observe?: (trace: Trace) => void,
  options: {
    byHand?: boolean;
    /** Told, after the stories, every place each of the cast can get to from where the cast starts, by the controls their pages offer, and the controls each page there offers. */
    everywhere?: (member: string, place: string, controls: Control[]) => void;
  } = {},
): Promise<Report> {
  const server = createServer(example, 0);
  const tapped = await tap(server.port!, example.at);
  const { draw, page, documents, byDocType } = assemble(example);
  const r: Run = {
    example,
    stories,
    observe,
    server,
    tapped,
    draw,
    page,
    documents,
    byDocType,
    store: example.store ?? (await sqliteStore()),
    tryable: new Set(),
    warned: new Map(),
    met: new Map(),
    wired: new Set(),
    miswired: new Map(),
    writes: 0,
    opened: 0,
    owned: new Set(),
  };
  const outcomes: Outcome[] = [];
  let byHandTally: ByHand | undefined;
  const hearFailures = onFailure((what, err) => r.failing?.push(`the server failed ${what}: ${err instanceof Error ? err.message : String(err)}`));
  const hidden: Warning[] = []; // a permit wider than its stories (`hiddenVerbs`)

  try {
    const only = process.env.STORY; // run only the stories whose name contains this
    const told: { story: Story; outcome: Outcome }[] = [];
    for (const story of toldOf(stories)) if (!only || story.name.includes(only)) told.push({ story, outcome: await tell(r, story) });
    // a cast that cannot sign in fails every story, said; there is nowhere to walk, nothing to press
    const unsigned = told.some(({ outcome }) => outcome.failures.some((f) => / could not sign in at /.test(f)));
    if (unsigned) outcomes.push(...told.map(({ outcome }) => outcome));
    else {
    // by hand: with `byHand` each story that has something to do there, and without it each that says its gesture
    const byHandToo = (story: Story): boolean => (options.byHand || story.gesture !== undefined) && misshapen(story).length === 0;
    const startsFrom = stories.goTo ? await reach(r, told, byHandToo) : new Map<Story, State>();
    if (stories.goTo) {
      // a place nobody can get to, so each member's walk goes everywhere it can, and meets every page
      const nowhere = new Map(Object.keys(stories.cast).map((name) => [name, new Set(["\u0000"])]));
      const { state } = (await walk(r, {} as Story, nowhere, false))!; // from where the cast starts: no premise to fail
      if (options.everywhere) for (const [member, places] of state.pages) for (const [place, controls] of places) options.everywhere(member, place, [...controls.values()]);
    }
    hidden.push(...(await hiddenVerbs(r)));
    outcomes.push(...told.map(({ outcome }) => outcome));
    const handed = told.filter(({ story }) => byHandToo(story));
    if (handed.length > 0) {
      const started = performance.now();
      const tally: ByHand = { stories: 0, presses: 0, applets: 0, ms: 0 };
      const hand = new Hand(server.url, example.at);
      try {
        for (const { story, outcome } of handed) outcome.failures.push(...(await byHand(r, story, hand, tally, startsFrom.get(story))));
      } finally {
        hand.close();
      }
      tally.ms = Math.round(performance.now() - started);
      byHandTally = tally;
    }
    }
  } finally {
    hearFailures();
    server.stop(true);
    tapped.close();
  }
  const failed = outcomes.filter((o) => o.failures.length > 0).length;
  const unproven = unprovenOf(stories).map((s) => s.name);
  return { outcomes, passed: outcomes.length - failed, failed, ...(unproven.length > 0 && { unproven }), ...(r.warned.size + r.miswired.size + hidden.length > 0 && { warnings: [...r.warned.values(), ...r.miswired.values(), ...hidden] }), ...(byHandTally && { byHand: byHandTally }) };

}

/** The report, story by story; with `wire`, under each story what it cost there (`cost`). */
export function print(report: Report, { wire = false }: { wire?: boolean } = {}): void {
  for (const o of report.outcomes) {
    console.log(`${o.failures.length ? "FAIL" : " ok "}  ${o.name}`);
    for (const f of o.failures) console.log(`        ${f}`);
    if (wire && o.wire) for (const line of cost(o.wire)) console.log(`        ${line}`);
  }
  const warnings = report.warnings ?? [];
  for (const w of warnings) console.log(`warn  ${w.story}\n        ${w.says}`);
  const unproven = report.unproven ?? [];
  for (const name of unproven) console.log(`  ?   ${name}\n        unproven: no body yet, so the harness cannot tell it (a test of the app does)`);
  console.log(`\n${report.passed} passed, ${report.failed} failed${unproven.length ? `, ${unproven.length} unproven` : ""}${warnings.length ? `, ${warnings.length} ${warnings.length === 1 ? "warning" : "warnings"}` : ""}`);
  const h = report.byHand;
  if (h) console.log(`${h.stories} done by hand in a browser the size of a phone: ${h.presses} presses, ${h.applets} sent as an applet declares, in ${(h.ms / 1000).toFixed(1)}s`);
}

/**
 * A story's cost, in words: its write's size, said once, then each member it handed anything, the
 * bytes, as they crossed the wire, and the biggest part; and after it, the bytes its undo and redo
 * handed them, where it has them.
 */
function cost({ write, opens, handed, undo, redo }: Wire): string[] {
  const members = [...new Set([...handed, ...(undo ?? []), ...(redo ?? [])].map((h) => h.member))];
  const step = write === undefined ? `a tab ${opens ? "opening" : "closing"} handed` : `a ${count(write)}-byte write handed`;
  if (members.length === 0) return [`${step} nothing`];
  const width = Math.max(...members.map((m) => m.length));
  const bytes = (phase: Handed[], member: string): string => count(phase.find((h) => h.member === member)?.bytes ?? 0);
  return [
    step,
    ...members.map((member) => {
      const h = handed.find((h) => h.member === member);
      const then = [undo && `undo ${bytes(undo, member)}`, redo && `redo ${bytes(redo, member)}`].filter(Boolean).join(", ");
      return `  ${member.padEnd(width)} ${h ? `${count(h.bytes)} bytes (${size(h.sent)} on the wire): ${h.most.part} ${size(h.most.bytes)}` : "nothing"}${then && `; ${then}`}`;
    }),
  ];
}

function where(page: string | undefined): string {
  return page === undefined ? "" : ` on ${JSON.stringify(page)}`;
}

/**
 * Waits for the server to let go of every socket of `sessionId` but one (the harness's own), as it
 * does of a tab that closes: what the server hears of a browser, which no question on the harness's
 * own sockets can wait for. Why not, if it has not in `ms`.
 */
export async function stillOpen(sessionId: string, ms = 2000): Promise<string | undefined> {
  const open = () => allOpenSockets().filter((ws) => ws.data.sessionId === sessionId).length;
  for (const end = performance.now() + ms; open() > 1 && performance.now() < end; ) await Bun.sleep(5);
  return open() > 1 ? `the server still held ${open()} of its sockets after ${ms} ms` : undefined;
}

/** With STORY_DIFF set, where two pages first part company -- for the builder, not the report. */
function excerpt(a: string, b: string): string {
  if (!process.env.STORY_DIFF) return "";
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const from = Math.max(0, i - 40);
  return `\n          expected …${a.slice(from, i + 80)}…\n          got      …${b.slice(from, i + 80)}…`;
}
