// Documents are how people communicate: a document is what someone needs in front of them to take
// an action, and whoever holds it is told every change to it. This reads an example's documents
// three ways, each as far as it goes, and says where they disagree.
//
//   the stories  -- each action (who, the document, the verb, the path) puts its document in
//                   front of its author, and each `seen` names who must hold it. Nothing else is
//                   needed, so a pile of stories with no app yet (loader/londons) reads too.
//   the example  -- the documents its resources own (`example.resources`, each a docType).
//   a run        -- the harness tells the stories over real sockets, and says at each step what
//                   each member's page read (`Trace.holds`) and what each was sent; while a step's
//                   state stands, each held document is put to its resource's permit.
//
// The checks are advice: they flag, they never fail a run.

import { basename, resolve } from "node:path";
import type { Example } from "dzql/rendering/example";
import type { Resource } from "dzql/rendering/resources/resource";
import { writeOf, type Stories, type Story } from "dzql/modelling/stories";
import type { PatchOp } from "dzql/rendering/json-patch";
import { controlsOn, run, type Control, type Heard, type Trace } from "dzql/modelling/harness";
import { allOpenSockets } from "dzql/rendering/resources/audience";
import { activeDocuments } from "dzql/rendering/documents";

/** One actor's dealings with one document, counted in stories: held (in front of them), written, refused, told of a change. */
export type Cell = { held: number; written: number; refused: number; told: number };
/** How one member was told of one change: its patch, the parts of their page (or a whole page) that followed, and the bytes. */
export type Told = { member: string; how: string; bytes: number; seen: boolean };
/** One story, and for each document it changed, who was told and how. */
export type StoryRow = { n: number; name: string; as: string; kind: "does" | "cannot" | "closesTab"; doc?: string; changes: { doc: string; told: Told[] }[] };
/** One op the server's permit lets through: a document, the op and a path's shape (a row's id as `*`), and who it lets. */
export type Let = { doc: string; op: string; path: string; who: string[] };
/** What permit lets through at one path of a document, with the verbs: an `add` on a field it also lets be replaced acts as that replace, and is not said apart from it. */
export type Allowed = { doc: string; path: string; ops: string[]; who: string[] };
export type Finding = { story: string; detail: string };

export type Reading = {
  /** Whether a run of the stories was read, or the stories alone. */
  ran: boolean;
  /** The documents: the resources' when there is an app, else the stories'. */
  docs: { name: string; kind: string }[];
  actors: string[];
  grid: Record<string, Record<string, Cell>>;
  stories: StoryRow[];
  /** An action whose document the example does not have, or whose author did not hold it as they acted. */
  noDocument: Finding[];
  /** A write the story says nobody sees: an empty `seen`. */
  tellsNobody: Finding[];
  /** A document defined, never written by a person (a story, the cast, going somewhere), and never held in the run. */
  unneeded: string[];
  /** Held, and written by no person: read by people, kept by someone else (a catalogue, who is here). */
  readOnly: string[];
  /** What permit allows that no story does and no page a member can get to offers. It over-reports: a shape may refuse it, and a value is never tried. */
  permitAllows: Allowed[];
};

/** A document's type: `room` for `room:general`, and for a write that names the type alone. */
export const typeOf = (doc: string): string => doc.split(":")[0]!;

/** A path's shape: each row's id (digits, a UUID, or an applet's `*`) as `*`. */
export const shapeOf = (path: string): string =>
  path
    .split("/")
    .map((s) => (/^(\d+|\*|[0-9a-f]{8}-[0-9a-f-]{27})$/i.test(s) ? "*" : s))
    .join("/");

/** `f()`, or undefined where it throws: a document let go before it is read, a permit's `refuse()`. */
export function attempt<T>(f: () => T): T | undefined {
  try {
    return f();
  } catch {
    return undefined;
  }
}

/** What a member was sent, and its size: a whole page, the parts of one, a document's patch, or a message of another kind. */
export function heardAs(m: Heard) {
  const bytes = JSON.stringify(m).length;
  if (m.type === "render") return m.html !== undefined ? { kind: "page", bytes } : { kind: "parts", parts: (m.ops ?? []).map((o) => `${o.op} ${partKey(o.target)}`), bytes };
  if (m.type === "patch") return { kind: "patch", doc: m.doc, ops: (m.ops ?? []).length, bytes };
  return { kind: m.type, bytes };
}
const partKey = (target: string) => target.match(/data-eta-part="([^"]+)"/)?.[1] ?? target;

/**
 * delta.ts's documents: each `defineDoc` (on the ledger when the `registerDocs` it is written in
 * says so; one defined before any, and registered by name, is "defined"), each `registerMemory`
 * (on whatever server), and each `defineCustomDoc`, worked out by the server from the tables it
 * `watch`es.
 */
export function documentsIn(src: string, session: string | null): { name: string; root: string | null; include: string[]; kind: string; note: string; watch?: string[] }[] {
  const lists = new Map<string, string[]>();
  for (const m of src.matchAll(/const (\w+) = \[([^\]]*)\]/g)) lists.set(m[1]!, [...m[2]!.matchAll(/"(\w+)"/g)].map((x) => x[1]!));
  const names = (raw: string) =>
    raw.startsWith("[")
      ? raw.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean).flatMap((s) => (s.startsWith("...") ? lists.get(s.slice(3)) ?? [] : [s.replace(/"/g, "")]))
      : lists.get(raw) ?? [];
  const documents: ReturnType<typeof documentsIn> = [];
  src.split(/registerDocs\(/).forEach((call, i) => {
    const kind = i === 0 ? "defined" : /ledger: true/.test(call.split("registerMemory(")[0]!) ? "written" : "written, no ledger";
    for (const m of call.matchAll(/defineDoc\("(\w+):", \{ root: "(\w+)", include: (\[[^\]]*\]|\w+)/g))
      documents.push({ name: m[1]!, root: m[2]!, include: names(m[3]!), kind, note: m[1] === session ? "the session: who you are and where" : "" });
  });
  for (const m of src.matchAll(/registerMemory\([^,]*,\s*\{\s*prefix: "(\w+):"/g)) documents.push({ name: m[1]!, root: null, include: [], kind: "live", note: "kept by the server, in memory" });
  for (const m of src.matchAll(/defineCustomDoc(?:<[^>]*>)?\("(\w+):", \{\s*watch: (\[[^\]]*\]|\w+)/g))
    documents.push({ name: m[1]!, root: null, include: [], kind: "custom", note: "worked out by the server from the tables it watches", watch: names(m[2]!) });
  return documents;
}

type Row = Record<string, unknown>;
const isRow = (v: unknown): v is Row => typeof v === "object" && v !== null && "id" in v && typeof (v as Row).id !== "object";

/**
 * The ops to put to permit, from what a document holds (as delta keeps it: its root row, and each
 * included table's rows by id): each field of each row added, replaced and removed; each
 * collection added to (`/-`), under each of its parent's rows; each row removed. A row sits under
 * the row its `<parent>_id` names, so the wire's paths nest as the document's do. `under` is where
 * the wire's paths sit (a session's `/sessions`).
 */
export function probes(value: unknown, under?: string): { op: PatchOp; shape: string }[] {
  const tables = Object.entries((under ? { [under.slice(1)]: (value as Row)[under.slice(1)] } : value) as Row);
  const root = tables.find(([, v]) => isRow(v))?.[0];
  const rows = new Map(tables.filter(([k]) => k !== root).map(([k, v]) => [k, v as Record<string, Row>]));
  const parentOf = (table: string, row: Row) => [...rows.keys()].find((p) => p !== table && `${p}_id` in row);
  /** Where a row sits, as a path and its shape. */
  const at = (table: string, id: string): { path: string; shape: string } => {
    const row = rows.get(table)![id] ?? {};
    const parent = parentOf(table, row);
    const up = parent ? at(parent, String(row[`${parent}_id`])) : { path: "", shape: "" };
    return { path: `${up.path}/${table}/${id}`, shape: `${up.shape}/${table}/*` };
  };
  const out: { op: PatchOp; shape: string }[] = [];
  const fields = (row: Row, base: { path: string; shape: string }) => {
    for (const [field, v] of Object.entries(row)) {
      if (field === "id") continue;
      for (const op of ["add", "replace", "remove"] as const) out.push({ op: op === "remove" ? { op, path: `${base.path}/${field}` } : { op, path: `${base.path}/${field}`, value: v }, shape: `${base.shape}/${field}` });
    }
  };
  if (root) fields((value as Row)[root] as Row, { path: "", shape: "" });
  for (const [table, byId] of rows) {
    const parent = Object.values(byId).map((r) => parentOf(table, r)).find(Boolean);
    const bases = parent ? Object.keys(rows.get(parent)!).map((id) => at(parent, id)) : [{ path: "", shape: "" }];
    for (const b of bases) out.push({ op: { op: "add", path: `${b.path}/${table}/-`, value: {} }, shape: `${b.shape}/${table}/-` });
    for (const id of Object.keys(byId)) {
      const here = at(table, id);
      out.push({ op: { op: "remove", path: here.path }, shape: here.shape });
      fields(byId[id]!, here);
    }
  }
  return out;
}

/** What a run says, read as it goes: every trace, the controls its pages drew and every page a member can get to offers, and what permit lets each member write to what is in front of them. */
export type Watched = { traces: Trace[]; controls: Set<string>; allowed: Map<string, Let> };

/**
 * An observer for `run`: keeps each trace, and at each story's step -- while its state stands --
 * puts every document each member holds to its resource's permit, path by path, and keeps the
 * controls each member's page draws there. A member's socket is the one whose session their page
 * read (its own documents are named by it). `everywhere` keeps what every page a member can get to
 * offers (`run`'s walk, after the stories), so a write is offered whether or not a story opened
 * the drawer it is in.
 */
export function watch(example: Example): Watched & { observe: (t: Trace) => void; everywhere: (member: string, place: string, controls: Control[]) => void } {
  const watched: Watched = { traces: [], controls: new Set(), allowed: new Map() };
  const byType = new Map(example.resources.map((c) => [c.docType, c]));
  const control = (doc: string, op: string, path: string) => `${typeOf(doc)} ${op} ${shapeOf(path)}`;
  const drawn = (html: string) => controlsOn(html).forEach((c) => watched.controls.add(control(c.doc, c.op, c.path)));
  const observe = (t: Trace) => {
    watched.traces.push(t);
    for (const h of t.heard) for (const m of h.messages) [m.html, ...(m.ops ?? []).map((o) => o.html)].forEach((html) => html && drawn(html));
    if (t.phase === "undo" || t.phase === "redo") return;
    for (const { member, docs } of t.holds) {
      const ws = allOpenSockets().find((w) => docs.some((d) => d.endsWith(`:${w.data.sessionId}`)));
      if (!ws) continue;
      drawn(attempt(() => example.render(ws.data.sessionId)) ?? "");
      for (const doc of docs) {
        const c = byType.get(typeOf(doc));
        const permit = c?.permit;
        const value = permit && attempt(() => activeDocuments()!.read(doc));
        if (!value) continue;
        const id = doc.slice(doc.indexOf(":") + 1);
        for (const { op, shape } of probes(value, c!.under)) {
          if (!attempt(() => permit(ws, op, id))) continue;
          const key = `${c!.docType} ${op.op} ${shape}`;
          const a = watched.allowed.get(key) ?? watched.allowed.set(key, { doc: c!.docType, op: op.op, path: shape, who: [] }).get(key)!;
          if (!a.who.includes(member)) a.who.push(member);
        }
      }
    }
  };
  const everywhere = (_member: string, _place: string, controls: Control[]) => controls.forEach((c) => watched.controls.add(control(c.doc, c.op, c.path)));
  return { ...watched, observe, everywhere };
}

const blank = (): Cell => ({ held: 0, written: 0, refused: 0, told: 0 });
const kindOf = (s: Story): StoryRow["kind"] => (s.does ? "does" : s.cannot ? "cannot" : "closesTab");
const seenBy = (s: Story): string[] => (Array.isArray(s.seen) ? s.seen : Object.keys(s.seen ?? {}));

/** A document as a page about it may name it: a session's own (`perSession`) by its type alone, since its id is a credential. */
export function privately(resources: Resource[]): (doc: string) => string {
  const perSession = new Set(resources.filter((c) => c.perSession).map((c) => c.docType));
  return (doc) => (perSession.has(typeOf(doc)) ? typeOf(doc) : doc);
}

/** A ledger entry as a page about it may show it: its document named `privately`, and a session's own entry without its values, whose rows carry the session's id. */
export function privateEntry(example: Example): (entry: Trace["ledger"][number]) => Trace["ledger"][number] {
  const name = privately(example.resources);
  const bare = (ops: PatchOp[]) => ops.map(({ op, path }) => ({ op, path }) as PatchOp);
  return (e) => (name(e.doc) === e.doc ? e : { ...e, doc: name(e.doc), ops: bare(e.ops), inverse: bare(e.inverse) });
}

/**
 * The documents of an example: from its stories, and -- given the example and a run of them -- from
 * its resources and what the run saw. `defined` names the documents its delta.ts defines
 * (`documentsIn`): one no resource owns is a document too, and nobody can be shown it.
 */
export function read(stories: Stories, example?: Example, watched?: Watched, defined: string[] = []): Reading {
  const write = writeOf;
  const types: Reading["docs"] = example ? example.resources.map((c) => ({ name: c.docType, kind: c.kind ?? "written" })) : [];
  for (const name of defined) if (!types.some((t) => t.name === name)) types.push({ name, kind: "no resource" });
  for (const s of stories.stories) {
    const w = write(s);
    if (w && !types.some((t) => t.name === typeOf(w.doc))) types.push({ name: typeOf(w.doc), kind: example ? "not defined" : "from the stories" });
  }
  const actors = [...new Set([...Object.keys(stories.cast), ...stories.stories.map((s) => s.as)])];
  const grid: Reading["grid"] = Object.fromEntries(actors.map((a) => [a, Object.fromEntries(types.map((t) => [t.name, blank()]))]));
  const cell = (actor: string, doc: string) => (grid[actor] ??= {})[doc] ??= blank();
  const own = new Set(types.map((t) => t.name));
  const name = privately(example?.resources ?? []);
  /** A document as the picture names it (`privately`); a kernel's (the ledger, what a session is told) not at all. */
  const named = (doc: string): string | undefined => (own.has(typeOf(doc)) ? name(doc) : undefined);

  const noDocument: Finding[] = [];
  const tellsNobody: Finding[] = [];
  const rows: StoryRow[] = stories.stories.map((s, i) => {
    const w = write(s);
    const doc = w && typeOf(w.doc);
    const row: StoryRow = { n: i + 1, name: s.name, as: s.as, kind: kindOf(s), ...(doc && { doc }), changes: [] };
    if (doc && s.does) cell(s.as, doc).written++;
    if (doc && s.cannot) cell(s.as, doc).refused++;
    const kind = doc && example && types.find((t) => t.name === doc)!.kind;
    if (kind === "not defined") noDocument.push({ story: s.name, detail: `${s.as} writes ${doc}, a document the example does not have` });
    if (kind === "no resource") noDocument.push({ story: s.name, detail: `${s.as} writes ${doc}, a document no resource owns` });
    if (doc && s.does && seenBy(s).length === 0) tellsNobody.push({ story: s.name, detail: `${s.as} writes ${doc}, and the story says nobody sees it` });
    if (watched || !doc || !s.does) return row;
    // the stories alone: the author needs the document in front of them, and whoever sees it must hold it
    const seen = seenBy(s);
    for (const m of new Set([s.as, ...seen])) cell(m, doc).held++;
    for (const m of seen) cell(m, doc).told++;
    row.changes.push({ doc, told: seen.map((m) => ({ member: m, how: "seen", bytes: 0, seen: true })) });
    return row;
  });

  if (watched) {
    for (const row of rows) {
      const s = stories.stories[row.n - 1]!;
      const step = watched.traces.find((t) => t.story === s.name && t.phase === row.kind);
      if (!step) continue;
      const held = new Map(step.holds.map((h) => [h.member, new Set(h.docs.map(named).filter(Boolean).map((d) => typeOf(d!)))]));
      for (const [m, docs] of held) for (const d of docs) cell(m, d).held++;
      if (row.doc && s.does && !s.offPage && !held.get(s.as)?.has(row.doc)) noDocument.push({ story: s.name, detail: `${s.as} writes ${row.doc} with no ${row.doc} in front of them` });
      row.changes = changes(step, named, row.doc && named(row.doc), new Set(seenBy(s)));
      if (row.kind !== "cannot") for (const c of row.changes) for (const t of c.told) cell(t.member, typeOf(c.doc)).told++;
    }
  }

  // written by a story, by the cast as it sets up, or by going somewhere (`goTo`): people's writes all
  const going = stories.goTo ? [stories.goTo("")] : [];
  const written = new Set([...stories.stories.flatMap((s) => (s.does ? [writeOf(s) ?? []].flat() : [])), ...Object.values(stories.cast).flat(), ...going].map((w) => typeOf(w.doc)));
  const held = (doc: string) => actors.some((a) => grid[a]![doc]!.held > 0);
  const unneeded = watched ? types.filter((t) => !written.has(t.name) && !held(t.name)).map((t) => t.name) : [];
  const readOnly = types.filter((t) => !written.has(t.name) && held(t.name)).map((t) => t.name);

  // what permit allows that no story does and no page a member can get to offers, by document and path:
  // an add on a field that permit also lets be replaced is that replace, and goes with it
  const done = new Set(stories.stories.flatMap((s) => { const w = s.does && writeOf(s); return w ? w.ops.map((op) => `${typeOf(w.doc)} ${op.op} ${shapeOf(op.path)}`) : []; }));
  const lets = [...(watched?.allowed.values() ?? [])];
  const replaced = new Set(lets.filter((a) => a.op === "replace").map((a) => `${a.doc} ${a.path}`));
  const byPath = new Map<string, Allowed>();
  for (const a of lets) {
    if ((a.op === "add" && replaced.has(`${a.doc} ${a.path}`)) || done.has(`${a.doc} ${a.op} ${a.path}`) || watched!.controls.has(`${a.doc} ${a.op} ${a.path}`)) continue;
    const at = byPath.get(`${a.doc} ${a.path}`) ?? byPath.set(`${a.doc} ${a.path}`, { doc: a.doc, path: a.path, ops: [], who: [] }).get(`${a.doc} ${a.path}`)!;
    at.ops.push(a.op);
    for (const m of a.who) if (!at.who.includes(m)) at.who.push(m);
  }
  const permitAllows = [...byPath.values()];

  return { ran: !!watched, docs: types, actors, grid, stories: rows, noDocument, tellsNobody, unneeded, readOnly, permitAllows };
}

/**
 * Who a step told of which document, and how: a patch names its document; the render that follows
 * it is that change reaching their page (in parts, or whole). A render with no patch before it is
 * the story's own document's (a refusal hands the page back). A kernel's document (what a session
 * is told, the ledger) is not one of the example's, and what it sends is left out.
 */
function changes(step: Trace, named: (doc: string) => string | undefined, own: string | undefined, seen: Set<string>): StoryRow["changes"] {
  const byDoc = new Map<string, Map<string, { how: string[]; bytes: number }>>();
  for (const { member, messages } of step.heard) {
    let current: string | undefined | null = own;
    for (const m of messages) {
      const h = heardAs(m);
      if (m.type === "patch") current = named(m.doc!) ?? null;
      if (!current) continue;
      const who = byDoc.get(current) ?? byDoc.set(current, new Map()).get(current)!;
      const told = who.get(member) ?? who.set(member, { how: [], bytes: 0 }).get(member)!;
      told.how.push(h.kind === "patch" ? `patch ${h.ops} op${h.ops === 1 ? "" : "s"}` : h.kind === "parts" ? `parts ${h.parts!.join(", ")}` : h.kind);
      told.bytes += h.bytes;
    }
  }
  return [...byDoc].map(([doc, who]) => ({ doc, told: [...who].map(([member, t]) => ({ member, how: t.how.join(" + "), bytes: t.bytes, seen: seen.has(member) })) }));
}

/** Where an example is, and its name: `wedding` is `examples/wedding`; a path (it has a `/`) is a project of its own, named by its last part. */
export function exampleAt(arg: string): { dir: string; name: string } {
  if (!arg.includes("/")) return { dir: `${import.meta.dir}/../../${arg}`, name: arg };
  const dir = resolve(arg);
  return { dir, name: basename(dir) };
}

/** The documents of an example (`exampleAt`): from a run of its stories when it has an app, else from the stories alone. */
export async function documentsOf(at: string): Promise<Reading> {
  const { dir } = exampleAt(at);
  const { stories } = (await import(`${dir}/stories.ts`)) as { stories: Stories };
  if (!(await Bun.file(`${dir}/index.ts`).exists())) return read(stories);
  const { example } = (await import(`${dir}/index.ts`)) as { example: Example };
  const watched = watch(example);
  await run(example, stories, watched.observe, { everywhere: watched.everywhere });
  return read(stories, example, watched, documentsIn(await Bun.file(`${dir}/delta.ts`).text(), null).map((d) => d.name));
}

const MARKS: [keyof Cell, string][] = [["held", "H"], ["written", "W"], ["refused", "R"], ["told", "T"]];

/** The reading, in words: who holds what, the checks, and each story's changes. */
export function format(name: string, r: Reading): string {
  const lines: string[] = [];
  const out = (s = "") => lines.push(s);
  out(`# ${name}: documents`);
  out();
  out(r.ran ? `Read from the stories, the example's resources, and a run of the stories (${r.stories.length}).` : `Read from the stories alone (${r.stories.length}): there is no app to run, so what is held is what the stories say each person needs.`);
  out();
  out(`## Who holds what`);
  out();
  const width = Math.max(...r.actors.map((a) => a.length));
  const cols = r.docs.map((d) => Math.max(d.name.length, 4));
  out(`${"".padEnd(width)}  ${r.docs.map((d, i) => d.name.padEnd(cols[i]!)).join("  ")}`);
  for (const a of r.actors) out(`${a.padEnd(width)}  ${r.docs.map((d, i) => (MARKS.filter(([k]) => r.grid[a]![d.name]![k] > 0).map(([, m]) => m).join("") || "·").padEnd(cols[i]!)).join("  ")}`);
  out();
  out(`H ${r.ran ? "held: their page read it" : "needs it: they act on it, or a story says they see it"} · W wrote · R refused · T ${r.ran ? "told of a change" : "a story says they see a change"}`);
  out();
  out(`## Actions with no document (${r.noDocument.length})`);
  for (const f of r.noDocument) out(`- ${f.story} — ${f.detail}`);
  out();
  out(`## Writes that tell nobody (${r.tellsNobody.length})`);
  for (const f of r.tellsNobody) out(`- ${f.story} — ${f.detail}`);
  out();
  if (r.ran) {
    out(`## Documents no story needs (${r.unneeded.length})`);
    for (const d of r.unneeded) out(`- ${d}: defined, never written, never held in the run`);
    out();
  }
  out(`Read-only (held, written by nobody): ${r.readOnly.join(", ") || "none"}`);
  out();
  if (r.ran) {
    out(`## Writes the server accepts that no page offers (${r.permitAllows.length} ${r.permitAllows.length === 1 ? "path" : "paths"})`);
    out();
    out(`permit allows: each path in what a member holds, per verb, put to its resource's permit, where no story does it and no page a member can get to offers it. It over-reports: a shape may refuse what permit lets by, and a value is never tried.`);
    for (const a of r.permitAllows) out(`- permit allows ${a.doc} ${a.path}: ${a.ops.join(", ")} — to ${a.who.join(", ")}`);
    out();
  }
  out(`## Each story's changes, and who was told`);
  for (const s of r.stories) {
    out(`${s.n}. ${s.kind === "cannot" ? "cannot · " : s.kind === "closesTab" ? "closes a tab · " : ""}${s.name}`);
    for (const c of s.changes) out(`    ${c.doc} → ${c.told.map((t) => `${t.member}${t.seen || s.kind === "cannot" ? "" : " (not in seen)"}${r.ran ? ` ${t.how} ${t.bytes} B` : ""}`).join("; ")}`);
  }
  return lines.join("\n");
}
