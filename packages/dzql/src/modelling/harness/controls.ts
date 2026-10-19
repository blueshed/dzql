import { isVerb, type PatchOp, type Test } from "../../rendering/json-patch";
import { decoded } from "../../rendering/parts";
import { sameDoc } from "../by-hand";
import type { Write } from "../stories";

// The controls on a page, read from the HTML the server drew, for the stories (src/modelling/harness.ts):
// what each offers a person, what each is drawn sending, and where one leads. The server has no
// DOM, so the client's rules for a control (src/rendering/client/form-value.ts) are said again here,
// each beside the name of the function it follows.

/**
 * A control a page offers (src/rendering/html.ts `write`): the document, op and path it writes, and the value
 * a button carries (`data-value`, JSON, sent with its type: `true`, not "true"; an option's or a
 * radio's is its text). A field or a form writes whatever is typed, so any value. An applet draws its own controls in
 * the browser, so it offers only what its mount says it writes (`data-writes`, src/rendering/html.ts), where
 * a `*` segment of its path is any one, with any value or only the ones it names; one that says
 * nothing offers nothing, whatever document it reads (`data-doc`), as the clock's face writes
 * nothing to the clock it shows.
 */
export type Control = { doc: string; op: string; path: string; value?: unknown; free: boolean; pattern?: true };

/** What a control writes, the value it is drawn with (a button's with its type; a field's text; "" for none), and a short name for it. */
export type Writing = { doc: string; op: string; path: string; value: unknown; control: string };

/** The same value, as the wire carries it: by its type and its JSON, so `true` is not "true". */
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** A `data-value` as the client parses it (src/rendering/client/form-value.ts `pressed`): `{ value }`, none when there is none, or why it is no JSON. */
function pressedValue(attr: string | null): { value?: unknown } | string {
  if (attr === null) return {};
  try {
    return { value: JSON.parse(decoded(attr)) };
  } catch {
    return decoded(attr);
  }
}

/** Is this what `appletWrites` puts on a mount, one write of it: a document, an op and a JSON Pointer path, and the only values it sends, if it names them? */
const isDeclared = (w: unknown): w is { doc: string; op: string; path: string; values?: (string | number | boolean)[] } => {
  const { doc, op, path, values } = (typeof w === "object" && w !== null ? w : {}) as Record<string, unknown>;
  const valued = values === undefined || (Array.isArray(values) && values.length > 0 && values.every((v) => ["string", "number", "boolean"].includes(typeof v)));
  return typeof doc === "string" && doc !== "" && isVerb(op) && typeof path === "string" && (path === "" || path.startsWith("/")) && valued;
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

/** The fields and buttons whose own `disabled` sends nothing (on anything else it says nothing). */
const DISABLES = ["button", "input", "textarea", "select"];

/** An option of a select that writes, as drawn: its value (none, and its words are), whether it chooses nothing (disabled, or in a disabled group), and whether it is drawn `selected`. */
type Option = { value: string | null; text: string; disabled: boolean; selected: boolean };

/**
 * Every control on a page, as the server drew it, in one walk: what each offers a person
 * (`controlsOn`), and what each that writes is drawn sending (`writesOn`). A select's options
 * are read once for both: it offers every one it can choose, and is drawn sending the one it shows.
 */
function onPage(page: string, misdeclared: string[] = []): { controls: Control[]; writings: Writing[] } {
  const controls: Control[] = [];
  const writings: Writing[] = [];
  const spec = (attr: string | null) => (attr === null ? undefined : (JSON.parse(decoded(attr)) as { doc: string; op: string; path: string }));
  const open: Open[] = [];
  const closeTo = (at: number) =>
    open.splice(at).reverse().forEach((e) => {
      e.closed = true;
      e.ends?.();
    });
  // a select that writes: its options, and the one open now, whose words are read as they come
  let choosing: { options: Option[]; option?: Option } | undefined;
  // a person can press it (form-value.ts `pressable`): not inert, hidden, nor in a template or a disabled fieldset (but for its first legend), itself or by what it is in
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
        if (tag === "option" && choosing) {
          const value = el.getAttribute("value");
          choosing.option = { value: value === null ? null : decoded(value), text: "", disabled: el.hasAttribute("disabled") || !!(parent?.tag === "optgroup" && parent.disabled), selected: el.hasAttribute("selected") };
          choosing.options.push(choosing.option);
        }
        if (tag === "optgroup" && el.hasAttribute("disabled")) entry.disabled = true; // its options choose nothing
        open.push(entry);
        el.onEndTag(() => {
          if (!entry.closed) closeTo(open.indexOf(entry));
        });
      },
    })
    .on("option", { text: (t) => void (choosing?.option && (choosing.option.text += t.text)) })
    .on("[data-write]", {
      element(el) {
        const tag = el.tagName;
        const drawn = !el.hasAttribute("disabled"); // drawn sending something: one drawn disabled sends nothing
        const offered = pressable(el) && (drawn || !DISABLES.includes(tag)); // the browser sends nothing from it
        if (!offered && !drawn) return;
        const s = spec(el.getAttribute("data-write"))!;
        const by = ["aria-label", "name", "data-value", "id"].find((a) => el.hasAttribute(a));
        const said = by && decoded(el.getAttribute(by)!);
        const control = by ? `${tag}[${by}=${said!.includes('"') ? `'${said}'` : `"${said}"`}]` : tag;
        if (tag === "select") {
          // several at once is no one value, which the client never sends
          if (el.hasAttribute("multiple")) return;
          const list = Number(el.getAttribute("size") ?? "1") > 1;
          const at = open.at(-1)!;
          const choice: NonNullable<typeof choosing> = { options: [] };
          choosing = choice;
          at.ends = () => {
            choosing = undefined;
            const words = (o: Option) => o.value ?? o.text.replace(/\s+/g, " ").trim();
            const choosable = choice.options.filter((o) => !o.disabled);
            // it offers what it can choose: each option not disabled, by its value or its words
            if (offered) for (const o of choosable) controls.push({ ...s, value: words(o), free: false });
            // it is drawn sending the option it shows, by the browser's rule (form-value.ts `drawnOption`):
            // the last `selected`, else its first not disabled, or in a list (`size` over 1) none
            const shown = choice.options.findLast((o) => o.selected) ?? (list ? undefined : choosable[0]);
            if (shown) writings.push({ ...s, value: words(shown), control });
          };
          return;
        }
        const value = pressedValue(el.getAttribute("data-value"));
        if (drawn) {
          // a button its `data-value` (form-value.ts `pressed`), or the words it was drawn with (`rendered`), a number field's as a number, or null (`sends`)
          const text = decoded(el.getAttribute("value") ?? "");
          const number = tag === "input" && ["number", "range"].includes(el.getAttribute("type") ?? "");
          writings.push({ ...s, value: typeof value === "string" ? value : "value" in value ? value.value : number ? (text === "" ? null : Number(text)) : text, control });
        }
        if (!offered) return;
        if (tag === "input" && el.getAttribute("type") === "radio") return void controls.push({ ...s, value: decoded(el.getAttribute("value") ?? "on"), free: false }); // a radio sends its own value
        if (typeof value === "string") return void misdeclared.push(`a data-value must be JSON: ${tag} says ${value}`); // the client cannot send it
        controls.push({ ...s, value: value.value, free: ["form", "input", "textarea"].includes(tag) });
      },
    })
    .on("form[action]:not([data-write])", {
      element(el) {
        if (pressable(el) && el.getAttribute("method")?.toLowerCase() === "post") controls.push({ doc: "", op: "post", path: decoded(el.getAttribute("action")!), free: true });
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
          else if (!w.values) controls.push({ doc: w.doc, op: w.op, path: w.path, free: true, pattern: true });
          else for (const value of w.values) controls.push({ doc: w.doc, op: w.op, path: w.path, value, free: false, pattern: true });
        }
      },
    })
    .transform(page);
  return { controls, writings };
}

/**
 * Every control on a page, as the server drew it: one the browser sends nothing from is none --
 * one a person cannot press (form-value.ts `pressable`), or a field or a button drawn `disabled`.
 * The page's address (`data-page-write`) is not on
 * the page: the URL bar and the back button send it, so it offers nothing. An applet's
 * declaration that is not `[doc, op, path]` (the form before ops, a hand-written attribute)
 * offers nothing, and is said in `misdeclared`. A plain form that posts to a route (no
 * `data-write`) is a control too: its op is `post`, its path the route's, and it names no document.
 */
export const controlsOn = (page: string, misdeclared: string[] = []): Control[] => onPage(page, misdeclared).controls;

/** Each control a page draws that writes (`data-write`: a button, a form, an editing form's field), but one drawn `disabled`, which sends nothing; and a short name for it: its tag, and its label, name, value or id. */
export const writesOn = (page: string): Writing[] => onPage(page).writings;

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
export function offers(c: Control, doc: string, op: PatchOp | Test): boolean {
  if (!sameDoc(c.doc, doc)) return false;
  if (c.pattern) return c.op === op.op && fits(c.path, op.path) && (c.value === undefined || ("value" in op && same(op.value, c.value))); // an applet's own: exactly what its mount names
  if (c.op !== op.op || c.path !== op.path) return false;
  return c.free || (c.value === undefined ? !("value" in op) || op.value === undefined : "value" in op && same(op.value, c.value));
}

/**
 * Where a control goes, if it goes anywhere: the address `goTo` makes exactly its write of -- a
 * button's own value (`data-value`), the one write a person sends by pressing it, or one an
 * applet's mount names for a tap (`appletWrites`, with values). A field, a form and an applet that
 * names no value take any value, so they lead nowhere in particular; and the URL bar and the back
 * button are not on the page (`controlsOn`).
 */
export function goesTo(c: Control, goTo: (address: string) => Write): string | undefined {
  if (c.free || typeof c.value !== "string") return undefined; // an address is text
  const w = goTo(c.value);
  return sameDoc(w.doc, c.doc) && w.ops.some((op) => op.op === c.op && op.path === c.path && "value" in op && op.value === c.value) ? c.value : undefined; // the op of it that sets the address: going somewhere may put other things away too
}
