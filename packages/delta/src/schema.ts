/**
 * Shared schema primitives: the same for every backend (the JSON file, SQLite, and dzql's Postgres).
 *
 * Every backend declares their tables via the same `defineSchema` + `defineDoc`
 * vocabulary, and the resolved shape (`Schema`, `ResolvedTable`, `DocDef`)
 * travels between `generateSql`, `registerDocs`, the doc registry, and the
 * validation helpers. Keeping these definitions in one place prevents the
 * two backends from silently drifting apart on column shorthand, parent-fk
 * resolution, or cascade wiring.
 *
 * Column type union: the superset of what both backends accept. SQLite maps
 * `timestamptz` to `TEXT` (ISO-8601); Postgres uses the native type. Each
 * backend's codegen / default / validation helpers own the per-type
 * mappings — this module is the vocabulary only.
 */
import { splitPath, type DeltaOp } from "./core";
import { isAnyone, parsePath } from "./paths";

export type ColumnType =
  | "text" | "integer" | "real" | "boolean" | "json" | "timestamptz";

export interface ColumnDef {
  type: ColumnType;
  nullable?: boolean;
  /**
   * What a row a write makes holds where its value leaves the column out. `"now"`, on a
   * `timestamptz` alone, is the server's time as the row is written (`isServerTime`): a replace
   * of the row whole keeps the row's own.
   */
  default?: unknown;
}

/** Is the column a time only the server sets (`default: "now"`, a `timestamptz`)? Every backend fills it as the row is written. */
export function isServerTime(def: ColumnDef): boolean {
  return def.default === "now";
}

/** Compact shorthand: `"text"` or `"text?"` (nullable). */
export type ColumnShorthand =
  | "text" | "integer" | "real" | "boolean" | "json" | "timestamptz"
  | "text?" | "integer?" | "real?" | "boolean?" | "json?" | "timestamptz?";

export interface TableDef {
  /** SQL table name (defaults to the schema key). */
  table?: string;
  /** Column definitions. */
  columns: Record<string, ColumnDef | ColumnShorthand>;
  /** Parent collection. String = collection key (FK auto-derived as `<key>_id`);
   *  object = explicit FK column. */
  parent?: string | { collection: string; fk: string };
  /** FK columns that trigger cascade deletes when the referenced row is removed.
   *  String = FK column name (collection derived by convention);
   *  object = explicit FK column + collection. */
  cascadeOn?: (string | { fk: string; collection: string })[];
  /**
   * Columns that name a row of another collection, by its key: `{ book: "books" }`. A write
   * that names a row not there (a current one) is refused, 404; a row still named by a current
   * row is not removed, 409, saying who names it -- on every backend, at the end of the write, so
   * a write may take both away together. An integer column; null names nothing. A temporal
   * row's closed versions name nothing. Rows imported are kept as they come.
   */
  refs?: Record<string, string>;
  /** Set to `false` to disable temporal versioning (valid_from/valid_to). Default: `true`. */
  temporal?: boolean;
  /**
   * Values no two current rows share, each refused with 409 on every backend: a column, columns
   * together, or `{ columns, whereNull }`, held only among rows where those columns are null
   * (`{ columns: ["book"], whereNull: ["ended"] }`: a book is on one open hold at a time).
   */
  unique?: (string | string[] | UniqueDef)[];
}

/** A unique constraint: the columns no two current rows share, among those where `whereNull` are null. */
export interface UniqueDef {
  columns: string[];
  whereNull?: string[];
}

/** A unique constraint as every backend makes it: an index `idx_<table>_unique_<columns>`, held among current rows. */
export interface ResolvedUnique {
  name: string;
  columns: string[];
  whereNull: string[];
}

export interface Schema {
  tables: Record<string, ResolvedTable>;
}

export interface ResolvedTable {
  /** SQL table name. */
  name: string;
  /** Schema key. */
  docKey: string;
  columns: Record<string, ColumnDef>;
  parent?: { collection: string; fkColumn: string };
  temporal: boolean;
  /** Computed: collections that have this table as parent. */
  children: string[];
  /** Computed: collections that reference this table via `cascadeOn`. */
  referencedBy: { collection: string; fkColumn: string }[];
  /** Its unique constraints (`TableDef.unique`); absent when it has none. */
  unique?: ResolvedUnique[];
  /** The columns that name a row of another collection (`TableDef.refs`), by column; absent when none. */
  refs?: ResolvedRef[];
  /** Computed: the columns of other collections that name a row of this one, by collection then column; absent when none. */
  namedBy?: ResolvedRef[];
}

/** A column that names a row of a collection: `collection` is the naming one in `namedBy`, the named one in `refs`. */
export interface ResolvedRef {
  column: string;
  collection: string;
}

export interface DocDef {
  prefix: string;
  root: string;
  include: string[];
  scope: Record<string, string>;
  /** There before its root row is: opens empty, and its first write makes the row. */
  implied?: boolean;
  /**
   * The columns it holds of a collection it names (the root, an include):
   * those, the row's id and its parent key. A collection not named here is
   * held whole. It is opened, told and written by those alone.
   */
  columns?: Record<string, string[]>;
  /**
   * Who may open it, write through it and hear what is written to it, as a path from its row to
   * the person (`../paths.ts`): `"@author_id"`, `"@org_id->members[org_id=$]{active}.person_id"`.
   * With auth, a document with a path needs no `owns` function or `shared`.
   */
  owns?: string;
  /**
   * The document's own rule, what the schema cannot say ("a name is not blank", "only the
   * keeper of the list writes it"): asked of each op of a write before any is applied, with the
   * writer (`who`: the identity it signed in as; none where the store has no sign-in). `true`
   * takes it; `false`, or a reason, refuses the whole write with 400 and that reason, and nothing
   * changes. An undo or a redo is not asked: it puts back what was taken. Every backend asks it.
   */
  accept?: Accept;
  /**
   * What the server makes of a write as it is written: asked of each op of a fresh write, after
   * `accept` has taken it, with the writer (`who`, as `accept` is told). It answers the op to
   * apply in its place -- an add's value with a field filled ("a booking ends two weeks from its own
   * day") -- which is then validated as any write is, applied, told and recorded: what is
   * stored is what the server gave. An undo or a redo is never shaped: it puts back what was.
   * Every backend asks it (dzql's thin client has the same hook, `Resource.shape`, for a page's writes).
   */
  shape?: Shape;
}

/** A document's own rule (`DocDef.accept`): `true` takes the op; `false` or a reason refuses the write. */
export type Accept = (op: DeltaOp, by: { doc: string; who?: unknown }) => boolean | string;

/** What the server makes of an op as it is written (`DocDef.shape`): the op to apply in its place. */
export type Shape = (op: DeltaOp, by: { doc: string; who?: unknown }) => DeltaOp;

/**
 * A fresh write as the document's `shape` makes it, op by op, in order (asked after `accept`,
 * before the ops are validated), as every backend asks it; each op is given as a copy, so a shape
 * may change it. The write as sent where there is none.
 */
export function shapedBy(def: DocDef, doc: string, ops: DeltaOp[], who?: unknown): DeltaOp[] {
  if (!def.shape) return ops;
  return ops.map((op) => def.shape!(structuredClone(op), { doc, who }));
}

/** The refusal a document's rule gives a write (400), or none: each op asked before any is applied, as every backend asks it. */
export function refusedBy(def: DocDef, doc: string, ops: DeltaOp[], who?: unknown): string | undefined {
  if (!def.accept) return undefined;
  for (const op of ops) {
    const taken = def.accept(op, { doc, who });
    if (taken !== true) return taken || `${doc} does not take ${op.op} ${op.path}`;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Identifier validation — defence-in-depth for the SQL codegen, which
// interpolates these names into DDL. Names must be plain SQL identifiers so a
// quote/backslash/space can never reach the generated SQL.
// ---------------------------------------------------------------------------

/**
 * A table or column name as SQL names it: quoted, so a name that is a keyword
 * (`order`, `from`, `in`) or holds a `/` is a name. Every backend's SQL names
 * a schema's tables and columns through it.
 */
export function q(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

/** Plain SQL identifier: starts with a letter/underscore, then word chars. */
const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Doc prefix: identifier-ish, also allowing the `:` and `-` used in doc names. */
const DOC_PREFIX = /^[A-Za-z_][A-Za-z0-9_:-]*$/;
/**
 * Column names are quoted into the SQL of every backend via `q()`, which
 * escapes embedded double quotes — but to fail fast we still forbid the chars that could break
 * out of a quoted identifier or an array/JSON literal. We deliberately allow
 * `/` and `~` here (JSON Pointer reference tokens unescape to these), so a
 * column named `c/d` or `e~f` is legal; we only reject quotes, backslash,
 * whitespace, and control characters.
 */
const COLUMN_NAME = /^[^"'\\\s\x00-\x1f]+$/;

function assertIdentifier(value: string, role: string): void {
  if (!SQL_IDENTIFIER.test(value)) {
    throw new Error(
      `Invalid ${role}: ${JSON.stringify(value)} — must match ${SQL_IDENTIFIER}`,
    );
  }
}

function assertColumnName(value: string): void {
  if (value.length === 0 || !COLUMN_NAME.test(value)) {
    throw new Error(
      `Invalid column name: ${JSON.stringify(value)} — must not contain ` +
        `quotes, backslashes, or whitespace`,
    );
  }
}

export function defineSchema(defs: Record<string, TableDef>): Schema {
  const tables: Record<string, ResolvedTable> = {};

  // First pass: resolve columns and basic properties.
  for (const [key, def] of Object.entries(defs)) {
    assertIdentifier(key, "schema key");
    if (def.table !== undefined) assertIdentifier(def.table, "table name");
    // Postgres folds an unquoted name to lowercase, so the table and its seq_<table> it makes and
    // the privileges it asks of the name would be another table's: every backend refuses it (#71's review)
    const table = def.table ?? key;
    if (table !== table.toLowerCase()) {
      throw new Error(`Invalid table name: ${JSON.stringify(table)} -- a table name is lowercase snake_case (${JSON.stringify(table.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase())}); give it as table: and keep the key`);
    }
    for (const col of Object.keys(def.columns)) {
      assertColumnName(col);
    }
    const columns: Record<string, ColumnDef> = {};
    for (const [col, shorthand] of Object.entries(def.columns)) {
      if (typeof shorthand === "string") {
        const nullable = shorthand.endsWith("?");
        const type = (nullable ? shorthand.slice(0, -1) : shorthand) as ColumnType;
        columns[col] = { type, nullable };
      } else {
        columns[col] = shorthand;
      }
      const made = columns[col]!;
      if (isServerTime(made) && made.type !== "timestamptz") {
        throw new Error(`${key}: ${col}'s default "now" is the time a row is written, which only a timestamptz column takes (${col} is ${made.type})`);
      }
    }

    let parent: ResolvedTable["parent"];
    if (def.parent) {
      if (typeof def.parent === "string") {
        parent = { collection: def.parent, fkColumn: `${def.parent}_id` };
      } else {
        parent = { collection: def.parent.collection, fkColumn: def.parent.fk };
      }
    }

    const name = def.table ?? key;
    const unique = (def.unique ?? []).map((u) => resolveUnique(key, name, u, columns, parent?.fkColumn));
    const seen = new Set<string>();
    for (const u of unique) {
      if (seen.has(u.name)) throw new Error(`${key}: unique ${JSON.stringify(u.columns)} is named twice`);
      seen.add(u.name);
    }

    tables[key] = {
      name,
      docKey: key,
      columns,
      parent,
      temporal: def.temporal !== false,
      children: [],
      referencedBy: [],
      ...(unique.length ? { unique } : {}),
    };
  }

  // Second pass: compute children and referencedBy across the resolved table set.
  for (const [key, table] of Object.entries(tables)) {
    if (table.parent) {
      const parentTable = tables[table.parent.collection];
      if (parentTable) parentTable.children.push(key);
    }
    for (const cascade of defs[key]?.cascadeOn ?? []) {
      let fkCol: string;
      let targetKey: string | undefined;
      if (typeof cascade === "string") {
        fkCol = cascade;
        const stem = fkCol.replace(/_id$/, "");
        targetKey = Object.keys(tables).find(
          (k) => k === stem || k === stem + "s"
              || tables[k]!.name === stem || tables[k]!.name === stem + "s",
        );
      } else {
        fkCol = cascade.fk;
        targetKey = cascade.collection;
      }
      const target = targetKey ? tables[targetKey] : undefined;
      if (target) {
        target.referencedBy.push({ collection: key, fkColumn: fkCol });
      }
    }
  }

  // Third pass: the columns that name a row of another collection, checked against the tables.
  for (const [key, table] of Object.entries(tables)) {
    const given = Object.entries(defs[key]?.refs ?? {}).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    if (!given.length) continue;
    const cascades = new Set((defs[key]?.cascadeOn ?? []).map((c) => (typeof c === "string" ? c : c.fk)));
    table.refs = given.map(([column, collection]) => {
      const col = Object.hasOwn(table.columns, column) ? table.columns[column]! : undefined;
      if (!col) throw new Error(`${key}: refs names ${column}, which is not one of its columns`);
      if (col.type !== "integer") throw new Error(`${key}: refs' ${column} names a row by its id, which an integer column holds (${column} is ${col.type})`);
      if (!tables[collection]) throw new Error(`${key}: refs' ${column} names ${collection}, which the schema has no collection of`);
      if (cascades.has(column)) throw new Error(`${key}: ${column} is in refs and cascadeOn: a row it names is either kept while named (refs) or takes this row with it (cascadeOn), not both`);
      return { column, collection };
    });
  }
  for (const [key, table] of Object.entries(tables).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    for (const ref of table.refs ?? []) (tables[ref.collection]!.namedBy ??= []).push({ collection: key, column: ref.column });
  }

  return { tables };
}

/** A unique constraint as given (`"email"`, `["library_id", "name"]`, `{ columns, whereNull }`), the same shape every time. */
export function uniqueOf(u: string | string[] | UniqueDef): UniqueDef {
  if (typeof u === "string") return { columns: [u] };
  if (Array.isArray(u)) return { columns: [...u] };
  return { columns: [...u.columns], ...(u.whereNull?.length ? { whereNull: [...u.whereNull] } : {}) };
}

/** Checked against the table's columns (its own and its parent key), and named. */
function resolveUnique(key: string, table: string, given: string | string[] | UniqueDef, columns: Record<string, ColumnDef>, fk: string | undefined): ResolvedUnique {
  const u = uniqueOf(given);
  if (u.columns.length === 0) throw new Error(`${key}: a unique constraint names at least one column`);
  for (const col of [...u.columns, ...(u.whereNull ?? [])]) {
    if (!Object.hasOwn(columns, col) && col !== fk) throw new Error(`${key}: unique names ${col}, which is not one of its columns`);
  }
  for (const col of u.whereNull ?? []) {
    if (Object.hasOwn(columns, col) && !columns[col]!.nullable) throw new Error(`${key}: unique's whereNull names ${col}, which is never null`);
  }
  return { name: `idx_${table}_unique_${u.columns.join("_")}`, columns: u.columns, whereNull: u.whereNull ?? [] };
}

/**
 * A unique constraint's index, as SQLite and Postgres both take it: among a temporal table's current
 * versions alone, so a closed version (one replaced, one removed) holds nothing.
 */
export function uniqueIndexSql(table: ResolvedTable, u: ResolvedUnique): string {
  const where = [...u.whereNull.map((c) => `${q(c)} IS NULL`), ...(table.temporal ? ["valid_to IS NULL"] : [])];
  return `CREATE UNIQUE INDEX IF NOT EXISTS ${q(u.name)} ON ${q(table.name)} (${u.columns.map(q).join(", ")})${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`;
}

/** The value a column that is neither nullable nor defaulted takes when a row leaves it out. */
export function defaultForType(type: ColumnType): unknown {
  switch (type) {
    case "text": return "";
    case "integer": return 0;
    case "real": return 0;
    case "boolean": return false;
    case "json": return null;
    case "timestamptz": return null;   // no sensible default — must be supplied
  }
}

// ---------------------------------------------------------------------------
// defineDoc — a document lens into the schema. Prefix + root + includes + scope.
// ---------------------------------------------------------------------------

export function defineDoc(
  prefix: string,
  opts: { root: string; include: string[]; scope?: Record<string, string>; implied?: boolean; columns?: Record<string, string[]>; owns?: string; accept?: Accept; shape?: Shape },
): DocDef {
  if (!DOC_PREFIX.test(prefix)) {
    throw new Error(
      `Invalid doc prefix: ${JSON.stringify(prefix)} — must match ${DOC_PREFIX}`,
    );
  }
  assertIdentifier(opts.root, "doc root");
  // default-deny for writing, as for opening: a document anyone may open says who may write it
  if (isAnyone(opts) && !opts.accept) throw new Error(`doc "${prefix}": owns ANYONE opens it to anyone, signed in or not: say who may write it (accept), or that nobody may (accept: () => false)`);
  if (opts.implied && opts.scope && Object.keys(opts.scope).length > 0) {
    throw new Error(`An implied doc is keyed by its root id: ${prefix} cannot also declare a scope`);
  }
  for (const [coll, cols] of Object.entries(opts.columns ?? {})) {
    if (coll !== opts.root && !opts.include.includes(coll)) throw new Error(`doc "${prefix}" names columns of ${coll}, which it does not hold: name the root or an include`);
    for (const col of cols) assertColumnName(col);
  }
  return {
    prefix,
    root: opts.root,
    include: opts.include,
    scope: opts.scope ?? {},
    ...(opts.implied ? { implied: true } : {}),
    ...(opts.columns && Object.keys(opts.columns).length ? { columns: opts.columns } : {}),
    ...(opts.owns !== undefined ? { owns: ownsPath(prefix, opts.owns) } : {}),
    ...(opts.accept ? { accept: opts.accept } : {}),
    ...(opts.shape ? { shape: opts.shape } : {}),
  };
}

/** A path that reads, or a throw naming the document: checked against the schema at registration. */
function ownsPath(prefix: string, path: string): string {
  try {
    parsePath(path);
  } catch (err: any) {
    throw new Error(`doc "${prefix}": ${err.message}`);
  }
  return path;
}

/**
 * Does a row of `coll` hang from a row of `root`: does its chain of parents, walked up the
 * schema, reach `root`? A list document holds such a collection's rows only under the root rows
 * its scope admits; one that does not (no parent, or a chain that ends short of the root) whole.
 */
export function hangsFrom(schema: Schema, coll: string, root: string): boolean {
  let table = schema.tables[coll];
  for (let depth = 0; depth < 32 && table?.parent; depth++) {
    if (table.parent.collection === root) return true;
    table = schema.tables[table.parent.collection];
  }
  return false;
}

/** Does a document hold `field` of a row of `coll`? Its id and parent key always; else, where it names that collection's columns, those. */
export function holdsField(def: DocDef, schema: Schema, coll: string, field: string): boolean {
  const table = schema.tables[coll];
  if (field === "id" || field === table?.parent?.fkColumn) return true;
  // the schema is the contract: a column it does not declare (a later version's) is no document's
  if (table && !Object.hasOwn(table.columns, field)) return false;
  const cols = def.columns?.[coll];
  return !cols || cols.includes(field);
}

/** A row of `coll` as a document shows it: the fields it holds (`holdsField`) -- never a column the schema does not declare. */
export function showRow(def: DocDef, schema: Schema, coll: string, row: any): any {
  if (row === null || typeof row !== "object" || Array.isArray(row)) return row;
  const keys = Object.keys(row);
  if (keys.every((f) => holdsField(def, schema, coll, f))) return row;
  return Object.fromEntries(keys.filter((f) => holdsField(def, schema, coll, f)).map((f) => [f, row[f]]));
}

/**
 * Ops as a document shows them -- what its writer is answered (a write's ops
 * and inverse, a walk's, its history): of the collections it holds alone (a
 * removal's cascade into one it does not include is left out); a row's value,
 * its columns (`showRow`); a field it does not hold, no op. The ledger keeps
 * them whole, so undo still puts back every row and column.
 */
export function showOps<O extends { path: string; value?: unknown }>(def: DocDef, schema: Schema, ops: O[]): O[] {
  return ops.flatMap((op) => {
    const [coll, at, field] = splitPath(op.path);
    if (coll !== def.root && !def.include.includes(coll!)) return [];
    const table = schema.tables[coll!];
    // a field: /<coll>/<id>/<field>, or a single document's root's, /<root>/<field>
    const named = field ?? (at !== undefined && table && (Object.hasOwn(table.columns, at) || at === table.parent?.fkColumn) ? at : undefined);
    if (named !== undefined) return holdsField(def, schema, coll!, named) ? [op] : [];
    return "value" in op ? [{ ...op, value: showRow(def, schema, coll!, op.value) }] : [op];
  });
}

/** A document as it shows: each row the columns it holds, of those the schema declares (`showRow`). `single`: its root is one row, not a map. */
export function showDoc(def: DocDef, schema: Schema, doc: any, single: boolean): any {
  if (doc == null) return doc;
  const out = { ...doc };
  for (const coll of [def.root, ...def.include]) {
    const held = out[coll];
    if (held == null) continue;
    if (single && coll === def.root) { out[coll] = showRow(def, schema, coll, held); continue; }
    const rows = Object.entries(held);
    if (rows.every(([, row]) => showRow(def, schema, coll, row) === row)) continue;   // nothing to leave out: the map as it is
    out[coll] = Object.fromEntries(rows.map(([id, row]) => [id, showRow(def, schema, coll, row)]));
  }
  return out;
}

// ---------------------------------------------------------------------------
// ValidationError — shared by both backends' `validateOps` helpers.
// ---------------------------------------------------------------------------

export interface ValidationError {
  path: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Snapshot — an app's rows, as they carry from one backend to the next.
// ---------------------------------------------------------------------------

/**
 * Every row an app holds, by collection key, and the last id each collection
 * has minted: what `exportTables` gives and `importTables` takes, on every
 * backend, so the same data moves from a JSON file to SQLite to Postgres in
 * process to a Postgres server with its ids and sequences unchanged. A row has
 * its id (a number), its parent key and its columns; a temporal table's rows
 * are every version, each with `valid_from` and `valid_to` (ISO-8601, null
 * while current), so its history carries too. A missing sequence is the
 * largest id among the collection's rows.
 */
export interface Snapshot {
  tables: Record<string, Record<string, unknown>[]>;
  sequences?: Record<string, number>;
}

/** The last id a collection has minted, as a snapshot says or its rows imply. */
export function lastId(snapshot: Snapshot, key: string): number {
  const said = snapshot.sequences?.[key];
  const most = Math.max(0, ...(snapshot.tables[key] ?? []).map((r) => Number(r.id)).filter(Number.isFinite));
  return Math.max(said ?? 0, most);
}

/**
 * A time a write may give a timestamptz column: ISO-8601, a date or a date and
 * time (to the microsecond), with a zone or without (UTC), on the calendar --
 * and only what Postgres's timestamptz holds, so every backend keeps the same
 * times: a zone up to ±15:59, a year from 0001 (there is no year 0).
 * `_delta_assert_fields` (001a) asks the same of a value on Postgres.
 */
const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?(?:Z|[+-](?:0\d|1[0-5])(?::?[0-5]\d)?)?)?$/;
export function isIsoTime(value: unknown): boolean {
  const m = typeof value === "string" ? ISO.exec(value) : null;
  if (!m || Number(m[1]) < 1) return false;
  const day = new Date(0);
  day.setUTCFullYear(Number(m[1]), Number(m[2]) - 1, Number(m[3]));   // the year as written: Date.UTC reads 0-99 as 1900-1999
  return day.getUTCMonth() === Number(m[2]) - 1 && day.getUTCDate() === Number(m[3]);
}

/**
 * A time as a Postgres document reads a timestamptz in UTC: "2021-01-01T08:00:00+00:00",
 * milliseconds where there are any. A time with no zone is UTC; text that is no time stays as it is.
 */
export function utcTime(value: unknown): unknown {
  if (!(value instanceof Date) && (typeof value !== "string" || !isIsoTime(value))) return value;
  const t = typeof value === "string" ? value.replace(" ", "T") : "";
  const d = value instanceof Date ? value : new Date(/T/.test(t) ? (/(Z|[+-]\d{2}(:?\d{2})?)$/.test(t.slice(10)) ? t : `${t}Z`) : `${t}T00:00:00Z`);
  return d.toISOString().replace(/\.000Z$/, "+00:00").replace(/(\.\d*?)0*Z$/, "$1+00:00");
}

/** A timestamp as a snapshot carries it: ISO-8601 in UTC, or null. */
export function isoTime(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  // SQLite keeps "YYYY-MM-DD HH:MM:SS[.sss]" in UTC; Postgres and ISO strings parse as they are.
  const d = new Date(/^\d{4}-\d{2}-\d{2} \d/.test(text) && !/[zZ+]/.test(text.slice(10)) ? `${text.replace(" ", "T")}Z` : text);
  return Number.isNaN(d.getTime()) ? text : d.toISOString();
}
