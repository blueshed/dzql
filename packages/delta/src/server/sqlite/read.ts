/** A document read from the tables: as they stand (open) or as they stood (open_at). */
import { defaultForType, q, type DocDef, type ResolvedTable, type Schema } from "../../schema";
import { toMap } from "../custom";
import { resolveScope, rowId, whereOf, type Scope } from "../scope";
import { keeping } from "./keep";
import { columnsOf, current, decodeRow, sqliteTime } from "./rows";

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
  for (const [col, colDef] of Object.entries(schema.tables[def.root]!.columns)) root[col] = colDef.default ?? (colDef.nullable ? null : defaultForType(colDef.type));
  return { [def.root]: root, ...Object.fromEntries(def.include.map((coll) => [coll, {}])) };
}

/**
 * A document as its scope reads it from the tables -- as they stand, or as they
 * stood at `at` (SQLite's own time form; by default, the time in its name, `at:`): single mode, one root row and its
 * children; list mode, every root row the scope admits and each included
 * collection in full.
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
  for (const collKey of def.include) {
    const table = schema.tables[collKey];
    if (table) doc[collKey] = toMap(list ? readRows(db, table, "1 = 1", [], at) : readCollection(db, schema, table, def, rows[0].id, at));
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

/** A single document's rows of `table`, under its root row `rootId`, walking up the parent keys to it. */
function readCollection(db: any, schema: Schema, table: ResolvedTable, def: DocDef, rootId: unknown, at?: string): any[] {
  // No parent: no key ties a row of it to one document. Included, it is
  // loaded in full: every document of the
  // prefix holds every row, and the fan-out (holds) says the same.
  if (!table.parent) return readRows(db, table, "1 = 1", [], at);
  const fk = q(table.parent.fkColumn);
  if (table.parent.collection === def.root) return readRows(db, table, `${fk} = ?`, [rootId], at);
  // Grandchild: its parent rows first, then the rows under them. A parent the
  // document need not include: its rows are walked all the same. One with no
  // parent of its own ends the chain short of the root, so nothing under it is
  // in the document, as the fan-out's chainRoot judges it.
  const parentTable = schema.tables[table.parent.collection];
  if (!parentTable?.parent) return [];
  const ids = readCollection(db, schema, parentTable, def, rootId, at).map((r: any) => r.id);
  return ids.length ? readRows(db, table, `${fk} IN (${ids.map(() => "?").join(", ")})`, ids, at) : [];
}
