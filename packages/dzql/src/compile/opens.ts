/**
 * Opens: delta's documents, read by SQL written for each one.
 *
 * `compileOpens(schema, docs)` turns an app's `defineSchema` / `defineDoc` into the reads of each
 * document -- `dzql_open__<slug>(name)` and `dzql_open_at__<slug>(name, at)`, each with an `_as` for
 * a signed-in caller -- which the listener opens that document's names through (`docTypeFromDef`).
 * Its queries are written out: which table, which columns, how a collection hangs from the root,
 * whether a row is temporal, what an implied root opens with.
 *
 * A name's scope is compiled too (`scopeOf`): its values read by position, each checked as its
 * column takes it, and its conditions written as typed SQL, so no query is built from text at run
 * time. The version is kept in `_delta_versions`.
 *
 * A pure function: the same definitions give the same text, byte for byte. A definition it cannot
 * compile is an error naming the document, never SQL that half works.
 */
import { isServerTime, q, scopeEntries, type ColumnDef, type DocDef, type ResolvedTable, type Schema } from "@blueshed/delta/backend";
import { columnSqlType, distinctNames, lit, viewOf } from "../postgres/sql";
export { lit };

/**
 * A simple case, `CASE <on>`, its branches each a `WHEN` line, else `otherwise`; with no branches,
 * `alone` (the fallback, unless said): Postgres refuses a `CASE` with no `WHEN`, and an app with no
 * documents or tables yet still compiles. `indent` is where `CASE` stands.
 */
export function caseOf(on: string, branches: string[], otherwise: string, { indent = "  ", alone = otherwise }: { indent?: string; alone?: string } = {}): string {
  if (!branches.length) return alone ? `${indent}${alone}` : "";
  return `${indent}CASE ${on}\n${branches.join("\n")}\n${indent}  ELSE ${otherwise}\n${indent}END CASE;`;
}

/** The per-document dispatcher: each compiled document's prefix to its own function, `call` saying the call; any other name, `otherwise`. */
export const prefixDispatch = (docs: DocDef[], call: (d: DocDef) => string, otherwise: string, on = "p_def.prefix"): string =>
  caseOf(on, docs.map((d) => `    WHEN ${lit(d.prefix)} THEN RETURN ${call(d)};`), otherwise);

/** A name no document compiled here holds: there is none. */
export const noDoc = (name: string): string => `RAISE EXCEPTION 'no doc def for: %', ${name} USING ERRCODE = 'P0001';`;

/** A collection none was compiled for: the write asks only its own, and delta_apply refuses any other first. */
export const noCollection = (key: string): string => `RAISE EXCEPTION 'unknown collection: %', ${key} USING ERRCODE = '22023';`;

/**
 * A compiled function's name: `dzql_<kind>__` and the document's prefix (or a collection's key),
 * lower case, every other character `_`. Postgres keeps 63 bytes of a name and drops the rest, so
 * a name that would pass 60 (room for an `_as` form), or a prefix with no letter or digit, ends in
 * a hash of the whole: two never meet in the bytes Postgres keeps.
 */
export const named = (kind: string, name: string): string => {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const whole = `dzql_${kind}__${slug}`;
  if (slug && whole.length <= 60) return whole;
  let h = 0x811c9dc5;   // FNV-1a over the name as written: the same name, the same hash
  for (const ch of `${kind}:${name}`) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  const tag = h.toString(16).padStart(8, "0");
  return `${whole.slice(0, 60 - 9)}_${tag}`;
};

/** A document's open: `dzql_open__<slug>`. */
export const openFunction = (prefix: string): string => named("open", prefix);

/** A table's rows as they stand: its current view where temporal, else the table. */
export const standingRows = (table: ResolvedTable): string => q(table.temporal ? viewOf(table.name) : table.name);

/** A temporal table's rows as they stand, as a condition on `alias`: ` AND <alias>.valid_to IS NULL`; nothing for a table that is not. */
export const currentOnly = (table: ResolvedTable, alias: string): string => (table.temporal ? ` AND ${alias}.valid_to IS NULL` : "");

/**
 * A row of `table` as JSON (`to_jsonb(<alias>.*)`), its numeric columns as their text: to_jsonb
 * writes a NUMERIC as a JSON number, which a client reads as a float, and an exact decimal is a
 * string on the wire ("10.50", as delta's decimalText gives it). The row itself where it has none.
 */
export function rowJson(table: ResolvedTable, alias: string): string {
  const exact = Object.entries(table.columns).filter(([, d]) => d.type === "numeric").map(([c]) => c);
  const whole = `to_jsonb(${alias}.*)`;
  return exact.length ? `(${whole} || jsonb_build_object(${exact.map((c) => `${lit(c)}, ${alias}.${q(c)}::text`).join(", ")}))` : whole;
}

/** A row of `table` given as JSON in `v` (a jsonb variable), its numeric columns as their text, as `rowJson` writes them. */
export function rowTexts(table: ResolvedTable, v: string): string {
  const exact = Object.entries(table.columns).filter(([, d]) => d.type === "numeric").map(([c]) => c);
  return exact.length ? `${v} || jsonb_build_object(${exact.map((c) => `${lit(c)}, ${v}->>${lit(c)}`).join(", ")})` : v;
}

/**
 * A row as a document reads it: as stored (a temporal row without its
 * validity), so a column a later version added is there for the process that
 * declares it -- each listener shows its own schema's (the schema is the
 * contract; a database may hold more). Where the document names the columns it
 * holds, those, its id and its parent key.
 */
function rowOf(table: ResolvedTable, doc: DocDef, coll: string, alias: string): string {
  const held = doc.columns?.[coll];
  if (held) {
    const cols = ["id", ...(table.parent ? [table.parent.fkColumn] : []), ...Object.keys(table.columns).filter((c) => held.includes(c))];
    return `jsonb_build_object(${cols.map((c) => `${lit(c)}, ${alias}.${q(c)}${table.columns[c]?.type === "numeric" ? "::text" : ""}`).join(", ")})`;
  }
  return table.temporal ? `(${rowJson(table, alias)} - 'valid_from' - 'valid_to' - 'override')` : rowJson(table, alias);
}

/** The rows of a temporal table that stand now, or at `at` (a time in the name): ` AND <condition>`; nothing for a table that is not temporal. */
const standing = (table: ResolvedTable, alias: string, at = "p_at"): string =>
  table.temporal
    ? ` AND (CASE WHEN ${at} IS NULL THEN ${alias}.valid_to IS NULL ELSE ${alias}.valid_from <= ${at} AND (${alias}.valid_to IS NULL OR ${alias}.valid_to > ${at}) END)`
    : "";

/**
 * An implied document's root before its row is there: its id and each column's default, as
 * `_delta_implied_root` gives it -- a time only the server sets, none, until the first write makes
 * the row (`_delta_make_implied`).
 */
export function impliedRoot(table: ResolvedTable, doc: DocDef, id = "v_id"): string {
  const held = doc.columns?.[doc.root];
  const value = (d: ColumnDef): unknown =>
    isServerTime(d) ? null
    : d.default !== undefined && d.default !== null ? d.default
    : d.nullable ? null
    : d.type === "text" ? ""
    : d.type === "integer" || d.type === "real" ? 0
    : d.type === "numeric" ? "0"
    : d.type === "boolean" ? false
    : null;
  const fields = Object.entries(table.columns).filter(([c]) => !held || held.includes(c)).map(([c, d]) => [c, value(d)]);
  return `jsonb_build_object('id', ${id}) || ${lit(JSON.stringify(Object.fromEntries(fields)))}::jsonb`;
}

/**
 * Does a row of `coll` hang from a row of `root`: does its chain of parents, walked up the schema,
 * reach it? A list holds such a collection's rows only under the root rows its scope admits;
 * one that does not (no parent, or a chain that ends short of the root) whole -- as delta's
 * `hangsFrom` says.
 */
export function hangsFrom(schema: Schema, coll: string, root: string): boolean {
  let table = schema.tables[coll];
  for (let depth = 0; depth < 32 && table?.parent; depth++) {
    if (table.parent.collection === root) return true;
    table = schema.tables[table.parent.collection];
  }
  return false;
}

/**
 * A collection a document includes, held under its root rows (`under`, a condition on the
 * root's id: a single document's `= v_id`, a list's `IN` the rows its scope admits): its rows
 * joined up their parent chain to the root. A collection with no parent is held whole; one
 * whose chain ends short of the root holds nothing.
 */
function includedSingle(schema: Schema, doc: DocDef, coll: string, under = "= v_id"): string {
  const table = need(schema, doc, coll);
  if (!table.parent) return includedList(schema, doc, coll);
  const joins: string[] = [];
  let where = "";
  let child = table;
  let alias = "t";
  for (let hop = 1; ; hop++) {
    const parentKey = child.parent!.collection;
    if (parentKey === doc.root) {
      where = `${alias}.${q(child.parent!.fkColumn)} ${under}${standing(table, "t")}`;
      break;
    }
    const parent = need(schema, doc, parentKey);
    if (!parent.parent) return `'{}'::jsonb`;   // the chain ends short of the root: nothing of it is in the document
    const p = `p${hop}`;
    joins.push(`JOIN ${q(parent.name)} ${p} ON ${p}.id = ${alias}.${q(child.parent!.fkColumn)}${standing(parent, p)}`);
    child = parent;
    alias = p;
  }
  return `(SELECT COALESCE(jsonb_object_agg(t.id, ${rowOf(table, doc, coll, "t")}), '{}'::jsonb) FROM ${[`${q(table.name)} t`, ...joins].join(" ")} WHERE ${where})`;
}

/** A collection a list document includes whole (one that hangs from no root row): every row of it. */
function includedList(schema: Schema, doc: DocDef, coll: string): string {
  const table = need(schema, doc, coll);
  return `(SELECT COALESCE(jsonb_object_agg(t.id, ${rowOf(table, doc, coll, "t")}), '{}'::jsonb) FROM ${q(table.name)} t${standing(table, "t").replace(" AND", " WHERE")})`;
}

export function need(schema: Schema, doc: DocDef, coll: string): ResolvedTable {
  const table = schema.tables[coll];
  if (!table) throw new Error(`[dzql compile] document ${doc.prefix} names a collection the schema does not have: ${coll}`);
  return table;
}

/** The scope's parts: how a name's values are read and checked, and the conditions they set. */
interface CompiledScope {
  /** plpgsql variables. */
  declare: string[];
  /** plpgsql statements: read the name's values, check each, set v_single, v_id and p_at. */
  body: string;
  /** The conditions on the root's rows, as SQL over alias t ("" when none). */
  conds: string;
  /** Whether a name can make it one row: no scope (a name with an id), or an `id` equality. */
  single: boolean;
  /** `body` without what it sets for the reads (v_single, v_id, p_at): reading the values and checking each. */
  checks: string;
  /** After `checks`: plpgsql building `_delta_resolve_scope`'s answer as it builds it -- v_where (text), v_values, v_at. */
  resolve: string;
  /** Each key the name gives by equality, and the variable holding its value as text (after `body` or `checks`). */
  values: Record<string, string>;
}

const REAL = String.raw`^\s*[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)(e[+-]?[0-9]+)?\s*$`;
/** A whole number, as text: an id said in a name, or a person by their number. */
export const WHOLE = String.raw`^\s*[+-]?[0-9]+\s*$`;
const SAFE = String.raw`^\s*[+-]?0*[0-9]{1,16}\s*$`;
const DAY = String.raw`^\s*([0-9]{4})-([0-9]{2})-([0-9]{2})\s*$`;
/** An instant in ISO 8601's basic format, as delta's `nameInstant` reads it: a date, T, hours and minutes, perhaps seconds and a fraction, and a zone. */
const INSTANT = String.raw`^\s*([0-9]{4})([0-9]{2})([0-9]{2})T([01][0-9]|2[0-3])([0-5][0-9])(?:([0-5][0-9])(\.[0-9]{1,6})?)?(Z|[+-](?:0[0-9]|1[0-5])(?:[0-5][0-9])?)\s*$`;
/** A decimal as a scope's value: as delta's isDecimal, space about it let be (as an integer's). */
const DECIMAL = String.raw`^\s*-?[0-9]+(\.[0-9]+)?\s*$`;

/** What a value its column cannot take does: given the message and the value's variable, the plpgsql. */
type Refuse = (message: string, value: string) => string;
/** An open refuses it: its message, as a 400 (22P02). */
const raiseRefusal: Refuse = (message, value) => `RAISE EXCEPTION '${message.replace(/'/g, "''")}', ${value} USING ERRCODE = '22P02';`;

/**
 * A document's scope, compiled from its definition as `_delta_resolve_scope`
 * reads it at run time: the name after the prefix split on ":" into its
 * params' values (`id` first, the rest in alphabetical order), each binding
 * taken in the order Postgres keeps a JSON object's keys (shorter first), a
 * value its column cannot take refused with the same message, and an `id`
 * equality making the document one row (single mode).
 */
export function scopeOf(schema: Schema, doc: DocDef, refuse: Refuse = raiseRefusal): CompiledScope {
  const root = need(schema, doc, doc.root);
  const entries = scopeEntries(doc.scope ?? {});
  if (entries.length === 0) {
    return {
      declare: ["v_rest TEXT;"],
      body: `v_rest := substring(p_name FROM ${doc.prefix.length + 1});
  v_single := v_rest <> '';
  IF v_single THEN v_id := v_rest::BIGINT; END IF;`,
      conds: "",
      single: true,
      checks: "",
      resolve: "",
      values: {},
    };
  }
  const parsed = entries
    .map(([key, binding]) => {
      let m: RegExpExecArray | null;
      if ((m = /^at:(.+)$/.exec(binding))) return { key, op: "at", param: m[1]! };
      if ((m = /^like:(.+)$/.exec(binding))) return { key, op: "like", param: m[1]! };
      if ((m = /^([<>=!]+):(.+)$/.exec(binding))) {
        if (!["=", ">=", "<=", ">", "<", "!="].includes(m[1]!)) throw new Error(`[dzql compile] document ${doc.prefix}: invalid scope operator "${m[1]}" (valid: =, >=, <=, >, <, !=, like, at)`);
        return { key, op: m[1]!, param: m[2]! };
      }
      return { key, op: "=", param: binding.replace(/^:+/, "") };
    })
    .sort((a, b) => a.key.length - b.key.length || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));   // jsonb's order of keys
  const params = [...new Set(parsed.map((p) => p.param))].sort((a, b) => (a === "id" ? -1 : b === "id" ? 1 : a < b ? -1 : a > b ? 1 : 0));
  const declare = ["v_parts TEXT[];", "v_date TEXT[];"];
  const read = `v_parts := string_to_array(substring(p_name FROM ${doc.prefix.length + 1}), ':');`;
  const body: string[] = [read, "v_single := FALSE;"];
  const checks: string[] = [read];
  const resolve: string[] = [];
  const conds: string[] = [];
  const values: Record<string, string> = {};
  // a check goes in both; what the reads set, in body alone
  const check = (...lines: string[]) => { body.push(...lines); checks.push(...lines); };
  // the where as text: `%I <op> %L`, joined by AND
  const where = (v: string, expr: string) => resolve.push(`IF ${v} IS NOT NULL THEN v_where := v_where || CASE WHEN v_where <> '' THEN ' AND ' ELSE '' END || ${expr}; END IF;`);
  parsed.forEach(({ key, op, param }, i) => {
    const v = `v_s${i + 1}`;
    declare.push(`${v} TEXT;`);
    check(`${v} := NULLIF(v_parts[${params.indexOf(param) + 1}], '');`);
    const isKey = op !== "at" && (key === "id" || key === root.parent?.fkColumn);
    const def = root.columns[key];
    if (op === "at") {
      check(dayOf(v, key, refuse));
      body.push(`IF ${v} IS NOT NULL THEN p_at := ${v}::TIMESTAMPTZ; END IF;`);
      resolve.push(`IF ${v} IS NOT NULL THEN v_at := ${v}; END IF;`);
      return;
    }
    if (!isKey && !def) throw new Error(`[dzql compile] document ${doc.prefix}: scope key "${key}" is not a column of "${doc.root}"`);
    if (op === "like") {
      conds.push(`(${v} IS NULL OR t.${q(key)} ILIKE ${v} || '%')`);
      where(v, `format('%I ILIKE %L', ${lit(key)}, ${v} || '%')`);
      return;
    }
    const sqlOp = op === "!=" ? "<>" : op;
    if (op === "=") values[key] = v;
    if (isKey) {
      const n = `v_n${i + 1}`;
      declare.push(`${n} BOOLEAN;`);
      check(`IF ${v} IS NOT NULL THEN
    IF ${v} ~ '${WHOLE}' THEN
      IF ${v} !~ '${SAFE}' THEN ${refuse(`${key} % is past 2^53 - 1, which no number holds exactly`, v)}
      ELSIF abs(${v}::numeric) > 9007199254740991 THEN ${refuse(`${key} % is past 2^53 - 1, which no number holds exactly`, v)}
      END IF;
      ${n} := TRUE;
    ELSIF ${v} ~* '${REAL}' THEN
      ${refuse(`${key} must be an id -- a whole number, or text -- not "%"`, v)}
    ELSE
      ${n} := FALSE;
    END IF;
  END IF;`);
      // text no row has as an id: after every number, as SQLite orders it
      const asText = ["!=", "<", "<="].includes(op) ? `t.${q(key)} IS NOT NULL` : "FALSE";
      conds.push(`(${v} IS NULL OR (CASE WHEN ${n} THEN t.${q(key)} ${sqlOp} ${v}::BIGINT ELSE ${asText} END))`);
      if (key === "id" && op === "=") body.push(`IF ${v} IS NOT NULL THEN v_single := TRUE; v_id := ${v}::BIGINT; END IF;`);
      where(v, `CASE WHEN ${n} THEN format('%I ${op} %L', ${lit(key)}, ${v}) ELSE ${asText === "FALSE" ? "'FALSE'" : `format('%I IS NOT NULL', ${lit(key)})`} END`);
      if (op === "=") resolve.push(`IF ${v} IS NOT NULL THEN v_values := v_values || jsonb_build_object(${lit(key)}, ${v}); END IF;`);
      return;
    }
    if (def!.type === "integer") {
      check(`IF ${v} IS NOT NULL THEN
    IF ${v} !~ '${SAFE}' THEN ${refuse(`${key} must be an integer, not "%"`, v)}
    ELSIF abs(${v}::numeric) > 9007199254740991 THEN ${refuse(`${key} must be an integer, not "%"`, v)}
    END IF;
  END IF;`);
    } else if (def!.type === "real") {
      check(`IF ${v} IS NOT NULL THEN
    IF ${v} !~* '${REAL}' THEN ${refuse(`${key} must be a number, not "%"`, v)} END IF;
    BEGIN
      PERFORM ${v}::float8;
    EXCEPTION WHEN numeric_value_out_of_range THEN
      ${refuse(`${key} must be a number, not "%"`, v)}
    END;
  END IF;`);
    } else if (def!.type === "timestamptz") {
      check(dayOf(v, key, refuse));
    } else if (def!.type === "date") {
      // a day as written, on the calendar: compared as a DATE
      check(dayOf(v, key, refuse, false));
    } else if (def!.type === "numeric") {
      // a decimal as a write gives one (no exponent, no NaN), compared by value as a NUMERIC
      check(`IF ${v} IS NOT NULL AND ${v} !~ '${DECIMAL}' THEN ${refuse(`${key} must be a decimal, not "%"`, v)} END IF;`);
    } else if (def!.type === "boolean" || def!.type === "json") {
      // as the column casts it (a boolean as Postgres reads one; JSON), in delta's words
      const what = def!.type === "boolean" ? `a boolean (true/false, yes/no, on/off, 1/0, or a prefix)` : "JSON";
      check(`IF ${v} IS NOT NULL THEN
    BEGIN
      PERFORM ${v}::${columnSqlType(def!)};
    EXCEPTION WHEN invalid_text_representation THEN
      ${refuse(`${key} must be ${what}, not "%"`, v)}
    END;
  END IF;`);
    }
    conds.push(`(${v} IS NULL OR t.${q(key)} ${sqlOp} ${v}::${columnSqlType(def!)})`);
    where(v, `format('%I ${op} %L', ${lit(key)}, ${v})`);
    if (op === "=") resolve.push(`IF ${v} IS NOT NULL THEN v_values := v_values || jsonb_build_object(${lit(key)}, ${v}); END IF;`);
  });
  return {
    declare, body: body.join("\n  "), conds: conds.join(" AND "), single: parsed.some((p) => p.key === "id" && p.op === "="),
    checks: checks.join("\n  "), resolve: resolve.join("\n  "), values,
  };
}

/**
 * A date, YYYY-MM-DD, that the calendar has: for a time (`instant`), the instant midnight UTC begins
 * it, or an instant in ISO 8601's basic format (`20261020T0800Z`, as delta's `nameInstant` reads
 * it: a name's ":" splits the extended one), as the extended one; for a `date`, the day as written.
 * Anything else refused.
 */
function dayOf(v: string, key: string, refuse: Refuse, instant = true): string {
  const said = instant ? `${key} must be a date, YYYY-MM-DD, or an instant, 20261020T0800Z, not "%"` : `${key} must be a date, YYYY-MM-DD, not "%"`;
  return `IF ${v} IS NOT NULL THEN
    v_date := regexp_match(${v}, '${DAY}');${instant ? `
    IF v_date IS NULL THEN v_date := regexp_match(${v}, '${INSTANT}'); END IF;` : ""}
    IF v_date IS NULL OR v_date[1]::int < 1 OR v_date[2]::int NOT BETWEEN 1 AND 12 THEN
      ${refuse(said, v)}
    ELSIF v_date[3]::int NOT BETWEEN 1 AND extract(day FROM make_date(v_date[1]::int, v_date[2]::int, 1) + interval '1 month - 1 day')::int THEN
      ${refuse(said, v)}
    END IF;
    ${v} := ${instant ? `CASE WHEN v_date[4] IS NULL THEN format('%s-%s-%s 00:00:00+00', v_date[1], v_date[2], v_date[3])
      ELSE format('%s-%s-%sT%s:%s:%s%s%s', v_date[1], v_date[2], v_date[3], v_date[4], v_date[5], COALESCE(v_date[6], '00'), COALESCE(v_date[7], ''),
        CASE WHEN v_date[8] = 'Z' THEN '+00' ELSE substr(v_date[8], 1, 3) || ':' || COALESCE(NULLIF(substr(v_date[8], 4), ''), '00') END) END` : "format('%s-%s-%s', v_date[1], v_date[2], v_date[3])"};
  END IF;`;
}

/** A document's function for `open_at`: the document as it stood at a time the caller gives. */
export const openAtFunction = (prefix: string): string => named("open_at", prefix);

/** A document's whole read, for the ledger: `dzql_open_whole__<slug>`. */
export const openWholeFunction = (prefix: string): string => named("open_whole", prefix);

/**
 * One document's read, as `open` (`delta_open`: the time is the name's, an implied
 * root opens with its defaults, the version is kept) or as `open_at`
 * (`delta_open_at`: the time is the caller's, a root not there is null -- an implied one
 * opens with its defaults, as `open` does -- and no version).
 * `whole`: as `open`, every column of every row whatever columns the document
 * names (`_delta_open(name, TRUE)`: what a walk's guard reads), with no `_as`.
 */
export function readOf(schema: Schema, given: DocDef, at: boolean, whole = false): string {
  const doc: DocDef = whole ? { ...given, columns: undefined } : given;
  const root = need(schema, doc, doc.root);
  const rootJson = rowOf(root, doc, doc.root, "t");
  const fields = (included: (coll: string) => string) =>
    doc.include.map((c) => ` || jsonb_build_object(${lit(c)}, ${included(c)})`).join("");
  const emptyIncludes = doc.include.map((c) => ` || jsonb_build_object(${lit(c)}, '{}'::jsonb)`).join("");
  const fn = whole ? openWholeFunction(doc.prefix) : at ? openAtFunction(doc.prefix) : openFunction(doc.prefix);
  const scope = scopeOf(schema, doc);
  const where = (first: string[]) => [...first, ...(scope.conds ? [scope.conds] : [])].join(" AND ") || "TRUE";
  // a list's root rows, by its name's conditions: what hangs under them is what it holds
  const admitted = `IN (SELECT t.id FROM ${q(root.name)} t WHERE ${where([])}${standing(root, "t")})`;
  const params = at ? "p_name TEXT, p_given TIMESTAMPTZ" : "p_name TEXT";
  const missing = doc.implied ? `v_doc := jsonb_build_object(${lit(doc.root)}, ${impliedRoot(root, doc)})${emptyIncludes};` : "RETURN NULL;";
  const done = at
    ? "RETURN v_doc;"
    : `INSERT INTO _delta_versions (doc_name, version) VALUES (p_name, 0) ON CONFLICT (doc_name) DO NOTHING;
  SELECT version INTO v_version FROM _delta_versions WHERE doc_name = p_name;
  RETURN v_doc || jsonb_build_object('_version', v_version);`;
  return `CREATE OR REPLACE FUNCTION ${fn}(${params})
RETURNS JSONB AS $$
DECLARE
  p_at     TIMESTAMPTZ;
  v_single BOOLEAN;
  v_id     BIGINT;
  v_rows   JSONB;
  v_root   JSONB;
  v_doc    JSONB;
  v_version BIGINT;
  ${scope.declare.join("\n  ")}
BEGIN
  ${scope.body}${at ? "\n  p_at := p_given;" : ""}
  ${scope.single ? "IF NOT v_single THEN\n    " : ""}SELECT COALESCE(jsonb_object_agg(t.id, ${rootJson}), '{}'::jsonb) INTO v_rows FROM ${q(root.name)} t WHERE ${where([])}${standing(root, "t")};
  ${scope.single ? "  " : ""}v_doc := jsonb_build_object(${lit(doc.root)}, v_rows)${fields((c) => (scope.conds && hangsFrom(schema, c, doc.root) ? includedSingle(schema, doc, c, admitted) : includedList(schema, doc, c)))};${scope.single ? `
  ELSE
    SELECT ${rootJson} INTO v_root FROM ${q(root.name)} t WHERE ${where(["t.id = v_id"])}${standing(root, "t")};
    IF v_root IS NULL THEN
      ${missing}
    ELSE
      v_doc := jsonb_build_object(${lit(doc.root)}, v_root)${fields((c) => includedSingle(schema, doc, c))};
    END IF;
  END IF;` : ""}
  ${done}
END;
$$ LANGUAGE plpgsql;${whole ? "" : `

CREATE OR REPLACE FUNCTION ${fn}_as(p_user_id TEXT, ${params})
RETURNS JSONB AS $$
BEGIN
  PERFORM set_config('app.user_id', p_user_id, true);
  RETURN ${fn}(${at ? "p_name, p_given" : "p_name"});
END
$$ LANGUAGE plpgsql;`}`;
}

/** One document's reads: its open and its open_at, each with its `_as`. */
function openOf(schema: Schema, doc: DocDef): string {
  return `-- ${doc.prefix}: root ${doc.root}${doc.include.length ? `, includes ${doc.include.join(", ")}` : ""}${doc.implied ? ", implied" : ""}${doc.columns ? `, holds ${Object.entries(doc.columns).map(([c, cs]) => `${c}(${cs.join(", ")})`).join(" ")}` : ""}
${readOf(schema, doc, false)}

${readOf(schema, doc, true)}`;
}

/** The SQL that reads each of `docs` over `schema`: its open and its open_at, each with an `_as` for a signed-in caller. */
export function compileOpens(schema: Schema, docs: DocDef[]): string {
  distinctNames(docs, (d) => openFunction(d.prefix), (a, b, fn) => `[dzql compile] documents ${a.prefix} and ${b.prefix} would share the function ${fn}`);
  return [
    "-- Compiled by dzql from the app's defineSchema / defineDoc. Do not edit: compile again.",
    ...docs.map((d) => openOf(schema, d)),
    "",
  ].join("\n\n");
}
