/** A document read from the tables: as they stand (open) or as they stood (open_at). */
import { hangsFrom, q, type DocDef, type ResolvedTable, type Schema } from "../../schema";
import { toMap } from "../custom";
import { resolveScope, rowId, whereOf, type Scope } from "../scope";
import { keeping } from "./keep";
import { columnsOf, current, decodeRow, leftOut, sqliteTime } from "./rows";

/**
 * Load a doc as it existed at a specific point in time (`at`: ISO-8601, or SQLite's own form). An
 * implied document whose root row was not made by then is read as `open` reads one not made yet:
 * its id and its columns' defaults, each included collection empty.
 */
export function loadDocAt(db: any, schema: Schema, def: DocDef, docId: string, at: string): any | null {
  const scope = resolveScope(def, docId);
  return readDoc(db, schema, def, scope, sqliteTime(at)) ?? (def.implied && scope.mode === "single" ? impliedDoc(schema, def, docId) : null);
}

/** An implied document before its root row is made: the row its first write would make, by its id and its columns' defaults, each included collection empty. */
export function impliedDoc(schema: Schema, def: DocDef, docId: string): any {
  const root: any = { id: rowId(docId) };
  for (const [col, colDef] of Object.entries(schema.tables[def.root]!.columns)) root[col] = leftOut(colDef);
  return { [def.root]: root, ...Object.fromEntries(def.include.map((coll) => [coll, {}])) };
}

/**
 * A document as its scope reads it from the tables -- as they stand, or as they
 * stood at `at` (SQLite's own time form; by default, the time in its name, `at:`): single mode, one root row and its
 * children; list mode, every root row the scope admits and the rows that hang
 * under those (a collection that hangs from no root row -- no parent, or a
 * chain that ends short of the root -- in full).
 */
export function readDoc(db: any, schema: Schema, def: DocDef, scope: Scope, at = scope.at === undefined ? undefined : sqliteTime(scope.at)): any | null {
  const rootTable = schema.tables[def.root];
  if (!rootTable) return null;
  const where = whereOf(scope, keeping(db, rootTable));
  const rows = readRows(db, rootTable, where.sql, where.params as any[], at);
  const list = scope.mode === "list";
  if (!list && rows.length === 0) return null;
  if (!list && rows.length > 1) {
    // A single-mode doc exposes exactly one root row. A scope that matches
    // several (e.g. a non-unique column) silently drops all but the first
    // here AND only loads the first row's children — surface it.
    console.warn(
      `[delta-sqlite] scope for doc root "${def.root}" matched ${rows.length} rows; using the first only. A single-mode doc's scope must match at most one row.`,
    );
  }
  const doc: any = { [def.root]: list ? toMap(rows) : rows[0] };
  const rootIds = list ? rows.map((r: any) => r.id) : [rows[0].id];
  for (const collKey of def.include) {
    const table = schema.tables[collKey];
    if (!table) continue;
    // a list with no condition admits every root row: what hangs under them is all there is; one that hangs from no root row is whole
    const whole = list && (scope.conds.length === 0 || !hangsFrom(schema, collKey, def.root));
    doc[collKey] = toMap(whole ? readRows(db, table, "1 = 1", [], at) : readCollection(db, schema, table, def, rootIds, at));
  }
  return doc;
}

/** A table's rows `where` says, as a document holds them: as they stand, or the versions live at `at`. */
function readRows(db: any, table: ResolvedTable, where: string, params: any[], at?: string): any[] {
  const rows = table.temporal && at !== undefined
    ? db.query(`SELECT ${columnsOf(table)} FROM ${q(table.name)} WHERE ${where} AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)`).all(...params, at, at)
    : db.query(`SELECT ${columnsOf(table)} FROM ${current(table)} WHERE ${where}`).all(...params);
  for (const row of rows) decodeRow(table, row);
  return rows;
}

/** A document's rows of `table`, under its root rows `rootIds` (a single document's one; a list's, those its scope admits), walking up the parent keys to them. */
function readCollection(db: any, schema: Schema, table: ResolvedTable, def: DocDef, rootIds: unknown[], at?: string): any[] {
  // No parent: no key ties a row of it to one document. Included, it is
  // loaded in full: every document of the
  // prefix holds every row, and the fan-out (holds) says the same.
  if (!table.parent) return readRows(db, table, "1 = 1", [], at);
  const fk = q(table.parent.fkColumn);
  // the ids as one JSON parameter: a list may admit more roots than SQLite takes parameters
  if (table.parent.collection === def.root) return rootIds.length ? readRows(db, table, `${fk} IN (SELECT value FROM json_each(?))`, [JSON.stringify(rootIds)], at) : [];
  // Grandchild: its parent rows first, then the rows under them. A parent the
  // document need not include: its rows are walked all the same. One with no
  // parent of its own ends the chain short of the root, so nothing under it is
  // in the document, as the fan-out's chainRoot judges it.
  const parentTable = schema.tables[table.parent.collection];
  if (!parentTable?.parent) return [];
  const ids = readCollection(db, schema, parentTable, def, rootIds, at).map((r: any) => r.id);
  return ids.length ? readRows(db, table, `${fk} IN (SELECT value FROM json_each(?))`, [JSON.stringify(ids)], at) : [];
}
