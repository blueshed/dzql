// The heart page's facts (heart.html): an example's stories, its documents and its entities, and
// what goes with what -- read from its code and a run of its stories (extract.ts), never written
// by hand. How each is read:
//
//   born into     a story is born into the document it writes or is refused (its own), and each
//                 document its `seen` members were told through in the run. Not the session's
//                 change to its own member: that is where the page is (a drawer closing), not
//                 what the story is about. A refusal is born into its own document alone.
//   touches       the tables a story's write names (its paths placed on its document's tables)
//                 and the tables delta wrote for it (each ledger op's `/<table>/...`); a refusal
//                 writes nothing, so its write alone.
//   reaches       a document reaches its root and includes (`defineDoc`). One kept in memory
//                 reaches the tables its keeper reads -- the one file that writes it -- by SQL; when
//                 no one file keeps it alone it is "computed", and reaches nothing we can show.
//                 One delta works out (`defineCustomDoc`) reaches the tables it `watch`es.
//   told, not     a document a story's run told to a member its `seen` does not name (and its
//   asked for     `untold` does not expect): `Told.seen` false in documents.ts's `changes()`.
//   holders²      a document whose telling grows with the square of its holders: in the run, a
//                 holder's own write was told to them and to another person holding it -- so
//                 every holder can write it, and each write is told to every holder. Two tabs of
//                 one person (the same cast) are one holder; a write from no page (`offPage`, a
//                 feed's) is nobody's who holds it.
//   red           an entity (a table in delta.ts's schema) no document reaches and no code reads.
//   looked up     one no document reaches that code reads (a credential at sign-in): never held, as
//                 it should be -- no warning.
//
// A project with no app yet is read from its stories alone (`ran` false): a story is born into its
// own document (all `read(stories)` says), touches what its own write's paths name -- not its
// premise's, which only set the stage -- and who was told, so told-not-asked and holders², are
// not said at all: they need a run.

import type { PatchOp } from "../src/json-patch";
import type { Trace } from "../src/harness";
import { typeOf, type StoryRow, type Told } from "./documents";
import { singular } from "./from-stories";

/** A document as delta.ts defines it (`documentsIn`). */
export type Doc = { name: string; root: string | null; include: string[]; watch?: string[] };
/** A table as the page draws it: its parent link, its columns, and where code outside delta.ts names it. */
export type Table = { name: string; parent: string | null; columns: { name: string; type: string }[]; code: { at: string; seed: boolean; line: string }[] };
type File = { path: string; lines: string[] };

/** The documents a story was born into: its own, and each its `seen` members were told through (not the session). */
export function bornInto(row: StoryRow, session: string | null): string[] {
  const born = new Set(row.doc ? [row.doc] : []);
  if (row.kind !== "cannot") for (const c of row.changes) if (typeOf(c.doc) !== session && c.told.some((t) => t.seen)) born.add(typeOf(c.doc));
  return [...born];
}

/** The tables a story touches: those its write's paths name, and those delta wrote, each a table its document holds. */
export function touches(ops: { table: string | null }[], ledger: { doc: string; ops: { path: string }[] }[], docs: Doc[]): string[] {
  const out = new Set(ops.flatMap((o) => (o.table ? [o.table] : [])));
  for (const entry of ledger) {
    const d = docs.find((d) => d.name === typeOf(entry.doc));
    const held = new Set(d?.root ? [d.root, ...d.include] : []);
    for (const op of entry.ops) {
      const table = op.path.split("/")[1];
      if (table && held.has(table)) out.add(table);
    }
  }
  return [...out];
}

/** Each document a story told to someone it did not ask: the members told who are neither in its `seen` nor expected `untold`. */
export function toldNotAsked(row: StoryRow, untold: string[], session: string | null): { doc: string; told: Told[] }[] {
  if (row.kind === "cannot") return [];
  return row.changes
    .filter((c) => typeOf(c.doc) !== session)
    .map((c) => ({ doc: c.doc, told: c.told.filter((t) => !t.seen && !untold.includes(t.member)) }))
    .filter((c) => c.told.length > 0);
}

/** The documents whose telling grows as holders², each with the first story that shows it: a holder's own write told to them and to another person. `person` names who a member is. */
export function squared(rows: StoryRow[], person: (member: string) => string): Map<string, { story: number; doc: string; author: string; told: Told[] }> {
  const out = new Map<string, { story: number; doc: string; author: string; told: Told[] }>();
  for (const r of rows) {
    if (r.kind !== "does") continue;
    for (const c of r.changes) {
      const type = typeOf(c.doc);
      if (out.has(type) || !c.told.some((t) => t.member === r.as)) continue;
      if (new Set(c.told.map((t) => person(t.member))).size > 1) out.set(type, { story: r.n, doc: c.doc, author: r.as, told: c.told });
    }
  }
  return out;
}

/**
 * Whether a line of code names `table` as SQL does: after FROM, JOIN, INTO, UPDATE or TABLE, or in
 * a string handed to a query (`.query(`, `.prepare(`, `.run(`). A property (`Object.keys`), a word
 * in the code, a comment: none of them is the table.
 */
export function inSql(line: string, table: string): boolean {
  if (/^\s*(\/\/|\/\*|\*|--)/.test(line)) return false;
  const name = `["'\`]?(?<![.\\w])${table}\\b`;
  if (new RegExp(`\\b(?:FROM|JOIN|INTO|UPDATE|TABLE(?:\\s+IF(?:\\s+NOT)?\\s+EXISTS)?)\\s+${name}`, "i").test(line)) return true;
  if (!/\.(?:query|prepare|run)\s*(?:<[^(]*>)?\(/.test(line)) return false;
  return [...line.matchAll(/(["'`])((?:(?!\1).)*)\1/g)].some((m) => new RegExp(name).test(m[2]!));
}

/** What a document kept in memory reads: the tables (by SQL name) named in the code of the one file that writes it -- `serverWrite`, naming `"<doc>:` -- or null when no one file keeps it alone. Comments don't count. */
export function keeper(doc: string, docs: string[], files: File[], tables: { name: string; sql: string }[]): { file: string; reads: string[] } | null {
  const code = (f: File) => f.lines.filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l));
  const names = (f: File, d: string) => code(f).some((l) => l.includes(`"${d}:`) || l.includes(`\`${d}:`));
  const writers = files.filter((f) => code(f).some((l) => l.includes("serverWrite(")) && names(f, doc));
  const file = writers.length === 1 ? writers[0]! : null;
  if (!file || docs.some((d) => d !== doc && names(file, d))) return null;
  return { file: file.path, reads: tables.filter((t) => file.lines.some((l) => inSql(l, t.sql))).map((t) => t.name) };
}

/** The function a line of code reads through: where the line names a query (`const q = db.query(...)`), the function that first runs it; else the line's own. Null at the top level. */
export function readBy(file: File, at: number): string | null {
  const query = file.lines[at]!.match(/^\s*(?:export )?const (\w+) = \w+\.query\b/)?.[1];
  const use = query ? file.lines.findIndex((l, i) => i !== at && new RegExp(`\\b${query}\\b`).test(l)) : at;
  for (let i = use; i >= 0; i--) {
    const m = file.lines[i]!.match(/^(?:export )?(?:async )?function (\w+)|^(?:export )?const (\w+) = (?:async )?\(/);
    if (m) return m[1] ?? m[2]!;
  }
  return null;
}

/** The tables no document reaches. */
export const unreached = (tables: string[], reaches: string[][]): string[] => tables.filter((t) => !reaches.some((r) => r.includes(t)));

/** A document's shape: its name, then its root and each include under the table it hangs from (its schema parent), indented; an include whose parent it does not hold hangs from the root. */
export function shape(head: string, root: string, include: string[], parentOf: (table: string) => string | null): { text: string; pad: number }[] {
  const lines = [{ text: head, pad: 0 }];
  const under = (p: string) => include.filter((t) => (include.includes(parentOf(t) ?? "") ? parentOf(t) : root) === p && t !== p);
  const walk = (t: string, depth: number) => {
    lines.push({ text: t, pad: 14 * depth });
    for (const k of under(t)) walk(k, depth + 1);
  };
  walk(root, 1);
  return lines;
}

/** A story as extract.ts reads it: what the heart needs of it. */
type StoryFacts = { n: number; name: string; as: string; kind: string; offPage: boolean; ops: { table: string | null }[]; seen: Record<string, unknown>; untold: string[] };

/**
 * The heart page's data: the stories (born into, touches, told and not asked for, with the patch
 * each such member was sent), the documents (shape, reach, who holds them, their telling's cost)
 * and the entities (parent tree, columns, red, the code that names them).
 */
export function heartOf(f: {
  example: string;
  /** Whether the stories were run; if not, nothing is said of who was told. */
  ran: boolean;
  session: string | null;
  perSession: string[];
  stories: StoryFacts[];
  rows: StoryRow[];
  traces: Trace[];
  documents: Doc[];
  tables: (Table & { sql: string })[];
  files: File[];
  cast: Record<string, string[]>;
  held: Record<string, Record<string, { held: number }>>;
}) {
  const person = (m: string) => (f.cast[m]?.length ? JSON.stringify(f.cast[m]) : m);
  const parentOf = (t: string) => f.tables.find((x) => x.name === t)?.parent ?? null;
  // a write from no page (a feed's tick) is nobody's who holds the document: it says nothing of holders²
  const n2 = f.ran ? squared(f.rows.filter((r) => !f.stories[r.n - 1]!.offPage), person) : new Map<string, never>();

  const stories = f.stories.map((s) => {
    const row = f.rows[s.n - 1]!;
    const step = f.traces.find((t) => t.story === s.name && t.phase === s.kind);
    const sent = (doc: string, member: string): PatchOp[] =>
      (step?.heard.find((h) => h.member === member)?.messages ?? []).flatMap((m) => (m.type === "patch" && (m.doc === doc || (f.perSession.includes(doc) && typeOf(m.doc!) === doc)) ? ((m.ops ?? []) as unknown as PatchOp[]) : []));
    return {
      n: s.n,
      name: s.name,
      as: s.as,
      kind: s.kind,
      seen: Object.keys(s.seen),
      born: bornInto(row, f.session),
      touches: touches(s.ops, step?.ledger ?? [], f.documents),
      unasked: (f.ran ? toldNotAsked(row, s.untold, f.session) : []).map((c) => ({ doc: typeOf(c.doc), told: c.told.map((t) => ({ ...t, patch: sent(c.doc, t.member) })) })),
    };
  });

  const documents = f.documents.map((d) => {
    const kept = d.root || d.watch ? null : keeper(d.name, f.documents.map((x) => x.name), f.files, f.tables);
    const head = f.perSession.includes(d.name) ? d.name : `${d.name}:<${d.root ? singular(d.root) : "id"}>`;
    const holding = Object.keys(f.held).filter((m) => (f.held[m]![d.name]?.held ?? 0) > 0);
    const holders = holding.filter((m, i) => holding.findIndex((o) => person(o) === person(m)) === i); // one name for each person
    const told = f.rows.flatMap((r) => (r.kind === "cannot" ? [] : r.changes.filter((c) => typeOf(c.doc) === d.name).flatMap((c) => c.told)));
    const grows = n2.get(d.name);
    const reads = d.watch ?? kept?.reads ?? [];
    const how = d.watch ? "computed by delta.ts, watching" : kept ? `computed by ${kept.file}, reading` : "computed";
    return {
      name: d.name,
      for: holders.join(", ") || (f.ran ? "nobody, in the run" : "nobody, in the stories"),
      reach: d.root ? [d.root, ...d.include] : reads,
      computed: d.root ? null : { by: d.watch ? "delta.ts" : kept?.file ?? null },
      shape: d.root ? shape(head, d.root, d.include, parentOf) : [{ text: head, pad: 0 }, { text: how, pad: 14 }, ...reads.map((t) => ({ text: t, pad: 28 }))],
      held: holders.length,
      told: f.ran ? { count: told.length, bytes: told.reduce((a, t) => a + t.bytes, 0) } : null,
      // holders² is what sharing costs; it is a warning only where the document also tells someone no story asked
      squared: grows ? { ...grows, doc: typeOf(grows.doc), asked: !stories.some((s) => s.unasked.some((u) => u.doc === d.name)) } : null,
    };
  });

  const red = new Set(unreached(f.tables.map((t) => t.name), documents.map((d) => d.reach)));
  const by = (at: string) => {
    const [path, line] = at.split(":") as [string, string];
    const file = f.files.find((x) => x.path === path);
    return file ? readBy(file, Number(line) - 1) : null;
  };
  const entities = f.tables.map((t) => {
    const read = t.code.some((c) => !c.seed);
    return { name: t.name, parent: t.parent, columns: t.columns.map((c) => c.name), code: t.code.map((c) => ({ ...c, by: c.seed ? null : by(c.at) })), red: red.has(t.name) && !read, looked: red.has(t.name) && read };
  });
  return { example: f.example, ran: f.ran, stories, documents, entities };
}

export type Heart = ReturnType<typeof heartOf>;
