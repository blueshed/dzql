/**
 * Delta Postgres — schema wrappers + Postgres-specific utilities.
 *
 * The shared schema vocabulary (ColumnDef, TableDef, Schema, ResolvedTable,
 * DocDef, defineSchema, defineDoc) lives in delta (`@blueshed/delta/backend`) and is identical
 * across the Postgres and SQLite backends. This module re-exports those
 * types and adds the Postgres helpers that hit the live database
 * (ops-log pruning, op validation).
 */
import type { Pool } from "pg";
import { type DeltaOp, joinPath, splitPath } from "@blueshed/delta/core";
import {
  holdsField,
  type Schema,
  type DocDef,
  type ValidationError,
  isIsoTime,
} from "@blueshed/delta/backend";
import { pastSafeId, resolveScope } from "@blueshed/delta/backend";

export type {
  ColumnType,
  ColumnDef,
  ColumnShorthand,
  TableDef,
  Schema,
  ResolvedTable,
  DocDef,
  ValidationError,
} from "@blueshed/delta/backend";
export { defineSchema, defineDoc } from "@blueshed/delta/backend";

// ---------------------------------------------------------------------------
// Postgres-specific doc helpers — all thin wrappers over stored functions.
// ---------------------------------------------------------------------------

export async function pruneOpsLog(pool: Pool, keepInterval = "1 hour"): Promise<number> {
  const { rows } = await pool.query("SELECT delta_prune_ops($1::interval) AS count", [keepInterval]);
  return Number(rows[0]?.count ?? 0);
}

// ---------------------------------------------------------------------------
// validateOps — what delta_apply refuses as a mistake (400), said ahead.
// ---------------------------------------------------------------------------

/**
 * Validate delta ops against the schema, as `delta_apply` (001d) reads them,
 * before they reach the database: it refuses each write this does (a 400), and
 * takes each this takes -- but for what only the rows can say (a row not there,
 * 404; already there, 409) and a value of its type its column cannot hold (a
 * timestamp that is no date), which are the database's. Returns an array of errors (empty = valid).
 *
 * `doc`: the document's name, which says its mode and its scope's values, as
 * `delta_apply` reads them (`_delta_resolve_scope`; `resolveScope` is its
 * twin) -- the definition alone cannot: `all-courses:` is every course, and
 * `all-courses:1` course 1. Or say them: `list`, the document is in
 * list mode; `values`, its scope's equality bindings, which a list-mode add of
 * a root row is given, so they count as given -- the options SQLite's
 * validateOps takes, and they win over the name's. Given neither, the mode is
 * not known, and each shape is taken as the mode that has it takes it:
 * `replace /<root>` and `replace /<root>/<field>` as a single document's root
 * row, `add /<root>/-` as a list's new row.
 */
export function validateOps(schema: Schema, def: DocDef, ops: DeltaOp[], opts: { doc?: string; list?: boolean; values?: Record<string, string> } = {}): ValidationError[] {
  let rootId: string | undefined;   // a single document's own root, where its name says it
  const docName = opts.doc;
  if (opts.doc !== undefined) {
    if (!opts.doc.startsWith(def.prefix)) throw new Error(`validateOps: ${opts.doc} is not a document of ${def.prefix}`);
    const scope = resolveScope(def, opts.doc.slice(def.prefix.length));
    opts = { list: opts.list ?? scope.mode === "list", values: opts.values ?? scope.values };
    rootId = scope.id;
  }
  const errors: ValidationError[] = [];
  for (const op of ops) {
    const fail = (message: string, path = op.path) => errors.push({ path: String(path), message });
    let parts: string[];
    try { parts = splitPath(op.path); }
    catch (err: any) { fail(err.message); continue; }
    const collKey = parts[0];
    if (!collKey) { fail("Empty path"); continue; }
    if (collKey !== def.root && !def.include.includes(collKey)) { fail(`Unknown collection: ${collKey}`); continue; }
    const table = schema.tables[collKey];
    if (!table) { fail(`No table for collection: ${collKey}`); continue; }

    const fk = table.parent?.fkColumn;
    const value = (op as any).value;
    const isObject = value !== null && typeof value === "object" && !Array.isArray(value);
    // A value's keys (_delta_assert_fields): its columns the document holds, the row's id (the path's wins) and parent key, a temporal row's validity.
    const held = (k: string) => holdsField(def, schema, collKey, k);
    const known = (k: string) => (Object.hasOwn(table.columns, k) && held(k)) || k === "id" || k === fk || k === "valid_from" || k === "valid_to";
    // What a written field may hold, beyond its column's cast: a column that is
    // not nullable is never null (the table's NOT NULL); a parent key is an id.
    const fieldErr = (field: string, v: unknown): string | null => {
      if (field === fk) {
        if (v === null || v === undefined) return `${field} cannot be null`;
        return typeof v === "string" || Number.isInteger(v) ? null : `${field} must be an id: an integer, or text`;   // delta's words, as delta_apply says them
      }
      const col = Object.hasOwn(table.columns, field) ? table.columns[field]! : undefined;
      if (!col || v === null || v === undefined) return col && !col.nullable && v === null ? `${field} cannot be null` : null;
      // a value of its column's type, not cast (_delta_assert_fields)
      const of: Record<string, [boolean, string]> = {
        text: [typeof v === "string", "a string"], integer: [Number.isInteger(v), "an integer"], real: [typeof v === "number", "a number"],
        boolean: [typeof v === "boolean", "a boolean"], timestamptz: [isIsoTime(v) || v instanceof Date, "an ISO-8601 time"],   // what timestamptz holds: a zone to ±15:59, a year from 0001
      };
      const [ok, what] = of[col.type] ?? [true, ""];
      return ok ? null : `${field} must be ${what}`;
    };
    // A whole-row value: an object of known keys, each field as it may be written (a whole row's
    // after the field's path, `whole`). Every refusal of it, as delta_apply says them: the fields
    // there are not, then the values, then (`required`) what it leaves out, each kind by name.
    const rowErrs = (row: Record<string, unknown>, verb: "add" | "replace", whole = true) => {
      const fields = Object.keys(row).sort();
      for (const k of fields) if (!known(k)) fail(`Unknown field: ${k}`);
      for (const k of fields) {
        const v = row[k];
        const err = verb === "add" && k === fk && v == null ? null : fieldErr(k, v);   // an add's parent key, left null, is its document's, or found in scope
        if (err) fail(err, whole ? `${op.path}/${k}` : op.path);
      }
    };
    // A row's value, added or replaced whole (RFC 6902: a replace of the row is the row): a column
    // that is neither nullable nor has a default must be given -- by the value, or, for a list-mode
    // root row's add, by the scope, as delta_apply checks (#39, #3).
    const required = (row: Record<string, unknown>, given: Record<string, unknown> = {}, add = false) => {   // a replace sets the columns it holds
      for (const col of Object.keys(table.columns).sort()) {
        const colDef = table.columns[col]!;
        if (!colDef.nullable && colDef.default === undefined && !Object.hasOwn(row, col) && !Object.hasOwn(given, col) && (add || held(col))) {
          fail(`Required field missing: ${col} (give it a value, or declare a default or make it nullable in the schema)`);
        }
      }
    };
    // A parent key given as text that is no whole number names no row: told once the value is
    // otherwise as it may be written, the sentence alone (_delta_parent_id, as delta's SQLite says it).
    const noRow = (row: Record<string, unknown>) => {
      const v = fk === undefined ? undefined : row[fk];
      if (typeof v === "string" && !/^\s*[+-]?\d+\s*$/.test(v)) fail(`${table.parent!.collection} "${v}" names no row: an id is a whole number`);
    };
    // A row's id, as the path names it: the number its digits name, up to 2^53 - 1 (_delta_row_id).
    const idErr = (seg: string): string | null =>
      !/^[0-9]+$/.test(seg) ? `Row id "${seg}" is not a number: Postgres mints row ids -- add to ${joinPath(collKey, "-")} and read the id from the echo`
      : pastSafeId(seg) ? `Row id ${seg} is past 2^53 - 1, which no number holds exactly -- add to ${joinPath(collKey, "-")} and read the id from the echo`
      : null;

    // `/<coll>` is a single document's root row, replaced whole, and nothing else (as delta_apply,
    // in delta's words): given no mode, the root's is taken as a single document's
    if (parts.length === 1 && (opts.list || collKey !== def.root)) { fail(`Whole-collection ops are not supported: ${op.op} ${op.path}`); continue; }
    if (parts.length === 1 && op.op !== "replace") { fail("Root supports replace only"); continue; }

    // A single document's root: `replace /<root>` is the root row, whole, and
    // `replace /<root>/<field>` (a segment that is not an id) writes one field
    // -- a column, or the parent key: the row moves (#37).
    if (collKey === def.root && !opts.list && op.op === "replace" && (parts.length === 1 || (parts.length === 2 && !/^\d+$/.test(parts[1]!)))) {
      const before = errors.length;
      if (parts[1] === "id") fail("Unknown field: id");   // a row keeps the id its path names
      else if (parts.length === 2) rowErrs({ [parts[1]!]: value }, "replace", false);
      else if (!isObject) fail("Replace value must be an object");
      else { rowErrs(value, "replace"); required(value); }
      if (errors.length === before) noRow(parts.length === 2 ? { [parts[1]!]: value } : value);
      continue;
    }

    // A row: add /<coll>/<id or ->, remove /<coll>/<id>, replace /<coll>/<id>[/<field>].
    const rowOp = (op.op === "add" || op.op === "remove") ? parts.length === 2 : op.op === "replace" && (parts.length === 2 || parts.length === 3);
    if (!rowOp) { fail(`Invalid op: ${op.op} ${op.path}`); continue; }
    // An add, as delta_apply asks it: its id past 2^53 - 1, then its value, every refusal of it;
    // then a single document holds one root row, the one its name names: it adds no other (#52) --
    // when the mode is known; given none, a root row's add is a list's, and is taken. Its own
    // it may add back, by an undo of its removal (#43): the database says whether it is gone.
    // Then an id that is no number: Postgres mints them.
    if (op.op === "add") {
      const seg = parts[1]!;
      const digits = /^[0-9]+$/.test(seg);
      if (digits && pastSafeId(seg)) { fail(idErr(seg)!); continue; }
      if (!isObject) { fail("Add value must be an object"); continue; }
      const before = errors.length;
      rowErrs(value, "add");
      required(value, opts.list && collKey === def.root ? opts.values : {}, true);
      if (errors.length > before) continue;
      const own = rootId !== undefined && /^[0-9]+$/.test(rootId) ? BigInt(rootId).toString() : rootId;   // as delta_apply prints it
      const other = !digits || (own !== undefined && BigInt(seg).toString() !== own);
      if (collKey === def.root && opts.list === false && other) {
        const id = own ?? "<id>";
        fail(`${docName ?? `${def.prefix}<id>`} holds ${collKey} ${id} alone: add another ${collKey} row through a document that lists them`);
        continue;
      }
      if (seg !== "-" && !digits) { fail(idErr(seg)!); continue; }
      // a single document's own child is given its root's id, and a list's root row its scope's, whatever the value says
      const given = opts.list === false ? table.parent?.collection === def.root && collKey !== def.root : !!opts.list && collKey === def.root && fk !== undefined && opts.values?.[fk] !== undefined;
      if (!given) noRow(value);
      continue;
    }
    const idError = idErr(parts[1]!);
    if (idError) { fail(idError); continue; }
    if (op.op === "remove") continue;
    if (parts.length === 3) {
      const field = parts[2]!;
      if (!known(field) || field === "id") { fail(`Unknown field: ${field}`); continue; }   // a row keeps the id its path names
      const err = fieldErr(field, value);
      if (err) fail(err);
      else noRow({ [field]: value });
      continue;
    }
    if (!isObject) { fail("Replace value must be an object"); continue; }
    const before = errors.length;
    rowErrs(value, "replace");
    required(value);
    if (errors.length === before) noRow(value);
  }
  return errors;
}
