/**
 * Compiled opens: delta's documents, read by SQL written for each one.
 *
 * `compileOpens(schema, docs)` turns an app's `defineSchema` / `defineDoc`
 * into the reads of each document -- `dzql_open__<slug>(name)` and
 * `dzql_open_at__<slug>(name, at)`, each with an `_as` for a signed-in caller --
 * which the listener opens that document's names through (`docTypeFromDef`). Each answers what `delta_open`
 * answers (the listener then shows it by the same schema), but its queries
 * are written out: which
 * table, which columns, how a collection hangs from the root, whether a row
 * is temporal, what an implied root opens with. Nothing reads
 * `_delta_collections` to find them.
 *
 * A name's scope is compiled too (`scopeOf`): its values read by position,
 * each checked as its column takes it with the framework's own messages
 * (`_delta_resolve_scope`), and its conditions written as typed SQL, so no
 * query is built from text at run time. The version is still the
 * framework's (`_delta_versions`).
 *
 * A pure function: the same definitions give the same text, byte for byte.
 * A definition it cannot compile is an error naming the document, never SQL
 * that half works.
 */
import { q, type ColumnDef, type DocDef, type ResolvedTable, type Schema } from "@blueshed/delta/backend";
import { columnSqlType } from "../postgres/sql";

/** A string as an SQL literal. */
export const lit = (s: string): string => `'${s.replace(/'/g, "''")}'`;

/** A document's function name: its prefix, lower case, every other character `_`. */
export function openFunction(prefix: string): string {
  return `dzql_open__${prefix.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`;
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
    return `jsonb_build_object(${cols.map((c) => `${lit(c)}, ${alias}.${q(c)}`).join(", ")})`;
  }
  return table.temporal ? `(to_jsonb(${alias}.*) - 'valid_from' - 'valid_to' - 'override')` : `to_jsonb(${alias}.*)`;
}

/** The rows of a temporal table that stand now, or at `at` (a time in the name): ` AND <condition>`; nothing for a table that is not temporal. */
const standing = (table: ResolvedTable, alias: string, at = "p_at"): string =>
  table.temporal
    ? ` AND (CASE WHEN ${at} IS NULL THEN ${alias}.valid_to IS NULL ELSE ${alias}.valid_from <= ${at} AND (${alias}.valid_to IS NULL OR ${alias}.valid_to > ${at}) END)`
    : "";

/** An implied document's root before its row is there: its id and each column's default, as `_delta_implied_root` gives it. */
function impliedRoot(table: ResolvedTable, doc: DocDef): string {
  const held = doc.columns?.[doc.root];
  const value = (d: ColumnDef): unknown =>
    d.default !== undefined && d.default !== null ? d.default
    : d.nullable ? null
    : d.type === "text" ? ""
    : d.type === "integer" || d.type === "real" ? 0
    : d.type === "boolean" ? false
    : null;
  const fields = Object.entries(table.columns).filter(([c]) => !held || held.includes(c)).map(([c, d]) => [c, value(d)]);
  return `jsonb_build_object('id', v_id) || ${lit(JSON.stringify(Object.fromEntries(fields)))}::jsonb`;
}

/**
 * A collection a single document includes, held under its root row `v_id`:
 * its rows joined up their parent chain to the root. A collection with no
 * parent is held whole; one whose chain ends short of the root holds nothing.
 */
function includedSingle(schema: Schema, doc: DocDef, coll: string): string {
  const table = need(schema, doc, coll);
  if (!table.parent) return includedList(schema, doc, coll);
  const joins: string[] = [];
  let where = "";
  let child = table;
  let alias = "t";
  for (let hop = 1; ; hop++) {
    const parentKey = child.parent!.collection;
    if (parentKey === doc.root) {
      where = `${alias}.${q(child.parent!.fkColumn)} = v_id${standing(table, "t")}`;
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

/** A collection a list document includes: every row of it, as `_delta_load_collection_all` reads it. */
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
}

const REAL = String.raw`^\s*[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)(e[+-]?[0-9]+)?\s*$`;
const WHOLE = String.raw`^\s*[+-]?[0-9]+\s*$`;
const SAFE = String.raw`^\s*[+-]?0*[0-9]{1,16}\s*$`;
const DAY = String.raw`^\s*([0-9]{4})-([0-9]{2})-([0-9]{2})\s*$`;

/** What a value its column cannot take does: given the message and the value's variable, the plpgsql. */
type Refuse = (message: string, value: string) => string;
/** An open refuses it: the framework's message, as a 400 (22P02). */
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
  const entries = Object.entries(doc.scope ?? {});
  if (entries.length === 0) {
    return {
      declare: ["v_rest TEXT;"],
      body: `v_rest := substring(p_name FROM ${doc.prefix.length + 1});
  v_single := v_rest <> '';
  IF v_single THEN v_id := v_rest::BIGINT; END IF;`,
      conds: "",
      single: true,
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
  const body: string[] = [`v_parts := string_to_array(substring(p_name FROM ${doc.prefix.length + 1}), ':');`, "v_single := FALSE;"];
  const conds: string[] = [];
  parsed.forEach(({ key, op, param }, i) => {
    const v = `v_s${i + 1}`;
    declare.push(`${v} TEXT;`);
    body.push(`${v} := NULLIF(v_parts[${params.indexOf(param) + 1}], '');`);
    const isKey = op !== "at" && (key === "id" || key === root.parent?.fkColumn);
    const def = root.columns[key];
    if (op === "at") {
      body.push(dayOf(v, key, refuse), `IF ${v} IS NOT NULL THEN p_at := ${v}::TIMESTAMPTZ; END IF;`);
      return;
    }
    if (!isKey && !def) throw new Error(`[dzql compile] document ${doc.prefix}: scope key "${key}" is not a column of "${doc.root}"`);
    if (op === "like") {
      conds.push(`(${v} IS NULL OR t.${q(key)} ILIKE ${v} || '%')`);
      return;
    }
    const sqlOp = op === "!=" ? "<>" : op;
    if (isKey) {
      const n = `v_n${i + 1}`;
      declare.push(`${n} BOOLEAN;`);
      body.push(`IF ${v} IS NOT NULL THEN
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
      return;
    }
    if (def!.type === "integer") {
      body.push(`IF ${v} IS NOT NULL THEN
    IF ${v} !~ '${SAFE}' THEN ${refuse(`${key} must be an integer, not "%"`, v)}
    ELSIF abs(${v}::numeric) > 9007199254740991 THEN ${refuse(`${key} must be an integer, not "%"`, v)}
    END IF;
  END IF;`);
    } else if (def!.type === "real") {
      body.push(`IF ${v} IS NOT NULL THEN
    IF ${v} !~* '${REAL}' THEN ${refuse(`${key} must be a number, not "%"`, v)} END IF;
    BEGIN
      PERFORM ${v}::float8;
    EXCEPTION WHEN numeric_value_out_of_range THEN
      ${refuse(`${key} must be a number, not "%"`, v)}
    END;
  END IF;`);
    } else if (def!.type === "timestamptz") {
      body.push(dayOf(v, key, refuse));
    }
    conds.push(`(${v} IS NULL OR t.${q(key)} ${sqlOp} ${v}::${columnSqlType(def!)})`);
  });
  return { declare, body: body.join("\n  "), conds: conds.join(" AND "), single: parsed.some((p) => p.key === "id" && p.op === "=") };
}

/** A date, YYYY-MM-DD, that the calendar has, read as the instant midnight UTC begins it; anything else refused. */
function dayOf(v: string, key: string, refuse: Refuse): string {
  return `IF ${v} IS NOT NULL THEN
    v_date := regexp_match(${v}, '${DAY}');
    IF v_date IS NULL OR v_date[1]::int < 1 OR v_date[2]::int NOT BETWEEN 1 AND 12 THEN
      ${refuse(`${key} must be a date, YYYY-MM-DD, not "%"`, v)}
    ELSIF v_date[3]::int NOT BETWEEN 1 AND extract(day FROM make_date(v_date[1]::int, v_date[2]::int, 1) + interval '1 month - 1 day')::int THEN
      ${refuse(`${key} must be a date, YYYY-MM-DD, not "%"`, v)}
    END IF;
    ${v} := format('%s-%s-%s 00:00:00+00', v_date[1], v_date[2], v_date[3]);
  END IF;`;
}

/** A document's function for `open_at`: the document as it stood at a time the caller gives. */
export const openAtFunction = (prefix: string): string => openFunction(prefix).replace(/^dzql_open__/, "dzql_open_at__");

/**
 * One document's read, as `open` (`delta_open`: the time is the name's, an implied
 * root opens with its defaults, the version is kept) or as `open_at`
 * (`delta_open_at`: the time is the caller's, a root not there is null, no version).
 */
function readOf(schema: Schema, doc: DocDef, at: boolean): string {
  const root = need(schema, doc, doc.root);
  const rootJson = rowOf(root, doc, doc.root, "t");
  const fields = (included: (coll: string) => string) =>
    doc.include.map((c) => ` || jsonb_build_object(${lit(c)}, ${included(c)})`).join("");
  const emptyIncludes = doc.include.map((c) => ` || jsonb_build_object(${lit(c)}, '{}'::jsonb)`).join("");
  const fn = at ? openAtFunction(doc.prefix) : openFunction(doc.prefix);
  const scope = scopeOf(schema, doc);
  const where = (first: string[]) => [...first, ...(scope.conds ? [scope.conds] : [])].join(" AND ") || "TRUE";
  const params = at ? "p_name TEXT, p_given TIMESTAMPTZ" : "p_name TEXT";
  const missing = !at && doc.implied ? `v_doc := jsonb_build_object(${lit(doc.root)}, ${impliedRoot(root, doc)})${emptyIncludes};` : "RETURN NULL;";
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
  ${scope.single ? "  " : ""}v_doc := jsonb_build_object(${lit(doc.root)}, v_rows)${fields((c) => includedList(schema, doc, c))};${scope.single ? `
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
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION ${fn}_as(p_user_id TEXT, ${params})
RETURNS JSONB AS $$
BEGIN
  PERFORM set_config('app.user_id', p_user_id, true);
  RETURN ${fn}(${at ? "p_name, p_given" : "p_name"});
END
$$ LANGUAGE plpgsql;`;
}

/** One document's reads: its open and its open_at, each with its `_as`. */
function openOf(schema: Schema, doc: DocDef): string {
  return `-- ${doc.prefix}: root ${doc.root}${doc.include.length ? `, includes ${doc.include.join(", ")}` : ""}${doc.implied ? ", implied" : ""}${doc.columns ? `, holds ${Object.entries(doc.columns).map(([c, cs]) => `${c}(${cs.join(", ")})`).join(" ")}` : ""}
${readOf(schema, doc, false)}

${readOf(schema, doc, true)}`;
}

/** The SQL that reads each of `docs` over `schema`: its open and its open_at, each with an `_as` for a signed-in caller. */
export function compileOpens(schema: Schema, docs: DocDef[]): string {
  const names = new Map<string, string>();
  for (const doc of docs) {
    const fn = openFunction(doc.prefix);
    const other = names.get(fn);
    if (other !== undefined) throw new Error(`[dzql compile] documents ${other} and ${doc.prefix} would share the function ${fn}`);
    names.set(fn, doc.prefix);
  }
  return [
    "-- Compiled by dzql from the app's defineSchema / defineDoc. Do not edit: compile again.",
    ...docs.map((d) => openOf(schema, d)),
    "",
  ].join("\n\n");
}
