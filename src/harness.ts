import { db } from "./db";
import type { Example } from "./example";
import { assemble } from "./compartments";
import { createServer } from "./server";
import { STORY_KEYS, type Gesture, type Stories, type Story, type Write } from "./stories";
import { applyPatch, type PatchOp, type WriteId } from "./json-patch";
import { activeDocuments, Pending, setActiveDocuments, settled, type Documents } from "./documents";
import { onFailure } from "./failed";
import { comparable, decoded, ownProps, splitTag } from "./parts";
import { toldNothing, toldTo, type Line } from "./refusal";
import { esc } from "./html";
import { Hand, sameDoc, sameWrite, worded } from "./by-hand";
import { allOpenSockets } from "./compartments/audience";
import { size, tap } from "./costs";

export { comparable };

// Runs an example's stories against it, over real sockets, and reports by story name. See
// stories.md ("The harness"). Canon 1 is checked here: for every member of the cast, a render
// from the server's copy of the documents, as a page is drawn (only Canon 2's reads the tables),
// before and after the story, compared -- so a change that reaches a page through an applet's
// patch (a tick) counts the same as one that reaches it as HTML. A member a
// story says sees it on a page is put on that page first (`Stories.page`), since a person sees
// only the page they are on. Then the story is undone and redone as its author, and the pages
// must go back and forth with it; a write the ledger calls a fact (undoable = 0) must survive its
// undo instead, and an author the example no longer counts as active (logged out) gets no undo.
// Every write carries an id, as a page's does, so what answers it is its own: a `does` has landed
// when its author is echoed the change with the write's id, whoever else writes meanwhile.
// A `cannot` must change no page, add nothing to the ledger, and be answered: refused, by its own
// write's id, and the writer's page handed back, showing them why when the story says what they
// are `told` -- the reason its refusal gave, and nothing else. What a write, its undo or its redo
// tells its author (src/refusal.ts) is of that moment, so their pages are compared without it, and
// it is checked on its own: on their page, and after the undo what the story's `undone` says,
// when it says. For a `does`, nobody the story
// does not say sees it may notice it: a story names everyone
// whose page changes. Delivery is checked as well as pages: a member the story says is `untold`
// must be told of no document -- no patch -- by the write, its undo or its redo, and anything the
// kernel reports failing while a story runs (a message, a drawing, a change being told) fails the
// story. A tab that closes (`closesTab`) is told by its socket going: whoever is still looking must
// see it as the story says, and there is nothing to undo. Each story runs inside one database
// transaction that is rolled back afterwards, so every story starts from the cast and its own
// premise alone.
//
// Canon 2 is checked here too, without a browser: every member's open page is kept as the client
// would keep it -- a full render replaces it, a fragment render is applied target by target -- and
// after the story, its undo and its redo, that page must equal a fresh render from storage: each
// document the page reads read again from delta's tables, not from the copy the server draws from.
// So a write that reaches the tables but not someone's open page fails, by name, and so does a
// copy that drifted from the tables, which a render from the copy would only compare with itself.
// An applet that takes its document's patches itself (`data-doc`) is compared without its props:
// they follow the patches, not the renders. What the morph does with the HTML is the browser
// tests' to check.
//
// By hand, a story is done again in a browser the size of a phone, as a person does it
// (src/by-hand.ts): each story that says its `gesture`, and with `byHand` each write a page sends
// and each refusal a control of the page sends (stories.md, the harness, step 6). Its write must
// be what the page sends, and land, or be refused.
//
// Every story's cost on the wire is kept: what its step (the write, the refusal, the tab closing),
// and the undo and the redo of a write, handed each member's page, as the page takes it and as it
// crossed the wire, counted by the costs' tap (src/costs.ts) that the cast's sockets go through. A
// story, or the example, may say a budget, and a page handed more than it by any of them fails the
// story: a person's undo is a write too, and its bytes go to every page.

/** What a story handed each member's page: the write's own size (none when a tab closes), and each member handed anything by its step, by its undo, and by its redo, when it has them. */
export type Wire = { write?: number; handed: Handed[]; undo?: Handed[]; redo?: Handed[] };
/** What one member's page was handed: its bytes as the page takes them, as they crossed the wire (compressed), and the biggest part of them. */
export type Handed = { member: string; bytes: number; sent: number; most: Part };
/** A piece of what a page was handed, by what it is (`largest`), and its bytes before compression. */
export type Part = { part: string; bytes: number };

export type Outcome = { name: string; failures: string[]; wire?: Wire };

/** One step of a story's run, for `run`'s observer: who wrote what (or closed their tab), what every member was sent, and what the ledger took. For a sequence drawn from a real run. */
export type Trace = {
  story: string;
  phase: "does" | "cannot" | "undo" | "redo" | "closesTab";
  as: string;
  /** None when a tab closes. */
  write?: Write;
  heard: { member: string; messages: Heard[] }[];
  /** What the ledger took: the ops as written, and their inverse -- which holds what was there before. */
  ledger: { doc: string; undoable: number; ops: PatchOp[]; inverse: PatchOp[] }[];
};
/** What the stories found props cost (`propsCost`), which does not fail them: each kind for each applet once, in the first story that sent it. */
export type Warning = { story: string; says: string };
export type Report = { outcomes: Outcome[]; passed: number; failed: number; warnings?: Warning[]; byHand?: ByHand };

/** The stories done by hand in a browser (`byHand`, or a story's own `gesture`): how many, how many presses (a button pressed, a form typed into and sent, a drag), how many writes sent as an applet declares them, and how long it took. */
export type ByHand = { stories: number; presses: number; applets: number; ms: number };

type Member = { name: string; sessionId: string; ws: WebSocket; inbox: string[]; page: string; taken: Map<string, Taken>; answered: (() => void)[] };
type HtmlOp = { op: "replace" | "tag" | "after" | "before" | "remove"; target: string; html?: string };
type Snapshot = Map<string, string>;


type LedgerRow = { id: number; doc: string; undoable: number; ops: string; inverse: string };

/**
 * The ledger the stories read, to know whether a story has an undo to check and whether a refusal
 * moved nothing: delta's (`delta_ledger`, in the same database), whose fresh entries -- not an
 * undo's or a redo's -- a story's write starts.
 */
function ledgerOf(): { max(): number; since(id: number): LedgerRow[] } {
  const max = db.query<{ id: number | null }, []>("SELECT MAX(id) AS id FROM delta_ledger");
  const since = db.query<LedgerRow, [number]>("SELECT id, doc, undoable, ops, inverse FROM delta_ledger WHERE id > ? AND undoes IS NULL ORDER BY id");
  return { max: () => max.get()?.id ?? 0, since: (id) => since.all(id) };
}

/** A time after every write: a document opened as it stood then (`open_at`) is its rows as they stand. */
const AFTER_EVERY_WRITE = "9999-12-31T23:59:59.999Z";

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

export type Heard = { type: string; html?: string; ops?: HtmlOp[]; doc?: string; version?: number; id?: WriteId; reason?: string };

// The patch stream, checked. An applet that takes a document's patches (`data-doc`) holds props: the
// ones the last render gave it, with every patch for that document laid on since, at the place in
// its props the document sits (`data-under`, the root by default). That is what the client's applet
// holds, and it must be what a fresh render would give it -- or the ops did not say everything the
// document did, or props that changed for another reason were never sent.

/** An applet that takes a document's patches, as a member's page holds it: the props a render gave it, the document's version they hold when the mount says it (`data-v`), and the ops taken since. */
type Taken = { applet: string; doc: string; under: string; props: string; v?: number; ops: PatchOp[] };

/** The applets on a page that take a document's patches, by their id (or part, or place). */
export function takersOn(page: string): Map<string, Omit<Taken, "ops">> {
  const found = new Map<string, Omit<Taken, "ops">>();
  new HTMLRewriter()
    .on("[data-doc]", {
      element(el) {
        const applet = el.getAttribute("data-applet") ?? "";
        const key = el.getAttribute("id") ?? el.getAttribute("data-eta-part") ?? `${applet}#${found.size}`;
        const v = el.getAttribute("data-v");
        found.set(key, { applet, doc: el.getAttribute("data-doc")!, under: el.getAttribute("data-under") ?? "", props: decoded(el.getAttribute("data-props") ?? "null"), ...(v !== null && { v: Number(v) }) });
      },
    })
    .transform(page);
  return found;
}

// What props cost (todo n94). An applet's data comes from a document it watches, and its props
// say only what to show and for whom; props that carry the data themselves go again whole with
// every change to it. So the harness says -- it does not fail -- where a render sends a mount whose
// own props (the document it watches left out) pass MOST_PROPS, and where a render in parts sends a
// mount with the very props the page already had for it: a part replaced around it, or its tag
// sent for something else on it.

/** How big a mount's own props, as JSON, may be before the harness says so: the document it watches left out. */
export const MOST_PROPS = 4096;

/** A cost a render put on the wire in props: which kind, the applet, and what to say. */
export type PropsCost = { kind: "big" | "again"; applet: string; says: string };

type Mount = { key: string; applet: string; own: string; watching: boolean };

/** The applet mounts in some HTML, keyed as `takersOn` keys them, each with its own props: the document it watches left out. */
function mountsIn(html: string): Mount[] {
  const found: Mount[] = [];
  new HTMLRewriter()
    .on("[data-applet][data-props]", {
      element(el) {
        const applet = el.getAttribute("data-applet")!;
        const key = el.getAttribute("id") ?? el.getAttribute("data-eta-part") ?? `${applet}#${found.length}`;
        const props = decoded(el.getAttribute("data-props")!);
        const watching = el.hasAttribute("data-doc");
        found.push({ key, applet, watching, own: watching ? ownProps(props, decoded(el.getAttribute("data-under") ?? "")) : props });
      },
    })
    .transform(html);
  return found;
}

/** What a render sends `whose` page, drawn as `page`, costs in props: a mount whose own props pass MOST_PROPS; in parts, one sent with the props the page had for it. */
export function propsCost(whose: string, page: string, message: Heard): PropsCost[] {
  if (message.type !== "render") return [];
  const sent = message.html !== undefined ? [{ html: message.html, op: undefined }] : (message.ops ?? []).flatMap((op) => (op.html === undefined ? [] : [{ html: op.html, op }]));
  const had = new Map(mountsIn(page).map((m) => [m.key, m.own]));
  const costs: PropsCost[] = [];
  for (const { html, op } of sent) {
    for (const m of mountsIn(html)) {
      const bytes = Buffer.byteLength(m.own);
      if (bytes > MOST_PROPS) {
        const how = m.watching ? "keep them to what it shows, and for whom" : "let it watch the document they come from (appletProps(props, { doc })), and keep them to what it shows, and for whom";
        costs.push({ kind: "big", applet: m.applet, says: `${whose} was sent the ${m.applet} applet's props, ${size(bytes)}${m.watching ? " beside the document it watches" : ""}, which go again whenever they change: ${how}` });
      }
      if (op && had.get(m.key) === m.own) {
        const itself = mountsIn(splitTag(html)[0])[0]?.key === m.key; // the part is the mount
        const how =
          op.op === "tag" ? "with its tag, for something else on it: keep that beside its mount"
          : itself ? "drawn again for what the server paints inside it, which the applet paints over: let it watch the document it paints from"
          : `in a part drawn again around it (${op.target}) for something else in it: make what changed there a part of its own`;
        costs.push({ kind: "again", applet: m.applet, says: `${whose} was sent the ${m.applet} applet's props again, as they were, ${how}` });
      }
    }
  }
  return costs;
}

/**
 * A control a page offers (src/html.ts `write`): the document, op and path it writes, and the value
 * a button carries (`data-value`, sent as a string). A field or a form writes whatever is typed, so
 * any value. An applet draws its own controls in
 * the browser, so it offers only what its mount says it writes (`data-writes`, src/html.ts), where
 * a `*` segment of its path is any one, with any value or only the ones it names; one that says
 * nothing offers nothing, whatever document it reads (`data-doc`), as the clock's face writes
 * nothing to the clock it shows.
 */
export type Control = { doc: string; op: string; path: string; value?: string; free: boolean; pattern?: true };

const OPS: readonly string[] = ["add", "replace", "remove"];

/** Is this what `appletWrites` puts on a mount, one write of it: a document, an op and a JSON Pointer path, and the only values it sends, if it names them? */
const isDeclared = (w: unknown): w is { doc: string; op: string; path: string; values?: (string | number | boolean)[] } => {
  const { doc, op, path, values } = (typeof w === "object" && w !== null ? w : {}) as Record<string, unknown>;
  const valued = values === undefined || (Array.isArray(values) && values.length > 0 && values.every((v) => ["string", "number", "boolean"].includes(typeof v)));
  return typeof doc === "string" && doc !== "" && typeof op === "string" && OPS.includes(op) && typeof path === "string" && (path === "" || path.startsWith("/")) && valued;
};

/** Is this a story's gesture (`Gesture`, src/stories.ts): a press on one selector, or a drag from one to another, and nothing else? */
const isGesture = (g: unknown): boolean => {
  if (typeof g !== "object" || g === null || Object.keys(g).length !== 1) return false;
  const { press, drag } = g as Record<string, unknown>;
  return typeof press === "string" || (Array.isArray(drag) && drag.length === 2 && drag.every((s) => typeof s === "string"));
};

// Where a page's elements end. A streaming parser is told of an end tag that is written, and of
// one a parent's end implies; not of one the next start tag implies, as HTML leaves out `</p>`,
// `</li>` and `</tr>`. So the elements open here are kept, and closed as HTML's rules close them.

/** An element open where the parser is: its tag, and whether the browser lets anyone press what is in it. */
type Open = { tag: string; blocks?: "always" | "fieldset"; legends?: number; frees?: boolean; closed?: true; ends?: () => void; disabled?: true };

/** The start tags that close an open `<p>`: HTML's "close a p element" (in button scope). */
const CLOSES_P = new Set(["address", "article", "aside", "blockquote", "center", "details", "dialog", "dir", "div", "dl", "dd", "dt", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "li", "listing", "main", "menu", "nav", "ol", "p", "pre", "search", "section", "summary", "table", "ul", "xmp"]);
/** Where looking for an element to close stops: the scopes HTML looks in. */
const SCOPE = ["html", "table", "td", "th", "caption", "marquee", "object", "applet", "template", "button"];
/** For each start tag, what open element it closes when that element's end tag was left out, and where looking stops. */
const IMPLIED: Record<string, { closes: string[]; stops: string[] }> = {
  li: { closes: ["li"], stops: [...SCOPE, "ul", "ol"] },
  dt: { closes: ["dt", "dd"], stops: [...SCOPE, "dl"] },
  dd: { closes: ["dt", "dd"], stops: [...SCOPE, "dl"] },
  tr: { closes: ["tr"], stops: ["html", "template", "table", "tbody", "thead", "tfoot"] },
  td: { closes: ["td", "th"], stops: ["html", "template", "table", "tr"] },
  th: { closes: ["td", "th"], stops: ["html", "template", "table", "tr"] },
  tbody: { closes: ["tbody", "thead", "tfoot"], stops: ["html", "template", "table"] },
  thead: { closes: ["tbody", "thead", "tfoot"], stops: ["html", "template", "table"] },
  tfoot: { closes: ["tbody", "thead", "tfoot"], stops: ["html", "template", "table"] },
  option: { closes: ["option"], stops: ["select", "datalist", "optgroup", ...SCOPE] },
  optgroup: { closes: ["option", "optgroup"], stops: ["select", ...SCOPE] },
};

/**
 * Every control on a page, as the server drew it: one the browser sends nothing from is none --
 * drawn `disabled`, or `inert`, `hidden`, in a `<template>` or in a disabled fieldset (but for
 * its first legend), itself or by what it is in. The page's address (`data-page-write`) is not on
 * the page: the URL bar and the back button send it, so it offers nothing. An applet's
 * declaration that is not `[doc, op, path]` (the form before ops, a hand-written attribute)
 * offers nothing, and is said in `misdeclared`.
 */
export function controlsOn(page: string, misdeclared: string[] = []): Control[] {
  const found: Control[] = [];
  const spec = (attr: string | null) => (attr === null ? undefined : (JSON.parse(decoded(attr)) as { doc: string; op: string; path: string }));
  const open: Open[] = [];
  const closeTo = (at: number) =>
    open.splice(at).reverse().forEach((e) => {
      e.closed = true;
      e.ends?.();
    });
  // a select that writes sends only what it can choose: each option not disabled, by its value or its words
  let choosing: { spec: { doc: string; op: string; path: string }; option?: { text: string } } | undefined;
  const pressable = (el: HTMLRewriterTypes.Element): boolean =>
    !el.hasAttribute("inert") && !el.hasAttribute("hidden") && !open.some((e, i) => e.blocks === "always" || (e.blocks === "fieldset" && !open[i + 1]?.frees));
  new HTMLRewriter()
    .on("*", {
      element(el) {
        const tag = el.tagName;
        for (const implied of [CLOSES_P.has(tag) && { closes: ["p"], stops: SCOPE }, IMPLIED[tag]]) {
          if (!implied) continue;
          for (let i = open.length - 1; i >= 0 && !implied.stops.includes(open[i]!.tag); i--) {
            if (implied.closes.includes(open[i]!.tag)) {
              closeTo(i);
              break;
            }
          }
        }
        if (!el.canHaveContent || el.selfClosing) return; // nothing inside it: its own attributes say it (pressable)
        const parent = open.at(-1);
        const entry: Open = { tag };
        if (el.hasAttribute("inert") || el.hasAttribute("hidden") || tag === "template") entry.blocks = "always";
        else if (tag === "fieldset" && el.hasAttribute("disabled")) entry.blocks = "fieldset";
        if (tag === "legend" && parent?.tag === "fieldset") entry.frees = (parent.legends = (parent.legends ?? 0) + 1) === 1; // its first legend is not disabled
        if (tag === "option" && choosing && !el.hasAttribute("disabled") && !(parent?.tag === "optgroup" && parent.disabled)) {
          const value = el.getAttribute("value");
          const option = { text: "" };
          const said = choosing;
          if (value === null) choosing.option = option;
          entry.ends = () => void found.push({ ...said.spec, value: value === null ? option.text.replace(/\s+/g, " ").trim() : decoded(value), free: false });
        }
        if (tag === "optgroup" && el.hasAttribute("disabled")) entry.disabled = true; // its options choose nothing
        open.push(entry);
        el.onEndTag(() => {
          if (!entry.closed) closeTo(open.indexOf(entry));
        });
      },
    })
    .on("option:not([value])", { text: (t) => void (choosing?.option && (choosing.option.text += t.text)) })
    .on("[data-write]", {
      element(el) {
        if (!pressable(el) || (el.hasAttribute("disabled") && ["button", "input", "textarea", "select"].includes(el.tagName))) return; // the browser sends nothing from it
        const s = spec(el.getAttribute("data-write"))!;
        if (el.tagName === "select") {
          // what it can choose, as each option ends; several at once is no one value, which the client never sends
          if (el.hasAttribute("multiple")) return;
          const at = open.at(-1)!;
          choosing = { spec: s };
          at.ends = () => void (choosing = undefined);
          return;
        }
        if (el.tagName === "input" && el.getAttribute("type") === "radio") return void found.push({ ...s, value: decoded(el.getAttribute("value") ?? "on"), free: false }); // a radio sends its own value
        const value = el.getAttribute("data-value");
        found.push({ ...s, value: value === null ? undefined : decoded(value), free: ["form", "input", "textarea"].includes(el.tagName) });
      },
    })
    .on("[data-writes]", {
      element(el) {
        if (!pressable(el)) return;
        const raw = decoded(el.getAttribute("data-writes")!);
        const wrong = (what: string) => misdeclared.push(`applet declaration must be [doc, op, path]: ${el.getAttribute("data-applet") ?? "an applet"} says ${what}`);
        let said: unknown;
        try {
          said = JSON.parse(raw);
        } catch {
          return void wrong(raw);
        }
        if (!Array.isArray(said)) return void wrong(raw);
        for (const w of said) {
          if (!isDeclared(w)) wrong(JSON.stringify(w));
          else if (!w.values) found.push({ doc: w.doc, op: w.op, path: w.path, free: true, pattern: true });
          else for (const value of w.values) found.push({ doc: w.doc, op: w.op, path: w.path, value: String(value), free: false, pattern: true });
        }
      },
    })
    .transform(page);
  return found;
}

/** Where a page stands: its address, which the kernel's client mirrors in the URL (`data-page`). */
export const placeOf = (page: string): string | undefined => {
  const m = /\sdata-page="([^"]*)"/.exec(page);
  return m ? decoded(m[1]!) : undefined;
};

/** Does a path an applet names (`*` for any one member: an id, never `-`, the end of a list an append names as such) name this one? */
const fits = (pattern: string, path: string): boolean => {
  const want = pattern.split("/");
  const have = path.split("/");
  return want.length === have.length && want.every((segment, i) => (segment === "*" ? have[i] !== "-" : segment === have[i]));
};

/** Does `c` send this op to this document? A free control sends any value; a button only its own. */
export function offers(c: Control, doc: string, op: PatchOp): boolean {
  if (!sameDoc(c.doc, doc)) return false;
  if (c.pattern) return c.op === op.op && fits(c.path, op.path) && (c.value === undefined || ("value" in op && String(op.value) === c.value)); // an applet's own: exactly what its mount names
  if (c.op !== op.op || c.path !== op.path) return false;
  return c.free || (c.value === undefined ? !("value" in op) || op.value === undefined : "value" in op && String(op.value) === c.value);
}

/**
 * Where a control goes, if it goes anywhere: the address `goTo` makes exactly its write of -- a
 * button's own value (`data-value`), the one write a person sends by pressing it, or one an
 * applet's mount names for a tap (`appletWrites`, with values). A field, a form and an applet that
 * names no value take any value, so they lead nowhere in particular; and the URL bar and the back
 * button are not on the page (`controlsOn`).
 */
export function goesTo(c: Control, goTo: (address: string) => Write): string | undefined {
  if (c.free || c.value === undefined) return undefined;
  const w = goTo(c.value);
  return sameDoc(w.doc, c.doc) && w.ops.some((op) => op.op === c.op && op.path === c.path && "value" in op && String(op.value) === c.value) ? c.value : undefined; // the op of it that sets the address: going somewhere may put other things away too
}

/** One way on: from where a member stood, the control on their page there that took them to `to`. */
export type Step = { from: string; to: string; control: Control };

/** The most ways by hand the harness tries to one place, each leaving out a step a person could not take. */
const MOST_TRIES = 20;

const stepKey = (step: Step): string => `${step.from}\n${JSON.stringify(step.control)}`;

/** The most places the harness walks for one member, looking for a way to a place a story names: enough for any page's drawers, not for a calendar's every month. */
const MOST_PLACES = 400;

/**
 * A member's applets after a render, as the client keeps them: one the render carries (the page
 * whole, or in a part it sends) with props other than those it holds, patched since, starts again
 * from them; one it carries with what it holds, or does not carry, keeps the ops it has taken --
 * its attribute is still the render's that gave it them. Without `message`, the page came whole.
 */
export function retake(taken: Map<string, Taken>, page: string, message?: Heard): void {
  const now = takersOn(page);
  const carried = message?.html !== undefined || !message ? undefined : new Set((message.ops ?? []).flatMap((op) => (op.html === undefined ? [] : [...takersOn(op.html).keys()])));
  for (const key of taken.keys()) if (!now.has(key)) taken.delete(key);
  for (const [key, a] of now) {
    const held = taken.get(key);
    if (held && carried && !carried.has(key)) continue;
    const holds = held && holding(held);
    if (!held || !("value" in holds!) || JSON.stringify(holds.value) !== a.props || held.doc !== a.doc || held.under !== a.under) taken.set(key, { ...a, ops: [] });
  }
}

/** A patch a member is told, as its applets on that document take it: passed over at or below the version their props hold, taken above it, and the version with it. */
export function taking(taken: Map<string, Taken>, message: { doc: string; version: number; ops: PatchOp[] }): void {
  for (const t of taken.values()) {
    if (t.doc !== message.doc || (t.v !== undefined && message.version <= t.v)) continue;
    t.ops.push(...message.ops);
    if (t.v !== undefined) t.v = message.version;
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
    return { value: applyPatch(JSON.parse(t.props), t.ops.map((op) => ({ ...op, path: t.under + op.path }))) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** The part a render op is about: the one its HTML carries (a part replaced, put in, or given a new tag), or the last its target names (one taken out). */
function partOf(op: HtmlOp): string {
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

/** A member's open page after one more message: only renders change it. */
export function hear(page: string, message: Heard): string {
  if (message.type !== "render") return page;
  if (message.html !== undefined) return message.html;
  return (message.ops ?? []).reduce(applyOp, page);
}



/**
 * Why a story is not one kind of story with only that kind's keys (`STORY_KEYS`), if it is not. A
 * story file runs without being type-checked, and a key the harness does not read would otherwise
 * be dropped without a word: `{ does, closesTab }` would close a tab and never write.
 */
export function misshapen(story: Story): string[] {
  const given = Object.entries(story).filter(([, value]) => value !== undefined).map(([key]) => key);
  const kinds = (Object.keys(STORY_KEYS) as (keyof typeof STORY_KEYS)[]).filter((kind) => given.includes(kind));
  if (kinds.length !== 1) return [`a story is one of does, cannot or closesTab, and this one has ${kinds.length ? kinds.join(" and ") : "none"}`];
  const kind = kinds[0]!;
  const takes: readonly string[] = ["name", "as", "premise", ...STORY_KEYS[kind]];
  const why = given.filter((key) => !takes.includes(key)).map((key) => `a ${kind} story takes no ${key}`);
  if (kind === "closesTab" && story.closesTab !== true) why.push(`closesTab is true, or left out: this one is ${JSON.stringify(story.closesTab)}`);
  if (story.gesture !== undefined && !isGesture(story.gesture)) why.push(`a gesture is { press: selector } or { drag: [from, to] }: this one is ${JSON.stringify(story.gesture)}`);
  else if (story.gesture !== undefined && story.offPage) why.push("a story from no page (offPage) has no gesture");
  why.push(...unbudgeted(story.budget, "a"));
  return why;
}

/** Why a budget is not a number of bytes, if it is not: a whole one, more than none. `whose` begins what is said. */
const unbudgeted = (budget: unknown, whose: string): string[] =>
  budget === undefined || (Number.isInteger(budget) && (budget as number) > 0) ? [] : [`${whose} budget is a whole number of bytes: this one is ${JSON.stringify(budget)}`];

const count = (bytes: number): string => bytes.toLocaleString("en");
/** Each step of a story, as a budget's failure names it. */
const STEP: Record<Trace["phase"], string> = { does: "write", cannot: "refusal", closesTab: "tab closing", undo: "undo", redo: "redo" };

export async function run(example: Example, stories: Stories, observe?: (trace: Trace) => void, options: { byHand?: boolean } = {}): Promise<Report> {
  const server = createServer(example, 0);
  const tapped = await tap(server.port!); // the cast's sockets go through it, so what each page is handed is counted as it crossed the wire
  const { draw, page, documents } = assemble(example);
  const active = (sessionId: string): Promise<boolean> => settled(documents, () => example.active(sessionId));
  const ledger = ledgerOf();
  const ledgerMax = ledger.max;
  const outcomes: Outcome[] = [];
  let byHandTally: ByHand | undefined;
  const tryable = new Set<Story>(); // the refusals a control of the page's own sends, when told: tried by hand
  // what the kernel reports failing goes to the story being told
  let failing: string[] | undefined;
  const hearFailures = onFailure((what, err) => failing?.push(`the server failed ${what}: ${err instanceof Error ? err.message : String(err)}`));
  // what a render costs in props goes to the story being told, once for each applet and kind
  let telling: string | undefined;
  const warned = new Map<string, Warning>();
  const warn = (found: PropsCost): void => {
    const key = `${found.kind} ${found.applet}`;
    if (telling !== undefined && !warned.has(key)) warned.set(key, { story: telling, says: found.says });
  };

  // Where a person can go, judged from where each story starts: the cast, as its own writes left
  // it, and the story's premise. The places a story names are walked in a cast of its own in that
  // state, from where it put each member: every page a member is drawn there is kept by where it
  // stands (`data-page`), with its controls, and a place is somewhere they can get to when a
  // control on a page they can get to leads there (`goesTo`). The pages of the stories as they
  // are told are not kept: a plus another story's write drew is not one this story starts with.
  type State = { pages: Map<string, Map<string, Map<string, Control>>>; starts: Map<string, string | undefined> }; // member → place → controls, by what each writes
  let walked: State | undefined; // the state being walked, whose pages are kept
  function keep(m: Member): void {
    const at = placeOf(m.page);
    if (!walked || at === undefined) return;
    const byPlace = walked.pages.get(m.name) ?? walked.pages.set(m.name, new Map()).get(m.name)!;
    const here = byPlace.get(at) ?? byPlace.set(at, new Map()).get(at)!;
    for (const c of controlsOn(m.page)) here.set(JSON.stringify(c), c);
  }

  /**
   * Canon 2's fresh render: the page drawn from storage. Each document it reads is opened again
   * from delta's tables (`open_at`). One the tables do not hold is nothing, as the kernel holds a
   * document delta cannot open, so a row they lost fails; only one with no tables at all -- delta's
   * memory kinds, whose memory is where they are kept -- is the server's copy. The page reads the
   * active copy, so this one is made active while it draws, and only then: a drawing is synchronous.
   */
  async function fresh(sessionId: string): Promise<string> {
    const stored = new Map<string, unknown>();
    const copy: Documents = {
      ...documents,
      read: <T>(doc: string): T => {
        if (!stored.has(doc)) throw new Pending(doc);
        return stored.get(doc) as T;
      },
      // the version a watching mount holds is not compared (`comparable`): the page read from storage says none
      version: (doc: string): undefined => void copy.read(doc),
      load: async (doc: string) => {
        const { result, error } = await example.delta.call("open_at", { doc, at: AFTER_EVERY_WRITE });
        if (error?.message.startsWith("No handler matched")) stored.set(doc, await settled(documents, () => documents.read(doc)));
        else if (error && error.code !== 404) throw new Error(`${doc} could not be read from storage: ${error.message}`);
        else stored.set(doc, result);
      },
    };
    return drawFrom(copy, sessionId);
  }

  /** A page drawn from `copy`, made the active documents while it draws, and only then: a drawing is synchronous. */
  function drawFrom(copy: Documents, sessionId: string): Promise<string> {
    return settled(copy, () => {
      const serving = activeDocuments();
      setActiveDocuments(copy);
      try {
        return page(sessionId);
      } finally {
        setActiveDocuments(serving);
      }
    });
  }

  /** A member's page as though they had been told nothing (src/refusal.ts), as a snapshot has it (`unversioned`): what they were told, left out, is checked on its own. */
  const unsaid = async (sessionId: string): Promise<string> => unversioned(await drawFrom(toldNothing(documents, sessionId), sessionId));

  /** Every member's page, drawn as a page is and without its watching mounts' versions (`unversioned`): `quiet`'s as though they had been told nothing, since what they are told is checked on its own (`checkTold`). */
  async function snapshot(cast: Member[], quiet?: Member): Promise<Snapshot> {
    return new Map(await Promise.all(cast.map(async (m) => [m.name, m === quiet ? await unsaid(m.sessionId) : unversioned(await draw(m.sessionId))] as const)));
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
    const sessionId = (await signIn(name)) ?? crypto.randomUUID();
    // @ts-expect-error Bun's runtime-only `headers` option on WebSocket
    const ws: WebSocket = new WebSocket(tapped.url, { headers: { Cookie: `session_id=${sessionId}` } });
    const member: Member = { name, sessionId, ws, inbox: [], page: "", taken: new Map(), answered: [] };
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as Heard;
      if (message.type === "inspect") return member.answered.shift()?.();
      member.inbox.push(String(event.data));
      propsCost(name, member.page, message).forEach(warn);
      member.page = hear(member.page, message);
      if (message.type === "render") {
        retake(member.taken, member.page, message);
        keep(member);
      }
      if (message.type === "patch") taking(member.taken, message as unknown as { doc: string; version: number; ops: PatchOp[] });
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

  let writes = 0;

  /** Sends a write as `who`, with an id of its own as a page sends it, and waits for the wire to go quiet: the id, to find its answer by. */
  async function send(cast: Member[], who: Member, write: Write): Promise<number> {
    const id = ++writes;
    who.ws.send(JSON.stringify({ id, ...write }));
    await settle(cast);
    return id;
  }

  /**
   * Puts a member where a story says (`Stories.goTo`). Where a page says where it stands
   * (`data-page`), it must now stand there: a place the example does not have leaves them where
   * they were, and a story that claims they saw something there has not shown it.
   */
  async function put(cast: Member[], m: Member, where: string, failures: string[]): Promise<void> {
    if (!stories.goTo) return;
    await send(cast, m, stories.goTo(where));
    const stands = placeOf(m.page);
    const asked = where.split(" @ ")[0]!;
    if (stands !== undefined && stands !== asked) failures.push(`${m.name} could not be put on ${JSON.stringify(where)}: their page is at ${JSON.stringify(stands)}`);
  }

  /** Where each member's inbox stands now, to ask later what they were sent since. */
  const mark = (cast: Member[]): Map<Member, number> => new Map(cast.map((m) => [m, m.inbox.length]));

  /** What `m` has been sent since `from`, parsed. */
  const sentSince = (m: Member, from: Map<Member, number>): Heard[] => m.inbox.slice(from.get(m)).map((raw) => JSON.parse(raw) as Heard);

  /** What answered write `id`, sent by `m` since `from`: its own echo (a patch), its refusal, or nothing. */
  const answerTo = (m: Member, id: WriteId, from: Map<Member, number>): Heard | undefined => sentSince(m, from).find((h) => h.id === id && (h.type === "patch" || h.type === "refused"));

  /** Did something land since `from`: a document changed, and someone was told (what a session is told of a write changes none)? */
  const landedSince = (cast: Member[], from: Map<Member, number>): boolean => cast.some((m) => sentSince(m, from).some((h) => h.type === "patch" && h.doc !== "told"));

  /**
   * The story's own premise, made after the cast's writes: each write as its member. Why it does
   * not hold, if it does not: then the story is not told. A write that changes nothing fails it,
   * whether refused or already so -- the wire answers both `refused` -- since a premise says what
   * a story starts from, and a write that moved nothing says it wrongly.
   */
  async function premise(cast: Member[], story: Story): Promise<string[]> {
    const why: string[] = [];
    for (const [name, writes] of Object.entries(story.premise ?? {})) {
      const m = cast.find((c) => c.name === name);
      if (!m) why.push(`the premise names ${name}, and no one in the cast is called that`);
      else for (const write of writes) {
        const from = mark(cast);
        const answer = answerTo(m, await send(cast, m, write), from);
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
  function spent(story: Story, outcome: Outcome, phase: Trace["phase"], cast: Member[], from: Map<Member, number>): void {
    const handed = cast.flatMap((m): Handed[] => {
      const raws = m.inbox.slice(from.get(m));
      if (raws.length === 0) return [];
      const heard = tapped.heard(m.sessionId, raws);
      return [{ member: m.name, bytes: heard.reduce((n, h) => n + h.bytes, 0), sent: heard.reduce((n, h) => n + h.sent, 0), most: largest(raws) }];
    });
    if (phase === "undo" || phase === "redo") outcome.wire![phase] = handed;
    else {
      const write = phase === "does" ? story.does : phase === "cannot" ? story.cannot : undefined;
      outcome.wire = { ...(write && { write: Buffer.byteLength(JSON.stringify(write)) }), handed };
    }
    const [budget, whose] = story.budget !== undefined ? [story.budget, "story's"] : [stories.budget, "example's"];
    if (budget === undefined) return;
    for (const h of handed) {
      if (h.bytes > budget) outcome.failures.push(`${h.member}'s page was handed ${count(h.bytes)} bytes on the ${STEP[phase]}, more than the ${whose} budget of ${count(budget)}: the most, ${h.most.part}, ${size(h.most.bytes)}`);
    }
  }

  /** An `untold` member is told of nothing: sent no document's ops. */
  function checkUntold(cast: Member[], untold: string[] | undefined, from: Map<Member, number>, when: string, failures: string[]): void {
    for (const m of cast) {
      if (!untold?.includes(m.name)) continue;
      const docs = new Set(sentSince(m, from).filter((h) => h.type === "patch").map((h) => h.doc));
      for (const doc of docs) failures.push(`${when}, ${m.name} was told of ${doc}, and should not have been`);
    }
  }

  /**
   * What `who` was told by what they just did (src/refusal.ts): shown on their page, in its own
   * words, and what the story says, where it says. It is theirs, and of that moment -- the page
   * before it never said it, nor will the page after their next write -- so their pages are
   * compared without it; and a walk that is told just what the step before it was (`before`, and
   * what that was) was told nothing of its own. The line, for the next step to be told apart from.
   */
  async function checkTold(who: Member, when: string, expected: string | undefined, failures: string[], before?: { line: Line | undefined; what: string }): Promise<Line | undefined> {
    const line = await settled(documents, () => toldTo(who.sessionId));
    const words = line?.said ?? line?.reason;
    if (line && before && JSON.stringify(line) === JSON.stringify(before.line)) failures.push(`${when}, ${who.name} is still told "${words}", what ${before.what} told them`);
    else if (expected !== undefined && line?.said !== expected) failures.push(`${when}, ${who.name} was not told "${expected}"${words === undefined ? "" : `: they were told "${words}"`}`);
    else if (words !== undefined && !shows(unversioned(await draw(who.sessionId)), await unsaid(who.sessionId), words)) failures.push(`${when}, ${who.name} was told "${words}", and their page does not show it`);
    return line;
  }

  /** Does `page` show what its member was told, in its own words, where the same page told nothing (`without`) does not? */
  const shows = (page: string, without: string, words: string): boolean => page !== without && page.includes(esc(words));

  function differs(a: Snapshot, b: Snapshot, name: string): boolean {
    return a.get(name) !== b.get(name);
  }

  function compare(a: Snapshot, b: Snapshot, cast: Member[], what: string, failures: string[]): void {
    for (const m of cast) if (differs(a, b, m.name)) failures.push(`${what}: ${m.name}'s page differs${excerpt(a.get(m.name)!, b.get(m.name)!)}`);
  }

  /** `seen` must notice, and everyone else must not (R3): nobody's page changes unless the story says so. */
  function noticed(before: Snapshot, after: Snapshot, looking: Member[], seen: Map<string, string | undefined>, failures: string[]): void {
    for (const m of looking) {
      if (seen.has(m.name)) {
        if (!differs(before, after, m.name)) failures.push(`${m.name} did not see it${where(seen.get(m.name))}`);
      } else if (differs(before, after, m.name)) failures.push(`${m.name} noticed, and should not have${excerpt(before.get(m.name)!, after.get(m.name)!)}`);
    }
  }

  /** Closes a member's tab, as a browser does: resolved once it is closed. The server has then been told, and what it sets going is `server.idle()`'s to wait for. */
  function closeTab(m: Member): Promise<unknown> {
    if (m.ws.readyState === WebSocket.CLOSED) return Promise.resolve();
    const closed = new Promise((resolve) => m.ws.addEventListener("close", resolve, { once: true }));
    m.ws.close();
    return closed;
  }

  /** The patch stream: what each member's applets hold must be what a fresh render gives them. */
  async function held(cast: Member[], when: string, failures: string[]): Promise<void> {
    for (const m of cast) failures.push(...unheld(`${when}, ${m.name}'s`, m.taken, await fresh(m.sessionId)));
  }

  /** Canon 2: what each member's open page holds must be what a fresh render shows. */
  async function stale(cast: Member[], when: string, failures: string[]): Promise<void> {
    await held(cast, when, failures);
    for (const m of cast) {
      const drawn = comparable(await fresh(m.sessionId));
      const held = comparable(m.page);
      if (held !== drawn) failures.push(`${when}, ${m.name}'s open page is not what a fresh render shows${excerpt(drawn, held)}`);
    }
  }

  async function tell(story: Story): Promise<Outcome> {
    const unshaped = [...misshapen(story), ...(story.budget === undefined ? unbudgeted(stories.budget, "the example's") : [])];
    if (unshaped.length > 0) return { name: story.name, failures: unshaped }; // not a story the harness can tell: nothing is run
    const failures: string[] = [];
    const outcome: Outcome = { name: story.name, failures };
    failing = failures;
    telling = story.name;
    /** What a step of the story carried, for `observe`: what each of `cast` was sent since `from`, and the ledger's entries since `entry`. */
    function witness(phase: Trace["phase"], who: Member, write: Write | undefined, cast: Member[], from: Map<Member, number>, entry: number): void {
      observe?.({
        story: story.name,
        phase,
        as: who.name,
        write,
        heard: cast.map((m) => ({ member: m.name, messages: sentSince(m, from) })),
        ledger: ledger.since(entry).map(({ doc, undoable, ops, inverse }) => ({ doc, undoable, ops: JSON.parse(ops) as PatchOp[], inverse: JSON.parse(inverse) as PatchOp[] })),
      });
    }
    /** `send`, witnessed. */
    async function told(cast: Member[], who: Member, write: Write, phase: Trace["phase"]): Promise<number> {
      if (!observe) return send(cast, who, write);
      const from = mark(cast);
      const entry = ledgerMax();
      const id = await send(cast, who, write);
      witness(phase, who, write, cast, from, entry);
      return id;
    }
    db.exec("BEGIN");
    const cast: Member[] = [];
    try {
      await gather(cast);

      const who = cast.find((m) => m.name === story.as);
      if (!who) return { name: story.name, failures: [`no one in the cast is called ${story.as}`] };
      const why = await premise(cast, story);
      if (why.length > 0) return { name: story.name, failures: [...failures, ...why] }; // not the state the story starts from: nothing it finds would be true of it

      if (story.cannot !== undefined) {
        if (story.from !== undefined) await put(cast, who, story.from, failures);
        const before = await snapshot(cast, who);
        const ledgerBefore = ledgerMax();
        const from = mark(cast);
        // P3: a button on the author's page that sends exactly this, refused without a word, is a control that always fails
        const buttons = controlsOn(who.page, failures).filter((c) => !c.free);
        // a control of the page's own that sends it is one to try by hand; with none, that none does is the point
        const own = controlsOn(who.page).filter((c) => !c.pattern);
        if (story.cannot.ops.every((op) => own.some((c) => offers(c, story.cannot.doc, op)))) tryable.add(story);
        if (story.told === undefined && story.cannot.ops.every((op) => buttons.some((c) => offers(c, story.cannot.doc, op)))) failures.push(`${who.name}'s page offers this, and it is refused without a word: a control that always fails`);
        const answer = answerTo(who, await told(cast, who, story.cannot, "cannot"), from);
        spent(story, outcome, "cannot", cast, from);
        const handedBack = sentSince(who, from).some((h) => h.type === "render");
        if (answer?.type === "patch") failures.push(`refused, but it landed: ${who.name}'s write was echoed back to them`);
        else if (!answer || !handedBack) failures.push(`refused, but ${who.name} was not answered: ${answer ? "the page was not handed back" : "no refusal carried their write's id"}`);
        const after = await snapshot(cast);
        if (story.told !== undefined) {
          // told why: by the refusal of their own write, and on their page, the one change it may show
          const without = await unsaid(who.sessionId);
          const reason = answer?.type === "refused" ? answer.reason : undefined;
          if (reason !== story.told) failures.push(`refused, but ${who.name} was not told "${story.told}"${reason === undefined ? "" : `: they were told "${reason}"`}`);
          else if (!shows(after.get(who.name)!, without, story.told)) failures.push(`refused and told "${story.told}", but ${who.name}'s page does not show it`);
          after.set(who.name, without);
        }
        compare(before, after, cast, "refused, but", failures);
        await stale(cast, "after the refusal", failures);
        if (ledgerMax() !== ledgerBefore) failures.push("refused, but the ledger moved");
        return outcome;
      }

      // Who should notice, and where: a list leaves them where the cast put them; a record puts
      // each where it says, in the example's own grammar for "where" (`Stories.goTo`).
      const seen = new Map<string, string | undefined>(Array.isArray(story.seen) ? story.seen.map((n) => [n, undefined]) : Object.entries(story.seen));
      for (const [name, where] of seen) {
        const m = cast.find((c) => c.name === name);
        if (!m) failures.push(`no one in the cast is called ${name}`);
        else if (where !== undefined) await put(cast, m, where, failures);
      }

      if (story.closesTab) {
        // No write: the author's socket goes, and whoever is still looking is told what follows
        // (who is in a room). No control is looked for, and there is nothing to undo.
        const looking = cast.filter((m) => m !== who);
        if (seen.has(who.name)) failures.push(`${who.name} closed their tab: they are not there to see it`);
        const before = await snapshot(looking);
        const from = mark(looking);
        const entry = ledgerMax();
        await closeTab(who);
        await server.idle(); // the close handled, and what it set going
        await settle(looking);
        spent(story, outcome, "closesTab", looking, from);
        witness("closesTab", who, undefined, looking, from, entry);
        if (!landedSince(looking, from)) failures.push(`nothing landed: closing ${who.name}'s tab changed nothing`);
        checkUntold(looking, story.untold, from, "after the tab closed", failures);
        const after = await snapshot(looking);
        await stale(looking, "after the tab closed", failures);
        noticed(before, after, looking, seen, failures);
        return outcome;
      }

      if (story.from !== undefined) await put(cast, who, story.from, failures);
      // P1: the author's page offers a control for it -- unless it comes from no page (`offPage`)
      const offered = controlsOn(who.page, failures);
      if (!story.offPage) for (const op of story.does.ops) if (!offered.some((c) => offers(c, story.does.doc, op))) failures.push(`${who.name} has no control on their page for ${op.op} ${op.path} on ${story.does.doc}`);

      const before = await snapshot(cast, who);
      const ledgerBefore = ledgerMax();
      const stood = placeOf(who.page);
      let from = mark(cast);
      const answer = answerTo(who, await told(cast, who, story.does, "does"), from);
      spent(story, outcome, "does", cast, from);
      // Where the write left its author: answering a modal puts it away (off the ledger, a visit),
      // so the undo and the redo are looked at from where each was taken -- where the author stands
      // is theirs, not the write's.
      const landed = placeOf(who.page);
      const moved = stories.goTo && stood !== undefined && landed !== undefined && stood !== landed;
      if (answer?.type !== "patch") failures.push(answer ? `nothing landed: ${who.name}'s write was refused${answer.reason ? `: "${answer.reason}"` : ""}` : `${who.name}'s write was not answered: no echo carried its id`);
      if (process.env.STORY_TRACE) for (const raw of who.inbox.slice(from.get(who))) console.log(`        ${who.name} heard: ${raw.slice(0, 160)}`);
      checkUntold(cast, story.untold, from, "after the story", failures);
      const after = await snapshot(cast);
      const wrote = await checkTold(who, "after the story", undefined, failures);
      const quietAfter = new Map(after).set(who.name, await unsaid(who.sessionId)); // what the undo and the redo are compared with
      const entries = ledger.since(ledgerBefore);
      await stale(cast, "after the story", failures);

      noticed(before, quietAfter, cast, seen, failures); // what the author was told is checked on its own (above); an `untold` member is further told of nothing

      // off the ledger, or the author has gone (logged out): no undo is theirs to press
      if (entries.length === 0 || !(await active(who.sessionId))) {
        if (story.undone !== undefined) failures.push(`no undo follows to tell ${who.name} "${story.undone}"`);
        if (story.redone !== undefined) failures.push(`no redo follows to tell ${who.name} "${story.redone}"`);
        return outcome;
      }

      const facts = entries.every((e) => e.undoable === 0);
      from = mark(cast);
      await told(cast, who, UNDO, "undo");
      spent(story, outcome, "undo", cast, from);
      const undid = await checkTold(who, "after undo", story.undone, failures, { line: wrote, what: "the write" }); // where the undo left them, before they are put back
      if (moved) await send(cast, who, stories.goTo!(stood!));
      const afterUndo = await snapshot(cast, who);
      await stale(cast, "after undo", failures);
      checkUntold(cast, story.untold, from, "after undo", failures);
      if (facts) compare(quietAfter, afterUndo, cast, "a fact, yet undo changed it", failures);
      else compare(before, afterUndo, cast, "undo did not restore", failures);
      // a fact has nothing to redo; and the undo may have been their going (a name taken back): no redo is theirs to press
      if (facts || !(await active(who.sessionId))) {
        if (story.redone !== undefined) failures.push(`no redo follows to tell ${who.name} "${story.redone}"`);
      } else {
        from = mark(cast);
        await told(cast, who, REDO, "redo");
        spent(story, outcome, "redo", cast, from);
        await checkTold(who, "after redo", story.redone, failures, { line: undid, what: "the undo" });
        if (moved) await send(cast, who, stories.goTo!(landed!));
        compare(quietAfter, await snapshot(cast, who), cast, "redo did not restore", failures);
        await stale(cast, "after redo", failures);
        checkUntold(cast, story.untold, from, "after redo", failures);
      }
      return outcome;
    } finally {
      await disband(cast);
      failing = undefined;
      telling = undefined;
    }
  }

  /** The cast, connected, each member where their own writes put them: where every story starts, inside a transaction. */
  async function gather(cast: Member[]): Promise<void> {
    for (const name of Object.keys(stories.cast)) cast.push(await connect(name));
    await settle(cast);
    for (const m of cast) for (const write of stories.cast[m.name]!) await send(cast, m, write);
  }

  /** Every tab closed, and the transaction rolled back: the next story reads from the database as the seed left it. */
  async function disband(cast: Member[]): Promise<void> {
    await Promise.all(cast.map(closeTab));
    await server.idle(); // every close handled, and what it set going
    db.exec("ROLLBACK");
    await documents.release(new Set());
  }

  /**
   * The ways from `start` to each of `places` for `name`, in `state`, over the controls their pages
   * there offered: a place's own is its address, before any " @ ". A place on the way that
   * `name` has not stood on is stood on now (`visit`), so the way through any page is found; and so
   * is each of `places` reached, so what its own page sends is known (what follows " @ "). Without
   * `visit`, only the pages already walked, leaving out each step in `blocked` (a way by hand).
   */
  async function waysFor(state: State, name: string, start: string | undefined, places: Set<string>, visit?: (place: string) => Promise<void>, blocked = new Set<string>()): Promise<Map<string, Step[]>> {
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
        const to = goesTo(control, stories.goTo!);
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
  async function walk(story: Story, wanted: Map<string, Set<string>>, aside: boolean): Promise<{ state: State; ways: Map<string, Map<string, Step[]>> } | undefined> {
    const state: State = { pages: new Map(), starts: new Map() };
    const walking: Member[] = [];
    db.exec("BEGIN");
    try {
      await gather(walking);
      if ((await premise(walking, story)).length > 0) return undefined;
      walked = state;
      for (const m of walking) {
        state.starts.set(m.name, placeOf(m.page));
        keep(m);
      }
      const ways = new Map<string, Map<string, Step[]>>();
      for (const [name, places] of wanted) {
        const m = walking.find((w) => w.name === name)!;
        const visit = async (place: string) => void (await send(walking, m, stories.goTo!(place)));
        const found = await waysFor(state, name, state.starts.get(name), places, visit);
        ways.set(name, found);
        const pages = state.pages.get(name)!;
        if (aside) for (const { from } of [...found.values()].flat()) for (const c of [...pages.get(from)!.values()]) {
          const to = goesTo(c, stories.goTo!);
          if (to !== undefined && !pages.has(to)) await visit(to);
        }
      }
      return { state, ways };
    } finally {
      walked = undefined;
      await disband(walking);
    }
  }

  /**
   * Can each story's author get to its `from`, and each member it puts somewhere in `seen` get
   * there, by the controls their pages offer? A place a story names that no control leads to fails
   * that story, by name: the harness put them there, and a person could not. After " @ ", what
   * else the place holds (find's word, a reading) must be sent by a control on the page there.
   * Places on the way that no story stood on are walked in a cast of their own, rolled back after.
   */
  async function reach(told: { story: Story; outcome: Outcome }[], byHandToo: (story: Story) => boolean): Promise<Map<Story, State>> {
    const startsFrom = new Map<Story, State>();
    const named = told.filter(({ story }) => misshapen(story).length === 0 && stories.cast[story.as] !== undefined);
    const placesOf = (story: Story): [name: string, where: string, why: string][] => [
      ...(story.from !== undefined ? [[story.as, story.from, "the story has them act"] as [string, string, string]] : []),
      ...("seen" in story && story.seen && !Array.isArray(story.seen) ? Object.entries(story.seen).filter(([name]) => stories.cast[name]).map(([name, where]) => [name, where, "the story has them see it"] as [string, string, string]) : []),
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
      for (const { story } of group) for (const [name, where] of placesOf(story)) (wanted.get(name) ?? wanted.set(name, new Set()).get(name)!).add(where.split(" @ ")[0]!);
      const found = await walk(group[0]!.story, wanted, group.some(({ story }) => byHandToo(story)));
      if (!found) continue; // its premise does not hold: the story says so
      const { state, ways } = found;
      const lead = (name: string, where: string, why: string): string | undefined => {
        if (state.starts.get(name) === undefined) return undefined; // a page that says nowhere it stands (a welcome): nowhere to go
        const [place = "", rest] = where.split(" @ ");
        if (!ways.get(name)?.has(place)) return `no control leads ${name} to ${JSON.stringify(place)}, where ${why}`;
        if (rest === undefined) return undefined;
        const going = stories.goTo!(place).ops.map((op) => JSON.stringify(op));
        const all = stories.goTo!(where);
        const there = [...(state.pages.get(name)?.get(place)?.values() ?? [])];
        const unsent = all.ops.filter((op) => !going.includes(JSON.stringify(op)) && !there.some((c) => offers(c, all.doc, op)));
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
   * The story by hand, in a browser that is the author's tab (src/by-hand.ts): from where the
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
  async function byHand(story: Story, hand: Hand, tally: ByHand, state: State | undefined): Promise<string[]> {
    if (story.closesTab || !stories.cast[story.as]) return [];
    const tried = story.does !== undefined ? (story.offPage ? undefined : story.does) : tryable.has(story) ? story.cannot : undefined;
    const seenAt = story.does !== undefined && story.seen && !Array.isArray(story.seen) ? story.seen[story.as] : undefined;
    const target = story.from ?? seenAt;
    if (!tried && target === undefined) return [];
    tally.stories++;
    const failures: string[] = [];
    const by = (what: string): string[] => (failures.push(`by hand, ${what}`), failures);
    db.exec("BEGIN");
    const cast: Member[] = [];
    let opened = false;
    try {
      await gather(cast);
      const who = cast.find((m) => m.name === story.as)!;
      if ((await premise(cast, story)).length > 0) return []; // the story says so when it is told
      const start = placeOf(who.page);
      opened = true;
      const wrong = await hand.enter(who.sessionId, start);
      if (wrong) return by(wrong);

      let none = false; // the last press found nothing on the page that could send its write at all
      /** Sends `write` from the page -- by `gesture`, where the story says one -- or as an applet declares it when only an applet's own control sends it; why a person could not, if they could not. */
      const press = async (write: Write, gesture?: Gesture): Promise<string | undefined> => {
        const own = controlsOn(who.page).filter((c) => write.ops.some((op) => offers(c, write.doc, op)));
        if (!gesture && own.length > 0 && own.every((c) => c.pattern)) {
          tally.applets++;
          await send(cast, who, write);
          return undefined;
        }
        tally.presses++;
        const pressed = gesture ? await hand.gesture(gesture) : await hand.press(write.doc, write.ops);
        await settle(cast);
        if ("failure" in pressed) return (none = !!pressed.none), pressed.failure;
        if (pressed.sent.length !== 1 || !sameWrite(pressed.sent[0]!, write)) return `the page sent ${pressed.sent.map(worded).join("; ")}`;
        return undefined;
      };

      if (target !== undefined && stories.goTo && start !== undefined && state) {
        const [place = "", rest] = target.split(" @ ");
        const blocked = new Set<string>();
        let first: string | undefined;
        for (let at = start; at !== place; ) {
          const way = blocked.size < MOST_TRIES ? (await waysFor(state, who.name, at, new Set([place]), undefined, blocked)).get(place) : undefined;
          if (!way) return first === undefined ? failures : by(`${who.name} could not get to ${JSON.stringify(place)}: ${first}`); // none at all: said when the story was told
          for (const step of way) {
            const why = await press(stories.goTo(step.to));
            const stands = why === undefined ? await hand.standsAt(step.to) : await hand.here();
            at = stands ?? step.from;
            if (why === undefined && stands === step.to) continue;
            blocked.add(stepKey(step));
            first ??= `the way to ${JSON.stringify(step.to)} from ${JSON.stringify(step.from)}: ${why ?? `pressed, it left their page at ${JSON.stringify(stands)}`}`;
            break;
          }
        }
        if (rest !== undefined) {
          const going = stories.goTo(place).ops.map((op) => JSON.stringify(op));
          const all = stories.goTo(target);
          for (const op of all.ops.filter((o) => !going.includes(JSON.stringify(o)))) {
            const why = await press({ doc: all.doc, ops: [op] });
            if (why !== undefined) return by(`${who.name} could not ${op.op} ${op.path} at ${JSON.stringify(place)}: ${why}`);
          }
        }
      }
      if (tried) {
        const from = mark(cast);
        const why = await press(tried, story.gesture);
        if (why !== undefined && story.cannot && none) return failures; // nobody could send it from the page: the refusal is for the wire's, as the story says
        if (why !== undefined) return by(`${who.name} could not ${tried.ops.map((op) => `${op.op} ${op.path}`).join(", ")} on ${tried.doc}: ${why}`);
        const landed = landedSince(cast, from);
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
      await disband(cast);
    }
  }

  try {
    const only = process.env.STORY; // run only the stories whose name contains this
    const told: { story: Story; outcome: Outcome }[] = [];
    for (const story of stories.stories) if (!only || story.name.includes(only)) told.push({ story, outcome: await tell(story) });
    // by hand: with `byHand` each story that has something to do there, and without it each that says its gesture
    const byHandToo = (story: Story): boolean => (options.byHand || story.gesture !== undefined) && misshapen(story).length === 0;
    const startsFrom = stories.goTo ? await reach(told, byHandToo) : new Map<Story, State>();
    outcomes.push(...told.map(({ outcome }) => outcome));
    const handed = told.filter(({ story }) => byHandToo(story));
    if (handed.length > 0) {
      const started = performance.now();
      const tally: ByHand = { stories: 0, presses: 0, applets: 0, ms: 0 };
      const hand = new Hand(server.url);
      try {
        for (const { story, outcome } of handed) outcome.failures.push(...(await byHand(story, hand, tally, startsFrom.get(story))));
      } finally {
        hand.close();
      }
      tally.ms = Math.round(performance.now() - started);
      byHandTally = tally;
    }
  } finally {
    hearFailures();
    server.stop(true);
    tapped.close();
  }
  const failed = outcomes.filter((o) => o.failures.length > 0).length;
  return { outcomes, passed: outcomes.length - failed, failed, ...(warned.size > 0 && { warnings: [...warned.values()] }), ...(byHandTally && { byHand: byHandTally }) };
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
  console.log(`\n${report.passed} passed, ${report.failed} failed${warnings.length ? `, ${warnings.length} ${warnings.length === 1 ? "warning" : "warnings"}` : ""}`);
  const h = report.byHand;
  if (h) console.log(`${h.stories} done by hand in a browser the size of a phone: ${h.presses} presses, ${h.applets} sent as an applet declares, in ${(h.ms / 1000).toFixed(1)}s`);
}

/**
 * A story's cost, in words: its write's size, said once, then each member it handed anything, the
 * bytes, as they crossed the wire, and the biggest part; and after it, the bytes its undo and redo
 * handed them, where it has them.
 */
function cost({ write, handed, undo, redo }: Wire): string[] {
  const members = [...new Set([...handed, ...(undo ?? []), ...(redo ?? [])].map((h) => h.member))];
  const step = write === undefined ? "a tab closing handed" : `a ${count(write)}-byte write handed`;
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
