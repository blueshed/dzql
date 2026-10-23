import { connectCli } from "dzql/rendering/cli/commands";
import { cookieNameForUrl } from "dzql/rendering/scope";
import { decoded } from "dzql/rendering/parts";
import { columnOf, readingOf } from "dzql/modelling/reading";
import { list as and, MODEL, type Raw } from "../heart";
import type { Load } from "./writes";

// The model as told against the model as built (`bun run model:check <example> --against-page`):
// what is on the model page, and what the loader reads from the app, in the page's own words
// (./writes.ts). Stories go by the number of the model story an app's story names (`model: 10`,
// src/modelling/stories.ts), else by their words; documents by their names, fields by their names alone (a ref by its column, `dish_id`)
// (the loader reads no types). Each gap is said as a question for the teller.

type Held = { under: string | null; fields: string[] };
type Doc = { root: string; own: boolean; held_by: string[]; holds: Map<string, Held>; serves: string[] };
/** A story either way: as told, with its number on the page; as built, with the number of the model story it names, if it names one. */
type Story = { text: string; actor: string; kind: string; post?: string | null; id?: string | number; model?: number | false };
/** A model either way: its stories by their words, its documents by their names. */
export type Model = { stories: Map<string, Story>; documents: Map<string, Doc> };

/** A story's words as they are matched: one case, one space between, no stop at the end. */
const wordsOf = (text: string): string => text.toLowerCase().replace(/\s+/g, " ").trim().replace(/[.!?]$/, "");

/** The model as told: the page's document. */
export function told(raw: Raw): Model {
  const m = readingOf(raw); // as the checks, the proof and the guards read it
  const byId = new Map(m.stories.map((s) => [s.id, wordsOf(s.text)]));
  const documents = m.documents.map((d): [string, Doc] => [
    d.name,
    {
      root: d.root,
      own: d.own,
      held_by: d.held_by,
      holds: new Map(Object.entries(d.holds).map(([e, h]) => [e, { under: h.parent, fields: h.fields.map(columnOf) }])), // a ref as its column keeps it (`dish` is `dish_id`)
      serves: d.serves.flatMap((id) => byId.get(id) ?? []),
    },
  ]);
  return { stories: new Map(m.stories.map((s) => [wordsOf(s.text), s])), documents: new Map(documents) };
}

/** The model as built: what a load of the app would write. */
export function built(load: Load): Model {
  const names = (fields: { name: string }[]) => fields.map((f) => f.name);
  const documents = load.documents.map((d): [string, Doc] => [
    d.name,
    {
      root: d.root,
      own: d.own,
      held_by: d.held_by,
      holds: new Map([[d.root, { under: null, fields: names(d.fields) }], ...d.holds.map((h): [string, Held] => [h.entity, { under: h.under, fields: names(h.fields) }])]),
      serves: d.serves.map((i) => wordsOf(load.stories[i]!.text)),
    },
  ]);
  return { stories: new Map(load.stories.map((s) => [wordsOf(s.text), s])), documents: new Map(documents) };
}

const list = (xs: string[]) => xs.join(", ") || "nobody";
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
const own = (yes: boolean) => (yes ? "each person's own" : "shared");

/** Each story the app tells, by its words: the told story it tells, and how it was matched -- by the number of the model story it names (`model`), else by its words -- or none, where it tells nothing told. */
function tells(t: Model, b: Model): Map<string, { told: string; how?: "number" | "words" }> {
  const byNumber = new Map([...t.stories].map(([k, s]) => [String(s.id), k]));
  return new Map(
    [...b.stories].map(([k, s]) => {
      const named = s.model === undefined ? undefined : byNumber.get(String(s.model));
      return [k, named ? { told: named, how: "number" } : { told: k, how: t.stories.has(k) ? "words" : undefined }];
    }),
  );
}

/** The told stories the app tells, by their numbers on the page: those matched by the number an app story names, and those by their words. */
export function matched(t: Model, b: Model): { number: string[]; words: string[] } {
  const ids = (how: string) => [...new Set([...tells(t, b).values()].filter((m) => m.how === how).map((m) => String(t.stories.get(m.told)!.id)))].sort((x, y) => Number(x) - Number(y));
  return { number: ids("number"), words: ids("words") };
}

/**
 * Each story told the app does not tell, each it tells that was never told, and each document that
 * differs: in its root, own-ness, holders, holdings or the stories it serves. A story matched by the
 * number it names is the app's cast telling what the model may tell of anyone ("a customer"), so
 * only whether it does or cannot is compared; one matched by its words, its teller too.
 */
export function gaps(t: Model, b: Model): string[] {
  const out: string[] = [];
  const to = tells(t, b);
  for (const [k, s] of b.stories) if (typeof s.model === "number" && to.get(k)!.how !== "number") out.push(`"${s.text}" tells model story ${s.model}, and the page has no story ${s.model}: which does it tell?`);
  for (const [k, s] of t.stories) {
    const as = [...b.stories].filter(([bk]) => to.get(bk)!.told === k);
    if (as.length === 0) out.push(`"${s.text}" was told, and the app does not tell it: still wanted?`);
    for (const [bk, a] of as) if (a.kind !== s.kind || (to.get(bk)!.how === "words" && a.actor !== s.actor)) out.push(`"${s.text}" was told as ${s.actor} ${s.kind}, and is built as ${a.actor} ${a.kind}: which is it?`);
  }
  // a story the app says is its own (`model: false`: signing out, a guard of its own) was never meant to be told
  for (const [k, s] of b.stories) if (!to.get(k)!.how && s.model !== false) out.push(`"${s.text}" the app tells, and it was never told: was it meant?`);
  const builtToo = new Set([...to.values()].flatMap((m) => (m.how ? [m.told] : []))); // told stories the app tells
  // the model's tellers are roles, the app's cast are people: who plays which, from the stories matched by number (cafe-e's feedback)
  const roleOf = new Map([...b.stories].flatMap(([bk, a]) => (to.get(bk)!.how === "number" ? [[a.actor, t.stories.get(to.get(bk)!.told)!.actor] as const] : [])));
  const asRoles = (who: string[]) => [...new Set(who.map((w) => roleOf.get(w) ?? w))];
  const met = new Set<Doc>(); // the built documents a told one was found as
  for (const [name, d] of t.documents) {
    // each person's own, as built a session of the app's own name: the one own document of the same root
    const as = b.documents.get(name) ?? (d.own ? [...b.documents.values()].find((x) => x.own && x.root === d.root) : undefined);
    if (!as) {
      out.push(`${name} was told, and the app has no such document: still wanted?`);
      continue;
    }
    met.add(as);
    if (d.root !== as.root) out.push(`${name} is rooted at ${d.root} as told, at ${as.root} as built: which is it?`);
    if (d.own !== as.own) out.push(`${name} is ${own(d.own)} as told, ${own(as.own)} as built: which is it?`);
    const holders = asRoles(as.held_by);
    // each person's own is held by everyone, each their own: not a question of who
    if (!d.own && !same(d.held_by, holders)) out.push(`${name} is held by ${list([...d.held_by].sort())} as told, by ${list([...holders].sort())} as built: who holds it?`);
    for (const [e, h] of d.holds) {
      const there = as.holds.get(e);
      if (!there) out.push(`${name} holds ${e} as told, and the app does not: still wanted?`);
      else {
        if (h.under !== there.under) out.push(`${name}'s ${e} hangs under ${h.under} as told, under ${there.under} as built: which is it?`);
        // each person's own is the app's session too: what it keeps beside the told fields (who signed in, where) is the app's
        const differ = d.own ? h.fields.some((f) => !there.fields.includes(f)) : !same(h.fields, there.fields);
        if (differ) out.push(`${name}'s ${e} has ${list(h.fields)} as told, ${list(there.fields)} as built: which fields?`);
      }
    }
    for (const e of as.holds.keys()) if (!d.holds.has(e)) out.push(`${name} holds ${e} as built, and it was never told: was it meant?`);
    // a story only one side tells is said above, once
    const serves = as.serves.map((k) => to.get(k)!.told); // as built, in the told stories' words
    // a story that posts a form is a route's, born into no document on either side
    const posted = (k: string) => !!t.stories.get(k)?.post || !!b.stories.get(k)?.post;
    for (const k of d.serves) if (builtToo.has(k) && !serves.includes(k) && ![...to].some(([bk, m]) => m.told === k && posted(bk)) && !posted(k)) out.push(`${name} serves "${t.stories.get(k)!.text}" as told, and not as built: still wanted?`);
    for (const k of as.serves) if (to.get(k)!.how && !d.serves.includes(to.get(k)!.told)) out.push(`${name} serves "${b.stories.get(k)!.text}" as built, and it was never told: was it meant?`);
  }
  for (const [name, d] of b.documents) if (!t.documents.has(name) && !met.has(d)) out.push(`${name} the app has, and it was never told: was it meant?`);
  return out;
}

/** The report: how the stories were matched, where it is said, then the gaps, or that there are none. */
export function format(name: string, said: string[], how?: { number: string[]; words: string[] }): string {
  const by = [how?.number.length && `by the model story they name: ${and(how.number)}`, how?.words.length && `by their words: ${and(how.words)}`].filter(Boolean);
  const head = `# ${name}: as told on the model page, as built\n\n${by.length ? `Stories matched ${by.join("; ")}.\n\n` : ""}`;
  if (said.length === 0) return `${head}No gaps: the app is the model as told.`;
  return `${head}${said.length} gap${said.length === 1 ? "" : "s"}\n\n${said.map((s) => `- ${s}`).join("\n")}`;
}

/**
 * The model as its page holds it, read as anyone signed in to it reads it: over the socket, the
 * document the page's applet watches. As the CLI connects (`show`, ../cli.ts), so it opens no
 * database of its own.
 */
export async function readPage(url: string, session: string): Promise<Raw> {
  const at = `${url.replace(/\/+$/, "")}/ws`;
  // the page is listened for from the socket's start: it can come before the open is awaited
  const first = Promise.withResolvers<string>();
  const ws = await connectCli(at, `${cookieNameForUrl(at)}=${session}`, undefined, (event) => {
    const message = JSON.parse(String(event.data));
    if (message.type === "render") first.resolve(message.html); // a page's first render is whole
  }).catch(() => {
    throw new Error(`No model page at ${url}: is it running?`);
  });
  const page = await first.promise;
  ws.close();
  let props: string | null = null;
  new HTMLRewriter().on(`[data-doc="model:${MODEL}"]`, { element: (el) => void (props = el.getAttribute("data-props")) }).transform(page);
  if (props === null) throw new Error("No model on the page: sign in first (login <your link>).");
  return JSON.parse(decoded(props)) as Raw;
}
