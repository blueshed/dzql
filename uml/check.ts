// Does a diagram drift from types.ts? Names only: every class, field, message, state, event, actor
// and use case a diagram draws must be a name types.ts has, and what types.ts has should be drawn
// somewhere. Behaviour -- the order of a sequence, a guard -- lives in the diagrams alone.
//
// types.ts is read in the plain style it is written in (interfaces, unions of string literals, an
// `Api` interface of methods), so Bun is all it needs. Names are compared forgivingly -- case,
// spaces and punctuation aside -- so a diagram can say "log in" where types.ts says `login`.

export type Types = {
  interfaces: Map<string, { fields: string[]; methods: Map<string, string[]> }>;
  unions: Map<string, string[]>;
};
export type Kind = "classes" | "sequence" | "states" | "use cases" | "other";
export type Checked = { name: string; kind: Kind; drift: string[]; uses: Set<string> };

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Split a body into its top-level members, on `;` or a line break outside any bracket. */
function members(body: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of body) {
    if ("{([<".includes(ch)) depth++;
    if ("})]>".includes(ch)) depth--;
    if ((ch === ";" || ch === "\n") && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function readTypes(src: string): Types {
  const text = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const unions = new Map<string, string[]>();
  for (const m of text.matchAll(/export\s+type\s+(\w+)\s*=\s*([^;]+);/g)) {
    if (/^\s*"[^"]*"(\s*\|\s*"[^"]*")*\s*$/.test(m[2]!)) unions.set(m[1]!, [...m[2]!.matchAll(/"([^"]*)"/g)].map((x) => x[1]!));
  }
  const interfaces: Types["interfaces"] = new Map();
  const head = /export\s+interface\s+(\w+)\s*\{/g;
  for (let m; (m = head.exec(text)); ) {
    let i = head.lastIndex, depth = 1;
    const start = i;
    while (depth && i < text.length) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") depth--;
      i++;
    }
    const fields: string[] = [];
    const methods = new Map<string, string[]>();
    for (const mem of members(text.slice(start, i - 1))) {
      const method = mem.match(/^(\w+)\??\s*\(/);
      if (method) {
        // what it returns: every word and string literal after its parameters close
        let d = 0, at = mem.indexOf("(");
        for (; at < mem.length; at++) {
          if (mem[at] === "(") d++;
          if (mem[at] === ")" && --d === 0) break;
        }
        const ret = mem.slice(at + 1);
        methods.set(method[1]!, [...[...ret.matchAll(/"([^"]*)"/g)].map((x) => x[1]!), ...(ret.match(/[A-Za-z]\w*/g) ?? [])]);
        continue;
      }
      const field = mem.match(/^(\w+)\??\s*:/);
      if (field) fields.push(field[1]!);
    }
    interfaces.set(m[1]!, { fields, methods });
  }
  return { interfaces, unions };
}

export function kindOf(puml: string): Kind {
  if (/\[\*\]/.test(puml)) return "states";
  if (/\busecase\b/.test(puml)) return "use cases";
  if (/^\s*class\s+\w+/m.test(puml)) return "classes";
  if (/-+>/.test(puml)) return "sequence";
  return "other";
}

const unquote = (s: string) => s.trim().replace(/^"|"$/g, "");

export function check(name: string, puml: string, t: Types): Checked {
  const kind = kindOf(puml);
  const drift: string[] = [];
  const uses = new Set<string>(); // what in types.ts this diagram draws, for "not drawn yet"
  const api = t.interfaces.get("Api")?.methods ?? new Map<string, string[]>();
  const apiByNorm = new Map([...api.keys()].map((k) => [norm(k), k]));
  const classes = new Map([...t.interfaces].filter(([k]) => k !== "Api").map(([k, v]) => [norm(k), [k, v] as const]));

  if (kind === "classes") {
    for (const m of puml.matchAll(/^\s*class\s+(\w+)\s*\{([^}]*)\}/gm)) {
      const found = classes.get(norm(m[1]!));
      if (!found) { drift.push(`class ${m[1]} is not an interface in types.ts`); continue; }
      const [iname, iface] = found;
      uses.add(iname);
      const drawn = m[2]!.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => l.split(":")[0]!.trim());
      const fields = new Map(iface.fields.map((f) => [norm(f), f]));
      for (const f of drawn) if (!fields.has(norm(f))) drift.push(`${m[1]}.${f} is not a field of ${iname}`);
      const drawnN = new Set(drawn.map(norm));
      for (const f of iface.fields) if (!drawnN.has(norm(f))) drift.push(`${iname}.${f} is in types.ts but not drawn`);
    }
  }

  if (kind === "sequence") {
    const actors = new Set<string>();
    for (const m of puml.matchAll(/^\s*actor\s+(?:"([^"]+)"|(\w+))(?:\s+as\s+(\w+))?/gm)) actors.add(m[3] ?? m[2] ?? m[1]!);
    let call: string | null = null;
    for (const m of puml.matchAll(/^\s*("[^"]+"|\w+)\s*(-+>+)\s*("[^"]+"|\w+)\s*:\s*(.+)$/gm)) {
      const from = unquote(m[1]!), to = unquote(m[3]!), label = m[4]!.trim();
      const reply = m[2]!.startsWith("--");
      if (actors.has(from) && !reply) {
        const word = label.match(/^[A-Za-z][\w ]*?(?=\(|$|:|,)/)?.[0] ?? label;
        const method = apiByNorm.get(norm(word)) ?? apiByNorm.get(norm(label.split(/[(\s,]/)[0]!));
        if (!method) { drift.push(`${from} sends "${label}", which names no method of Api`); call = null; }
        else { call = method; uses.add(`Api.${method}`); }
      } else if (actors.has(to) && reply && call) {
        const words = new Set((api.get(call) ?? []).map(norm));
        const said = label.split(/[^A-Za-z0-9']+/).map(norm).filter(Boolean);
        if (!said.some((w) => words.has(w) || words.has(w.replace(/s$/, ""))) && !words.has(norm(label))) drift.push(`the reply "${label}" names nothing ${call} returns`);
      }
    }
  }

  if (kind === "states") {
    const states = new Set<string>(), events = new Set<string>();
    for (const m of puml.matchAll(/^\s*(\[\*\]|\w+)\s*-+>\s*(\[\*\]|\w+)\s*(?::\s*(.+))?$/gm)) {
      for (const s of [m[1]!, m[2]!]) if (s !== "[*]") states.add(s);
      if (m[3]) events.add(m[3].split("[")[0]!.trim());
    }
    const union = [...t.unions].find(([k, v]) => k.endsWith("State") && v.some((x) => [...states].some((s) => norm(s) === norm(x))));
    if (!union) drift.push(`no union ending in "State" in types.ts has these states`);
    else {
      uses.add(union[0]);
      const members = new Set(union[1].map(norm));
      for (const s of states) if (!members.has(norm(s))) drift.push(`state ${s} is not in ${union[0]}`);
      const drawn = new Set([...states].map(norm));
      for (const s of union[1]) if (!drawn.has(norm(s))) drift.push(`${union[0]} has "${s}", not drawn`);
    }
    const eventUnions = [...t.unions].filter(([k]) => k.endsWith("Event"));
    const known = new Map<string, string>([...apiByNorm.entries()].map(([k, v]) => [k, `Api.${v}`]));
    for (const [k, v] of eventUnions) for (const e of v) known.set(norm(e), k);
    for (const e of events) {
      const where = known.get(norm(e));
      if (!where) drift.push(`event "${e}" is not an Api method or in a union ending in "Event"`);
      else uses.add(where.startsWith("Api.") ? `Api.${apiByNorm.get(norm(e))}` : where);
    }
  }

  if (kind === "use cases") {
    const actorUnion = t.unions.get("Actor") ?? [];
    for (const m of puml.matchAll(/^\s*actor\s+(?:"([^"]+)"|(\w+))/gm)) {
      const a = m[1] ?? m[2]!;
      if (!actorUnion.some((x) => norm(x) === norm(a))) drift.push(`actor ${a} is not in Actor`);
      else uses.add("Actor");
    }
    for (const m of puml.matchAll(/usecase\s+"([^"]+)"/g)) {
      const method = apiByNorm.get(norm(m[1]!));
      if (!method) drift.push(`use case "${m[1]}" is not a method of Api`);
      else uses.add(`Api.${method}`);
    }
  }

  return { name, kind, drift, uses };
}

/** What types.ts has that no diagram draws yet. */
export function undrawn(t: Types, all: Checked[]): string[] {
  const used = new Set(all.flatMap((c) => [...c.uses]));
  const out: string[] = [];
  for (const k of t.interfaces.keys()) if (k !== "Api" && !used.has(k)) out.push(`${k} (a class)`);
  for (const m of t.interfaces.get("Api")?.methods.keys() ?? []) if (!used.has(`Api.${m}`)) out.push(`Api.${m}`);
  for (const k of t.unions.keys()) if (k.endsWith("State") && !used.has(k)) out.push(`${k} (states)`);
  return out;
}
