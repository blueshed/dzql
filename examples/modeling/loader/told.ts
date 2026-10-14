import { takersOn } from "../../../src/harness";
import { connect, expectMessage } from "../../../src/test-socket";
import type { Raw } from "../heart";
import { MODEL } from "../model";
import type { Load } from "./writes";

// The model as told against the model as built (`bun run model:check <example> --against-page`):
// what is on the model page, and what the loader reads from the app, in the page's own words
// (./writes.ts). Stories go by their words, documents by their names, fields by their names alone
// (the loader reads no types). Each gap is said as a question for the teller.

type Held = { under: string | null; fields: string[] };
type Doc = { root: string; own: boolean; held_by: string[]; holds: Map<string, Held>; serves: string[] };
/** A model either way: its stories by their words, its documents by their names. */
export type Model = { stories: Map<string, { text: string; actor: string; kind: string }>; documents: Map<string, Doc> };

/** A story's words as they are matched: one case, one space between, no stop at the end. */
const wordsOf = (text: string): string => text.toLowerCase().replace(/\s+/g, " ").trim().replace(/[.!?]$/, "");

/** The model as told: the page's document. */
export function told(raw: Raw): Model {
  const rows = Object.values(raw.stories ?? {});
  const byId = new Map(rows.map((s) => [String(s.id), wordsOf(s.text)]));
  const documents = Object.values(raw.documents ?? {}).map((d): [string, Doc] => [
    d.name,
    {
      root: d.root,
      own: !!d.own,
      held_by: d.held_by ?? [],
      holds: new Map(Object.entries(d.holds ?? {}).map(([e, h]) => [e, { under: h.parent, fields: h.fields.map((f) => f.name) }])),
      serves: (d.stories ?? []).flatMap((id) => byId.get(String(id)) ?? []),
    },
  ]);
  return { stories: new Map(rows.map((s) => [wordsOf(s.text), s])), documents: new Map(documents) };
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

/** Each story told the app does not tell, each it tells that was never told, and each document that differs: in its root, own-ness, holders, holdings or the stories it serves. */
export function gaps(t: Model, b: Model): string[] {
  const out: string[] = [];
  for (const [k, s] of t.stories) {
    const as = b.stories.get(k);
    if (!as) out.push(`"${s.text}" was told, and the app does not tell it: still wanted?`);
    else if (as.actor !== s.actor || as.kind !== s.kind) out.push(`"${s.text}" was told as ${s.actor} ${s.kind}, and is built as ${as.actor} ${as.kind}: which is it?`);
  }
  for (const [k, s] of b.stories) if (!t.stories.has(k)) out.push(`"${s.text}" the app tells, and it was never told: was it meant?`);
  for (const [name, d] of t.documents) {
    const as = b.documents.get(name);
    if (!as) {
      out.push(`${name} was told, and the app has no such document: still wanted?`);
      continue;
    }
    if (d.root !== as.root) out.push(`${name} is rooted at ${d.root} as told, at ${as.root} as built: which is it?`);
    if (d.own !== as.own) out.push(`${name} is ${own(d.own)} as told, ${own(as.own)} as built: which is it?`);
    if (!same(d.held_by, as.held_by)) out.push(`${name} is held by ${list([...d.held_by].sort())} as told, by ${list([...as.held_by].sort())} as built: who holds it?`);
    for (const [e, h] of d.holds) {
      const there = as.holds.get(e);
      if (!there) out.push(`${name} holds ${e} as told, and the app does not: still wanted?`);
      else {
        if (h.under !== there.under) out.push(`${name}'s ${e} hangs under ${h.under} as told, under ${there.under} as built: which is it?`);
        if (!same(h.fields, there.fields)) out.push(`${name}'s ${e} has ${list(h.fields)} as told, ${list(there.fields)} as built: which fields?`);
      }
    }
    for (const e of as.holds.keys()) if (!d.holds.has(e)) out.push(`${name} holds ${e} as built, and it was never told: was it meant?`);
    // a story only one side tells is said above, once
    for (const k of d.serves) if (b.stories.has(k) && !as.serves.includes(k)) out.push(`${name} serves "${t.stories.get(k)!.text}" as told, and not as built: still wanted?`);
    for (const k of as.serves) if (t.stories.has(k) && !d.serves.includes(k)) out.push(`${name} serves "${b.stories.get(k)!.text}" as built, and it was never told: was it meant?`);
  }
  for (const name of b.documents.keys()) if (!t.documents.has(name)) out.push(`${name} the app has, and it was never told: was it meant?`);
  return out;
}

export function format(name: string, said: string[]): string {
  const head = `# ${name}: as told on the model page, as built\n\n`;
  if (said.length === 0) return `${head}No gaps: the app is the model as told.`;
  return `${head}${said.length} gap${said.length === 1 ? "" : "s"}\n\n${said.map((s) => `- ${s}`).join("\n")}`;
}

/** The model as its page holds it, read as anyone signed in to it reads it: over the socket, the document the page's applet watches. */
export async function readPage(url: string, session: string): Promise<Raw> {
  const ws = connect({ url: url.replace(/^ws/, "http") }, session);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error(`No model page at ${url}: is it running?`)), { once: true });
  });
  const { page } = await expectMessage(ws, "render");
  ws.close();
  const mount = [...takersOn(page!).values()].find((m) => m.doc === `model:${MODEL}`);
  if (!mount) throw new Error("No model on the page: sign in first (bun run cli login <email> <password>).");
  return JSON.parse(mount.props) as Raw;
}
