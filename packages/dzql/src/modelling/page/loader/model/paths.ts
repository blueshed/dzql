/**
 * Ownership paths — a predicate-proven authorization pattern.
 *
 * A path is the authorization analogue of a document `where`: an expressive string
 * that the predicates PARSE and PROVE rather than trust. It is declared on an `owner`
 * (or `grant`) field and travels from that field's value to the acting identity.
 *
 *   referentialClosure → resolvePath  (every entity/column/enum reference resolves)
 *   authorizationClosure → terminalOf (the terminal reaches the actor identity)
 *
 * Forward-hop grammar (this build): one or more hops, optional leading `->`:
 *   path  := hop ('->' hop)*
 *   hop   := Entity '[' col '=$' ']' ('{' conds '}')? '.' field
 *   conds := cond (',' cond)*
 *   cond  := col | col '=' val | col '<>' val | col 'IN' '(' val,… ')' | col 'IS NULL' | col 'IS NOT NULL'
 *   (NULL is never a comparison value: `= NULL` / `<> NULL` are refused, since SQL would lower
 *   them to a string literal — or a comparison no row satisfies.)
 *
 * Each hop joins `Entity.<joinCol> = inbound` (inbound = the previous hop's `.field`,
 * or the marked field's value for the first hop). A non-final hop's `.field` carries
 * to the next hop; the final hop's `.field` is the terminal, compiled to `= app.user_id`.
 * A hop into a temporal entity reads `current_<entity>`. There is no free SQL — every
 * token is a model reference, which is exactly what makes the path provable.
 */
import type { Model } from "./grammar";

// Embedded `"` doubled — the parser's \w-only tokens can't carry one, but the emitter must
// never let an identifier break out of its quoting regardless (mirrors gen.ts's q).
const q = (id: string): string => `"${id.replace(/"/g, '""')}"`;
const tbl = (entity: string): string => entity.toLowerCase();
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`;

export type Cond =
  | { col: string; op: "="; val: string }
  | { col: string; op: "<>"; val: string }
  | { col: string; op: "in"; vals: string[] }
  | { col: string; op: "null" }
  | { col: string; op: "notnull" }
  | { col: string; op: "bool" };

export type Hop = { entity: string; joinCol: string; conds: Cond[]; trailing: string };
export type Path = { hops: Hop[] };

export class PathError extends Error {}

export function parsePath(src: string): Path {
  const segs = src
    .trim()
    .replace(/^->/, "")
    .split("->")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!segs.length) throw new PathError(`empty path: "${src}"`);
  return { hops: segs.map(parseHop) };
}

function parseHop(seg: string): Hop {
  const m = seg.match(/^(\w+)\[(\w+)=\$\](?:\{([^}]*)\})?\.(\w+)$/);
  if (!m) throw new PathError(`bad hop "${seg}" — want Entity[col=$]{conds?}.field`);
  return {
    entity: m[1]!,
    joinCol: m[2]!,
    conds: m[3] ? splitConds(m[3]).map(parseCond) : [],
    trailing: m[4]!,
  };
}

// Split a condition list on commas that are NOT inside parentheses, so an
// `IN (a,b)` value list survives intact.
function splitConds(str: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of str) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

function parseCond(c: string): Cond {
  let m: RegExpMatchArray | null;
  if ((m = c.match(/^(\w+)\s+IS\s+NOT\s+NULL$/i))) return { col: m[1]!, op: "notnull" };
  if ((m = c.match(/^(\w+)\s+IS\s+NULL$/i))) return { col: m[1]!, op: "null" };
  if ((m = c.match(/^(\w+)\s*(=|<>|!=)\s*null$/i)))
    throw new PathError(`bad condition "${c}" — NULL is not a value to compare with; write "${m[1]} IS NULL" or "${m[1]} IS NOT NULL"`);
  if ((m = c.match(/^(\w+)\s+IN\s*\(([^)]*)\)$/i)))
    return { col: m[1]!, op: "in", vals: m[2]!.split(",").map((v) => v.trim()).filter(Boolean) };
  if ((m = c.match(/^(\w+)\s*<>\s*(\w+)$/))) return { col: m[1]!, op: "<>", val: m[2]! };
  if ((m = c.match(/^(\w+)\s*=\s*(\w+)$/))) return { col: m[1]!, op: "=", val: m[2]! };
  if ((m = c.match(/^(\w+)$/))) return { col: m[1]!, op: "bool" };
  throw new PathError(`bad condition "${c}"`);
}

function enumVariants(type: string | undefined): Set<string> | null {
  const inner = type?.match(/^enum<(.+)>$/)?.[1];
  return inner ? new Set(inner.split("|")) : null;
}

/** Resolve every reference in the path against the model. Empty result = it resolves. */
export function resolvePath(model: Model, path: Path): string[] {
  const errs: string[] = [];
  const byName = new Map(model.entities.map((e) => [e.name, e]));
  for (const h of path.hops) {
    const e = byName.get(h.entity);
    if (!e) {
      errs.push(`hop entity "${h.entity}" is not a declared entity`);
      continue;
    }
    const field = (c: string) => e.fields.find((f) => f.name === c);
    if (!field(h.joinCol)) errs.push(`${h.entity}.${h.joinCol} (join) is not a field`);
    if (!field(h.trailing)) errs.push(`${h.entity}.${h.trailing} (carry/terminal) is not a field`);
    for (const c of h.conds) {
      const f = field(c.col);
      if (!f) {
        errs.push(`${h.entity}.${c.col} (condition) is not a field`);
        continue;
      }
      const variants = enumVariants(f.type);
      const vals = c.op === "in" ? c.vals : c.op === "=" || c.op === "<>" ? [c.val] : [];
      if (variants) for (const v of vals) if (!variants.has(v)) errs.push(`${h.entity}.${c.col} = "${v}" is not a variant of ${f.type}`);
    }
  }
  return errs;
}

/** The entity + column the path terminates at — authorization closure proves this reaches the actor. */
export function terminalOf(path: Path): { entity: string; column: string } | null {
  const last = path.hops[path.hops.length - 1];
  return last ? { entity: last.entity, column: last.trailing } : null;
}


