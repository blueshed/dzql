// The guarded write layer, hjeli's: every write the stories say, with what it presupposes, checked
// before the store takes it. hjeli generated `operations.ts` from an action's guards (`state`,
// `exists`, `is_member`, `byOther`); here the model's own words are the guards, as the model's page
// keeps them:
//
//   who      a story's teller: only someone a story says does it may make the write
//   what     a story's `writes`: the entity, the verb, and for a replace the field and the value it sets
//   where    hjeli's `is_member`: the document written is one the teller holds (`held_by`, or its own)
//   exists   a replace or a remove finds its row
//   state    a story's `requires`: the row written, or a row it hangs under, holds the value
//            (`requires requests.status=waiting`)
//
// A `cannot` story that names a write is the reason it is refused. A write that no story says is
// refused, never let through: the model is what may happen. A requirement on a row that is neither
// the one written nor one above it cannot be checked from the write, so its story is refused with
// that said (hjeli's custom operation, left to a person to finish) -- never half-guarded.
//
// `guardsOf(model)` works the guards out; `dzql model guards` writes them as an app's file, only
// once the six registers are closed. `guardWrites(ws, guards, ...)` puts them in front of any of
// delta's stores -- the JSON file, SQLite, dzql's Postgres -- as the first of its `delta` handlers:
// a write it refuses is answered 403 with the reason; one it lets by goes on to the store. Each op
// of a write is checked against the rows as they stand before it.

/** A write a story says: an entity and a verb, and for a replace the field and the value it sets. */
export type StoryWrite = { entity: string; op: "add" | "replace" | "remove"; path?: string; to?: string };
/** A state a story presupposes: an entity's field holding a value. */
export type Requires = { entity: string; path: string; value: string };

type Story = { id: string | number; text: string; actor: string; kind?: string; post?: string | null; writes?: StoryWrite[] | null; requires?: Requires[] | null };
type Document = { id: string | number; name: string; root: string; own?: number | boolean; holds?: Record<string, { parent: string | null }>; held_by?: string[] };
/** The model as the model's page keeps it: its stories and documents, each a row by its id; a list does as well. */
export type GuardModel = { stories?: Record<string, Story> | Story[]; documents?: Record<string, Document> | Document[] };

/** One write one story says, and what it takes. */
export type Rule = {
  story: string | number;
  text: string;
  actor: string;
  /** A `does` story lets it; a `cannot` story is the reason it is refused. */
  allow: boolean;
  entity: string;
  op: StoryWrite["op"];
  field?: string;
  to?: string;
  /** The documents the teller holds that show the entity: the write must be to one of them. */
  docs: string[];
  /** What it presupposes, each with the rows climbed to reach it from the one written: `[]` is that row. */
  requires: { entity: string; field: string; value: string; via: string[] }[];
  /** Why it cannot be checked from the write: then it is refused, saying so. */
  custom?: string;
};
/** The guards: the documents they stand in front of, and each write's rule. */
export type Guards = { documents: string[]; rules: Rule[]; /** Each document's root, by its name: its row is addressed as `/<root>/<field>` too (delta's). */ roots?: Record<string, string> };

export type Op = { op: string; path: string; value?: unknown };
export type Row = Record<string, unknown>;
export type RowOf = (entity: string, id: string) => Row | undefined | null | Promise<Row | undefined | null>;
export type Verdict = { ok: true; story: string | number } | { ok: false; reason: string };

const rows = <T extends { id: string | number }>(of: Record<string, T> | T[] | undefined): T[] =>
  Object.values(of ?? {}).sort((a, b) => Number(a.id) - Number(b.id));

/** The guards the model's stories say, over the documents it describes. */
export function guardsOf(model: GuardModel): Guards {
  const documents = rows(model.documents);
  const parents = new Map<string, string | null>();
  for (const d of documents) {
    for (const [name, held] of Object.entries(d.holds ?? { [d.root]: { parent: null } })) {
      if (!parents.has(name)) parents.set(name, name === d.root ? null : (held.parent ?? d.root));
    }
  }
  const above = (entity: string): string[] => {
    const chain: string[] = [];
    for (let e = parents.get(entity); e && !chain.includes(e); e = parents.get(e)) chain.push(e);
    return chain;
  };
  const rules: Rule[] = [];
  for (const s of rows(model.stories)) {
    if (s.post) continue; // a form posted to a route: the route's, not a document's
    for (const w of s.writes ?? []) {
      const chain = [w.entity, ...above(w.entity)];
      const requires: Rule["requires"] = [];
      let custom: string | undefined;
      for (const r of s.requires ?? []) {
        const at = chain.indexOf(r.entity);
        if (at < 0) custom ??= `it presupposes ${r.entity}.${r.path}=${r.value}, which is not a ${w.entity} row or one it hangs under`;
        else requires.push({ entity: r.entity, field: r.path, value: r.value, via: chain.slice(1, at + 1) });
      }
      rules.push({
        story: s.id,
        text: s.text,
        actor: s.actor,
        allow: s.kind !== "cannot",
        entity: w.entity,
        op: w.op,
        ...(w.path && { field: w.path }),
        ...(w.to !== undefined && { to: w.to }),
        docs: documents.filter((d) => w.entity in (d.holds ?? { [d.root]: 0 }) && (!!d.own || (d.held_by ?? []).includes(s.actor))).map((d) => d.name),
        requires,
        ...(custom && { custom }),
      });
    }
  }
  return { documents: [...new Set(documents.map((d) => d.name))], rules, roots: Object.fromEntries(documents.map((d) => [d.name, d.root])) };
}

/** A write's path, as delta's: `/<entity>/<id>[/<field>]`, each segment unescaped (RFC 6901). */
const segments = (path: string) => path.split("/").slice(1).map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
const said = (op: Op, entity: string, field?: string) => `${op.op} ${entity}${field ? `.${field}` : ""}${field && op.op === "replace" ? `=${JSON.stringify(op.value)}` : ""}`;

/** Does this rule say this op: the same entity and verb, and for a replace the field and value it sets? */
function says(rule: Rule, op: Op, entity: string, field: string | undefined): boolean {
  if (rule.entity !== entity || rule.op !== op.op) return false;
  const sets = (v: unknown) => rule.to === undefined || String(v) === rule.to;
  if (field !== undefined) return rule.op === "replace" && (!rule.field || (field === rule.field && sets(op.value)));
  if (rule.op === "remove" || !rule.field) return true;
  // an add, or a replace of the row whole: the field the story sets is in it, with its value
  const row = op.value !== null && typeof op.value === "object" ? (op.value as Row) : {};
  return (rule.op === "add" || rule.field in row) && sets(row[rule.field]);
}

/** May `actor` make this op, on document `doc` (its name, before the `:`)? The first story that lets it, or why not. */
export async function check(guards: Guards, write: { actor: string; doc: string; docId?: string; op: Op; rowOf: RowOf }): Promise<Verdict> {
  const { actor, doc, op, rowOf } = write;
  const at = segments(op.path);
  // the document's root row, as delta also addresses it: `/<root>/<field>`, or `/<root>` whole -- its id the document's
  const atRoot = guards.roots?.[doc] === at[0] && (at[1] === undefined || (at[1] !== "-" && !/^\d+$/.test(at[1])));
  const [entity = "", id = "-", field] = atRoot ? [at[0], write.docId ?? "-", at[1]] : at;
  const saying = guards.rules.filter((r) => says(r, op, entity, field));
  const why: string[] = [];
  for (const rule of saying.filter((r) => r.allow && r.actor === actor)) {
    const failed = await unmet(rule, { doc, op, entity, id, rowOf });
    if (!failed) return { ok: true, story: rule.story };
    why.push(`story ${rule.story} ("${rule.text}") ${failed}`);
  }
  const cannot = saying.find((r) => !r.allow && r.actor === actor);
  if (cannot) return { ok: false, reason: `${cannot.text} (story ${cannot.story})` };
  if (why.length) return { ok: false, reason: why[0]! };
  return { ok: false, reason: `No story says ${actor} may ${said(op, entity, field)}` };
}

/** What a rule needs that this write does not have, or nothing. */
async function unmet(rule: Rule, at: { doc: string; op: Op; entity: string; id: string; rowOf: RowOf }): Promise<string | undefined> {
  if (rule.custom) return `cannot be checked from the write: ${rule.custom}`;
  if (!rule.docs.includes(at.doc)) return `is told on ${rule.docs.join(", ") || "no document its teller holds"}, not ${at.doc}`;
  let row: Row | undefined | null = at.op.op === "add" ? (at.op.value as Row | undefined) : await at.rowOf(at.entity, at.id);
  if (!row) return `needs the ${at.entity} row ${at.id}, and there is none`;
  const start = row;
  for (const r of rule.requires) {
    row = start;
    for (const up of r.via) row = row && row[`${up}_id`] != null ? await at.rowOf(up, String(row[`${up}_id`])) : undefined;
    if (!row || String(row[r.field]) !== r.value) return `presupposes ${r.entity}.${r.field}=${r.value}${row ? `, and it is ${JSON.stringify(row[r.field] ?? null)}` : ", and there is no such row"}`;
  }
  return undefined;
}

/** A WsServer's `on`, as delta's is: where the guard stands, before the store. */
type On = { on(action: string, handler: (msg: any, client: any, respond: (r: any) => void) => unknown): void };

/**
 * Stand the guards in front of a store: call before the store registers its documents (delta's
 * `registerDocs`, `./json`'s, dzql's), so its `delta` handler runs first. A write to a document the
 * model does not describe goes by untouched.
 *
 * - `actorOf` names the writer as the stories do (`ann`, `manager`) from the socket's identity;
 *   undefined is someone not signed in, answered 401.
 * - `rowOf` reads a row as the store holds it, for `exists` and `requires`.
 */
export function guardWrites(ws: On, guards: Guards, opts: { actorOf: (identity: unknown, client: unknown) => string | undefined; rowOf: RowOf }): void {
  ws.on("delta", async (msg, client, respond) => {
    const [doc = "", docId] = String(msg?.doc ?? "").split(":");
    if (!guards.documents.includes(doc) || !Array.isArray(msg.ops)) return; // not the model's, or the store's 400
    const actor = opts.actorOf(client?.data?.identity, client);
    if (actor === undefined) return respond({ error: { code: 401, message: `Sign in to write to ${msg.doc}` } });
    for (const op of msg.ops as Op[]) {
      const verdict = await check(guards, { actor, doc, docId, op, rowOf: opts.rowOf });
      if (!verdict.ok) return respond({ error: { code: 403, message: verdict.reason } });
    }
  });
}

/** The guards as an app's file: what `dzql model guards` writes. */
export function guardSource(guards: Guards, from = "model.sqlite"): string {
  const open = guards.rules.filter((r) => r.custom);
  return [
    `// Generated by \`dzql model guards\` from ${from}: every write the stories say, and what it`,
    `// presupposes. Do not edit: tell the model, and generate again. Stand them in front of the store,`,
    `// before it registers its documents:`,
    `//`,
    `//   guardWrites(ws, guards, { actorOf: (identity) => ..., rowOf: (entity, id) => ... });`,
    ...(open.length ? [`//`, `// Refused until a person finishes them (a requirement the write cannot reach):`, ...open.map((r) => `//   story ${r.story}: ${r.custom}`)] : []),
    `import type { Guards } from "dzql/modelling/guards";`,
    ``,
    `export const guards: Guards = ${JSON.stringify(guards, null, 2)};`,
    ``,
  ].join("\n");
}
