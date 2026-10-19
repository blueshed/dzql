import type { PatchOp } from "dzql/rendering/json-patch";
import { nextMessage, write, type WireMessage } from "dzql/rendering/test-socket";
import type { Heart } from "./facts";

// What loading an app into a model writes (`bun run model:load`, ./load.ts): the app's facts, as
// the loader reads them from its code and a run of its stories (./extract.ts), said in the model's
// own words -- the same writes the CLI's verbs make (../cli.ts). `writesOf` is pure, so what a load
// would write is tested without a server; `send` sends it.

type Field = { name: string; type: string };

/** A story as the model takes it: its words, who tells it, whether they do it or are refused, a route it posts to, what it touches; and, for the model as built, the model story it tells, where the app's names one (the model takes no such field). */
export type StoryWrite = { text: string; actor: string; kind: "does" | "cannot"; post?: string; model?: number | false; touches: string[] };

/** A document as the model takes it, its stories by their place among the stories loaded, and each entity it holds besides its root. */
export type DocumentWrite = { name: string; root: string; own: boolean; held_by: string[]; serves: number[]; fields: Field[]; holds: { entity: string; under: string; fields: Field[] }[] };

/** What a load writes: each story, each document the stories need, and the documents left out because no story needs them (the model refuses one that serves none). */
export type Load = { stories: StoryWrite[]; documents: DocumentWrite[]; skipped: string[] };

const text = (names: string[]): Field[] => names.map((name) => ({ name, type: "text" }));

export function writesOf(heart: Heart): Load {
  const stories = heart.stories.map((s): StoryWrite => ({ text: s.name, actor: s.as, kind: s.kind === "cannot" ? "cannot" : "does", ...(s.post ? { post: s.post } : {}), ...(s.model !== undefined && { model: s.model }), touches: s.touches }));
  const entity = (name: string) => heart.entities.find((e) => e.name === name);
  const documents: DocumentWrite[] = [];
  const skipped: string[] = [];
  for (const d of heart.documents) {
    const serves = heart.stories.flatMap((s, i) => (s.born.includes(d.name) ? [i] : []));
    if (serves.length === 0) {
      skipped.push(d.name);
      continue;
    }
    const root = d.reach[0] ?? d.name;
    documents.push({
      name: d.name,
      root,
      own: !d.shape[0]!.text.includes(":<"), // each person's own goes by its name alone
      held_by: d.for.startsWith("nobody") ? [] : d.for.split(", "),
      serves,
      fields: text(d.columns?.[root] ?? entity(root)?.columns ?? []),
      holds: d.reach.slice(1).map((name) => {
        const parent = entity(name)?.parent;
        return { entity: name, under: parent && d.reach.includes(parent) ? parent : root, fields: text(d.columns?.[name] ?? entity(name)?.columns ?? []) };
      }),
    });
  }
  return { stories, documents, skipped };
}

let ids = 0;

/** Sends one write to the model and waits for its own answer: the id of the row it made, or why it was refused. */
export async function said(ws: WebSocket, ops: PatchOp[]): Promise<string> {
  const id = ++ids;
  write(ws, "model", ops, id);
  for (let m: WireMessage = await nextMessage(ws); ; m = await nextMessage(ws)) {
    if (m.id !== id) continue;
    if (m.type === "refused") throw new Error(`refused: ${m.reason ?? "no reason given"} (${JSON.stringify(ops[0])})`);
    return String(m.ops?.[0]?.path.split("/")[2]);
  }
}

/** A load, sent a write at a time: every story, then every document, naming the stories it serves by the ids they were given, then what it holds. */
export async function send(ws: WebSocket, load: Load): Promise<void> {
  const storyIds: string[] = [];
  for (const s of load.stories) storyIds.push(await said(ws, [{ op: "add", path: "/stories/-", value: s }]));
  for (const d of load.documents) {
    const id = await said(ws, [{ op: "add", path: "/documents/-", value: { name: d.name, root: d.root, own: d.own, held_by: d.held_by, stories: d.serves.map((i) => storyIds[i]), fields: d.fields } }]);
    for (const h of d.holds) await said(ws, [{ op: "replace", path: `/documents/${id}/holds/${h.entity}`, value: { under: h.under, fields: h.fields } }]);
  }
}
