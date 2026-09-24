// Does a diagram drift from types.ts? Names only: every class, field, document, write, patch path,
// state, event, actor and use case a diagram draws must be something types.ts has, and what
// types.ts has should be drawn somewhere. Behaviour -- the order of a sequence, a guard -- lives in
// the diagrams alone.
//
// types.ts is read in the plain style it is written in (interfaces, unions of string literals, a
// `Documents` and a `Writes` interface keyed by name), so Bun is all it needs. Names are compared
// by their words, so a diagram can say "Log out" where types.ts says "log out".

export type Iface = { fields: string[]; types: Map<string, string> };
export type Doc = { key: string; shape: string; openedBy: string; match: RegExp };
export type WriteDef = { key: string; doc: string; path: string; ops: string[]; does: string; refused: string[] };
export type Types = { interfaces: Map<string, Iface>; unions: Map<string, string[]>; documents: Doc[]; writes: WriteDef[] };
export type Kind = "classes" | "sequence" | "states" | "use cases" | "document" | "other";
export type Checked = { name: string; kind: Kind; drift: string[]; uses: Set<string> };

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const ARTICLES = new Set(["a", "an", "the", "another"]);
/** A name's words: `enterName` -> enter, name; "Enter a room's name" -> enter, room, s, name. */
const words = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !ARTICLES.has(w));
/** Does a label name `name`? Its words appear in the label, in order ("Enter another room's name" names "enter a room's name"). */
export function names(label: string, name: string): boolean {
  const want = words(name), have = words(label);
  for (let i = 0; i < have.length; i++) for (let j = i + 2; j <= have.length; j++) if (have.slice(i, j).join("") === norm(name)) return true;
  let i = 0;
  for (const w of have) if (w === want[i] || w === `${want[i]}s`) i++;
  return want.length > 0 && i === want.length;
}
/** The first of `candidates` a label names, the longest first. */
const named = (label: string, candidates: string[]) => [...candidates].sort((a, b) => words(b).length - words(a).length).find((c) => names(label, c));
const literals = (s: string) => [...s.matchAll(/"([^"]*)"/g)].map((m) => m[1]!);

/** Split a body into its top-level members, on `;` or a line break outside any bracket or quote. */
function members(body: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "", quoted = false;
  for (const ch of body) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && "{([".includes(ch)) depth++;
    if (!quoted && "})]".includes(ch)) depth--;
    if (!quoted && (ch === ";" || ch === "\n") && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function readTypes(src: string): Types {
  const text = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const unions = new Map<string, string[]>();
  for (const m of text.matchAll(/export\s+type\s+(\w+)\s*=\s*([^;]+);/g)) {
    if (/^\s*"[^"]*"(\s*\|\s*"[^"]*")*\s*$/.test(m[2]!)) unions.set(m[1]!, literals(m[2]!));
  }
  const interfaces = new Map<string, Iface>();
  const head = /export\s+interface\s+(\w+)\s*\{/g;
  for (let m; (m = head.exec(text)); ) {
    let i = head.lastIndex, depth = 1;
    const start = i;
    while (depth && i < text.length) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") depth--;
      i++;
    }
    const iface: Iface = { fields: [], types: new Map() };
    for (const mem of members(text.slice(start, i - 1))) {
      const f = mem.match(/^(?:"([^"]+)"|(\w+))\??\s*:\s*([\s\S]*)$/);
      if (!f) continue;
      const key = f[1] ?? f[2]!;
      iface.fields.push(key);
      iface.types.set(key, f[3]!.trim());
    }
    interfaces.set(m[1]!, iface);
  }
  const documents: Doc[] = [...(interfaces.get("Documents")?.types ?? [])].map(([key, type]) => ({
    key,
    shape: type.match(/shape:\s*(\w+)/)?.[1] ?? "",
    openedBy: type.match(/openedBy:\s*"([^"]+)"/)?.[1] ?? "",
    match: new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/<\w+>/g, "[^\\s/]+")}$`),
  }));
  const writes: WriteDef[] = [...(interfaces.get("Writes")?.types ?? [])].map(([key, type]) => {
    const [doc, path = ""] = key.split(" ");
    return {
      key,
      doc: doc!,
      path,
      ops: [...type.matchAll(/\b(add|replace|remove):/g)].map((m) => m[1]!),
      does: type.match(/does:\s*"([^"]+)"/)?.[1] ?? "",
      refused: literals(type.match(/refused:\s*((?:"[^"]*"\s*\|?\s*)+)/)?.[1] ?? ""),
    };
  });
  // each table in Tables is a class too: its columns are the fields of its inline shape
  for (const [table, type] of interfaces.get("Tables")?.types ?? []) {
    const cols: Iface = { fields: [], types: new Map() };
    for (const mem of members(type.replace(/^\{|\}$/g, ""))) {
      const f = mem.match(/^(\w+)\??\s*:\s*([\s\S]*)$/);
      if (f) { cols.fields.push(f[1]!); cols.types.set(f[1]!, f[2]!.trim()); }
    }
    interfaces.set(table, cols);
  }
  for (const k of ["Documents", "Writes", "Tables"]) interfaces.delete(k);
  return { interfaces, unions, documents, writes };
}

export function kindOf(puml: string): Kind {
  if (/@startjson/.test(puml)) return "document";
  if (/\[\*\]/.test(puml)) return "states";
  if (/\busecase\b/.test(puml)) return "use cases";
  if (/^\s*class\s+/m.test(puml)) return "classes";
  if (/-+>/.test(puml)) return "sequence";
  return "other";
}

const unquote = (s: string) => s.trim().replace(/^"|"$/g, "");
/** "/messages/2/text" -> ["messages", "*", "text"]; "-" and ids are "*". */
const segs = (p: string) => p.split("/").filter(Boolean).map((s) => (s === "-" || /^\d+$/.test(s) ? "*" : s));
export type Flavour = "persistent" | "transient";
/** "Transient<string[]>" -> transient, string[]; a type with no flavour -> just its type. */
export function unwrap(type = ""): { flavour?: Flavour; inner: string } {
  const m = type.match(/^(Persistent|Transient)<([\s\S]+)>$/);
  return m ? { flavour: m[1]!.toLowerCase() as Flavour, inner: m[2]!.trim() } : { inner: type };
}
/** The interface an array or plain type names: "Message[]" -> Message, through any flavour. */
const elementOf = (type = "") => unwrap(type).inner.match(/^(\w+)(\[\])?$/)?.[1];
/** The flavour of the part of `doc` a path lands in: its first field's. */
export function flavourOf(t: Types, doc: Doc, path: string): Flavour | undefined {
  const [field] = segs(path);
  return field ? unwrap(t.interfaces.get(doc.shape)?.types.get(field)).flavour : undefined;
}

export function check(name: string, puml: string, t: Types): Checked {
  const kind = kindOf(puml);
  const drift: string[] = [];
  const uses = new Set<string>(); // what in types.ts this diagram draws, for "not drawn yet"
  const docFor = (docName: string) => t.documents.find((d) => d.match.test(docName));
  const doesList = t.writes.map((w) => w.does).filter(Boolean);

  /** Is `path` a path in `doc`'s shape? A field, then (through a list of an interface) its element's field. */
  const inShape = (doc: Doc, path: string): string | null => {
    const shape = t.interfaces.get(doc.shape);
    if (!shape) return `${doc.key}'s shape ${doc.shape} is not an interface`;
    const [field, idx, sub] = segs(path);
    if (!field) return null;
    if (!shape.fields.includes(field)) return `${field} is not in ${doc.shape}`;
    const type = unwrap(shape.types.get(field)).inner;
    if (idx !== undefined && !type.endsWith("[]")) return `${field} is not a list`;
    if (sub) {
      const el = t.interfaces.get(elementOf(type) ?? "");
      if (el && !el.fields.includes(sub)) return `${sub} is not in ${elementOf(type)}`;
    }
    return null;
  };

  if (kind === "document") {
    // document-<name>.puml draws that document, as an example of it
    const docName = name.replace(/^document-/, "");
    const doc = t.documents.find((d) => d.key.split(":")[0] === docName);
    if (!doc) drift.push(`no document in types.ts is called ${docName}`);
    else {
      uses.add(`document:${doc.key}`);
      const shape = t.interfaces.get(doc.shape);
      let example: Record<string, unknown> = {};
      try {
        example = JSON.parse(puml.replace(/@startjson|@endjson/g, "").replace(/^\s*#.*$/gm, ""));
      } catch {
        drift.push("the example is not JSON");
      }
      if (shape) {
        for (const k of Object.keys(example)) if (!shape.fields.includes(k)) drift.push(`${k} is not in ${doc.shape}`);
        for (const f of shape.fields) if (!(f in example)) drift.push(`${doc.shape}.${f} is not in the example`);
        for (const [f, v] of Object.entries(example)) {
          const elName = elementOf(shape.types.get(f));
          const el = t.interfaces.get(elName ?? "");
          if (el && Array.isArray(v)) for (const item of v) if (item && typeof item === "object") {
            for (const k of Object.keys(item)) if (!el.fields.includes(k)) drift.push(`${f}: ${k} is not in ${elName}`);
            for (const k of el.fields) if (!(k in item)) drift.push(`${f}: ${elName}.${k} is missing`);
          }
        }
      }
    }
  }

  if (kind === "classes") {
    for (const m of puml.matchAll(/^\s*class\s+(?:"[^"]+"\s+as\s+)?(\w+)(?:\s*<<[^>]*>>)?\s*\{([^}]*)\}/gm)) {
      const iname = [...t.interfaces.keys()].find((k) => norm(k) === norm(m[1]!));
      if (!iname) { drift.push(`class ${m[1]} is not an interface in types.ts`); continue; }
      uses.add(iname);
      const iface = t.interfaces.get(iname)!;
      const drawn = m[2]!.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => l.split(":")[0]!.trim());
      for (const f of drawn) if (!iface.fields.some((x) => norm(x) === norm(f))) drift.push(`${m[1]}.${f} is not a field of ${iname}`);
      for (const f of iface.fields) if (!drawn.some((x) => norm(x) === norm(f))) drift.push(`${iname}.${f} is in types.ts but not drawn`);
    }
  }

  if (kind === "sequence") {
    const actors = new Set<string>();
    for (const m of puml.matchAll(/^\s*actor\s+(?:"([^"]+)"|(\w+))(?:\s+as\s+(\w+))?/gm)) actors.add(m[3] ?? m[2] ?? m[1]!);
    let write: WriteDef | null = null, caller: string | null = null;
    for (const m of puml.matchAll(/^\s*("[^"]+"|\w+)\s*(-+>+)\s*("[^"]+"|\w+)\s*:\s*(.+)$/gm)) {
      const from = unquote(m[1]!), to = unquote(m[3]!), label = m[4]!.trim();
      const reply = m[2]!.startsWith("--");
      const open = label.match(/^open\s+(\S+)/);
      const patch = label.match(/^patch\s+(\S+)\s+(add|replace|remove)\s+(\/\S*)/);
      const wrote = label.match(/^(add|replace|remove)\s+(\S+)(?:\s+(\/\S*))?/);
      if (open) {
        const doc = docFor(open[1]!);
        if (!doc) drift.push(`"${label}": ${open[1]} is not a document in types.ts`);
        else uses.add(`document:${doc.key}`);
      } else if (patch) {
        // a document changing, sent to whoever has it open
        const doc = docFor(patch[1]!);
        if (!doc) { drift.push(`"${label}": ${patch[1]} is not a document in types.ts`); continue; }
        uses.add(`document:${doc.key}`);
        const bad = inShape(doc, patch[3]!);
        if (bad) drift.push(`"${label}": ${bad}`);
      } else if (wrote && actors.has(from) && !reply) {
        // a person's write: a document and a path in it
        const doc = docFor(wrote[2]!);
        if (!doc) { drift.push(`"${label}": ${wrote[2]} is not a document in types.ts`); continue; }
        uses.add(`document:${doc.key}`);
        const path = wrote[3] ?? "";
        const bad = inShape(doc, path);
        if (bad) drift.push(`"${label}": ${bad}`);
        write = t.writes.find((w) => w.doc === doc.key && segs(w.path).join("/") === segs(path).join("/")) ?? null;
        caller = from;
        if (!write) drift.push(`${from} writes "${label}", which is not in Writes`);
        else if (!write.ops.includes(wrote[1]!)) drift.push(`"${label}": ${write.key} allows ${write.ops.join(", ")}, not ${wrote[1]}`);
        else uses.add(`write:${write.key}`);
        if (flavourOf(t, doc, path) === "transient") drift.push(`"${label}": ${segs(path)[0]} is transient -- it changes as an effect, a person does not write it`);
      } else if (reply && to === caller && write) {
        const allRefusals = t.writes.flatMap((w) => w.refused);
        if (allRefusals.some((r) => norm(r) === norm(label)) && !write.refused.some((r) => norm(r) === norm(label))) drift.push(`"${label}" is not how ${write.key} is refused`);
      } else if (actors.has(from) && !reply) drift.push(`${from} sends "${label}", which is neither a write nor an open`);
    }
  }

  if (kind === "states") {
    const states = new Set<string>(), events = new Set<string>();
    for (const m of puml.matchAll(/^\s*(\[\*\]|\w+)\s*-+>\s*(\[\*\]|\w+)\s*(?::\s*(.+))?$/gm)) {
      for (const s of [m[1]!, m[2]!]) if (s !== "[*]") states.add(s);
      if (m[3]) events.add(m[3].split(/[[/]/)[0]!.trim());
    }
    const union = [...t.unions].find(([k, v]) => k.endsWith("State") && v.some((x) => [...states].some((s) => norm(s) === norm(x))));
    if (!union) drift.push(`no union ending in "State" in types.ts has these states`);
    else {
      uses.add(union[0]);
      const set = new Set(union[1].map(norm));
      for (const s of states) if (!set.has(norm(s))) drift.push(`state ${s} is not in ${union[0]}`);
      const drawn = new Set([...states].map(norm));
      for (const s of union[1]) if (!drawn.has(norm(s))) drift.push(`${union[0]} has "${s}", not drawn`);
    }
    const eventNames = [...doesList, ...[...t.unions].filter(([k]) => k.endsWith("Event")).flatMap(([, v]) => v)];
    for (const e of events) {
      const hit = named(e, eventNames);
      if (!hit) drift.push(`event "${e}" is not a write in Writes or in a union ending in "Event"`);
      else {
        const w = t.writes.find((x) => x.does === hit);
        if (w) uses.add(`does:${w.key}`);
      }
    }
  }

  if (kind === "use cases") {
    const actorUnion = t.unions.get("Actor") ?? [];
    for (const m of puml.matchAll(/^\s*actor\s+(?:"([^"]+)"|(\w+))/gm)) {
      const a = m[1] ?? m[2]!;
      if (!actorUnion.some((x) => norm(x) === norm(a))) drift.push(`actor ${a} is not in Actor`);
    }
    for (const m of puml.matchAll(/usecase\s+"([^"]+)"/g)) {
      const label = m[1]!.split("\\n")[0]!;
      const hit = named(label, doesList);
      if (!hit) drift.push(`use case "${label}" is not what any write in Writes does`);
      else uses.add(`does:${t.writes.find((w) => w.does === hit)!.key}`);
    }
  }

  // A refusal is drawn when a diagram says its reason, anywhere: a reply, or a transition's action.
  for (const r of t.writes.flatMap((w) => w.refused)) if (norm(puml).includes(norm(r))) uses.add(`reason:${r}`);
  return { name, kind, drift, uses };
}

/** The write a label names, by its words ("Enter another room's name" names session /room). */
export function writeNamed(label: string, t: Types): WriteDef | undefined {
  const hit = named(label, t.writes.map((w) => w.does).filter(Boolean));
  return t.writes.find((w) => w.does === hit);
}

/** Each write, and the first sequence that draws it: where a use case links to. */
export function sequenceOf(all: Checked[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of [...all].sort((a, b) => a.name.localeCompare(b.name))) if (c.kind === "sequence") for (const u of c.uses) if (u.startsWith("write:") && !out.has(u.slice(6))) out.set(u.slice(6), c.name);
  return out;
}

/** A use case diagram with each use case linked to the sequence of its write -- added as it is drawn, so the source stays as written and a link cannot point anywhere stale. */
export function linkUseCases(puml: string, t: Types, sequences: Map<string, string>): string {
  return puml.replace(/^(\s*usecase\s+"([^"]+)"(?:\s+as\s+\w+)?)[ \t]*$/gm, (line, head: string, label: string) => {
    const w = writeNamed(label.split("\\n")[0]!, t);
    const seq = w && sequences.get(w.key);
    return seq ? `${head} [[#${seq}{open its sequence}]]` : line;
  });
}

/** Each document, and the first diagram drawn as an example of it: where its class links to. */
export function exampleOf(all: Checked[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of [...all].sort((a, b) => a.name.localeCompare(b.name))) if (c.kind === "document") for (const u of c.uses) if (u.startsWith("document:") && !out.has(u.slice(9))) out.set(u.slice(9), c.name);
  return out;
}

/** A class diagram with each «document» class linked to its example, added as it is drawn. */
export function linkClasses(puml: string, t: Types, examples: Map<string, string>): string {
  return puml.replace(/^(\s*class\s+(?:"[^"]+"\s+as\s+)?(\w+)(?:\s*<<[^>]*>>)?)(\s*\{?)[ \t]*$/gm, (line, head: string, cls: string, brace: string) => {
    const doc = t.documents.find((d) => norm(d.shape) === norm(cls));
    const example = doc && examples.get(doc.key);
    return example ? `${head} [[#${example}{open its example}]]${brace}` : line;
  });
}

/** A diagram as it is drawn: with links to the diagrams it names, and each document part's flavour, worked out from types.ts and all the diagrams as they stand. The source is left as written. */
export function asDrawn(puml: string, name: string, t: Types, all: Checked[]): string {
  const kind = kindOf(puml);
  if (kind === "use cases") return linkUseCases(puml, t, sequenceOf(all));
  if (kind === "classes") return flavourClasses(linkClasses(puml, t, exampleOf(all)), t);
  if (kind === "sequence") return flavourPatches(puml, t);
  if (kind === "document") return flavourExample(puml, name, t);
  return puml;
}

/** A «document» class's attributes, each with its flavour in UML's property braces: `members {transient}`. */
function flavourClasses(puml: string, t: Types): string {
  let shape: Iface | undefined;
  return puml.split("\n").map((line) => {
    const head = line.match(/^\s*class\s+(?:"[^"]+"\s+as\s+)?(\w+)/);
    if (head) { shape = t.interfaces.get(t.documents.find((d) => norm(d.shape) === norm(head[1]!))?.shape ?? ""); return line; }
    if (/^\s*\}/.test(line)) { shape = undefined; return line; }
    const field = line.trim().split(":")[0]!.trim();
    const flavour = shape && field && unwrap(shape.types.get(field)).flavour;
    return flavour ? `${line} {${flavour}}` : line;
  }).join("\n");
}

/** A patch to a transient part says so: it is not on the ledger. */
function flavourPatches(puml: string, t: Types): string {
  return puml.replace(/^(\s*\S+\s*-+>+\s*\S+\s*:\s*patch\s+(\S+)\s+(?:add|replace|remove)\s+(\/\S*).*)$/gm, (line, _all: string, docName: string, path: string) => {
    const doc = t.documents.find((d) => d.match.test(docName));
    return doc && flavourOf(t, doc, path) === "transient" ? `${line} //(transient: not on the ledger)//` : line;
  });
}

/** A document's example with its transient parts highlighted. */
function flavourExample(puml: string, name: string, t: Types): string {
  const doc = t.documents.find((d) => d.key.split(":")[0] === name.replace(/^document-/, ""));
  const shape = doc && t.interfaces.get(doc.shape);
  if (!shape) return puml;
  const transient = [...shape.types].filter(([, type]) => unwrap(type).flavour === "transient").map(([f]) => `#highlight "${f}"`);
  return transient.length ? puml.replace(/@startjson[^\n]*\n/, (m) => `${m}${transient.join("\n")}\n`) : puml;
}
/** Diagrams that link to others, and so are drawn again when those change. */
export const links = (kind: Kind) => kind === "use cases" || kind === "classes";
/** Diagrams others link to. */
export const linkedTo = (kind: Kind) => kind === "sequence" || kind === "document";

/** What types.ts says that contradicts itself: a write on a transient part, a part with no flavour. */
export function typesFindings(t: Types): string[] {
  const out: string[] = [];
  for (const w of t.writes) {
    const doc = t.documents.find((d) => d.key === w.doc);
    if (doc && flavourOf(t, doc, w.path) === "transient") out.push(`the write ${w.key} lands on a transient part: a person does not write it`);
  }
  for (const d of t.documents) for (const [f, type] of t.interfaces.get(d.shape)?.types ?? []) if (!unwrap(type).flavour) out.push(`${d.shape}.${f} has no flavour: Persistent or Transient`);
  return out;
}

/** What types.ts has that no diagram draws yet. */
export function undrawn(t: Types, all: Checked[]): string[] {
  const used = new Set(all.flatMap((c) => [...c.uses]));
  const out: string[] = [];
  for (const k of t.interfaces.keys()) if (!used.has(k)) out.push(`${k} (a class)`);
  for (const d of t.documents) if (!all.some((c) => c.kind === "document" && c.uses.has(`document:${d.key}`))) out.push(`the document ${d.key}, drawn as an example`);
  for (const w of t.writes) {
    if (!used.has(`write:${w.key}`)) out.push(`the write ${w.key}, in a sequence`);
    if (!used.has(`does:${w.key}`)) out.push(`"${w.does}", as a use case or a state's event`);
  }
  for (const k of t.unions.keys()) if (k.endsWith("State") && !used.has(k)) out.push(`${k} (states)`);
  for (const r of t.writes.flatMap((w) => w.refused)) if (!used.has(`reason:${r}`)) out.push(`the refusal "${r}"`);
  return out;
}
