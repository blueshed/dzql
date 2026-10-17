/**
 * The SQLite write path of one `registerDocs` registration: a write -- fresh,
 * an undo, a redo -- applied op by op as one transaction (`applyWrite`: you
 * may write what you may read), recorded on the ledger with its inverse
 * (`inverseOf`), and then told to every document that held or holds a row it
 * changed, on every registration over the database (`tell`, `announce`).
 * `registerDocs` (`../sqlite.ts`) wires the handlers; what it shares with this
 * is one `Registration`. @internal
 */
import type { WsServer } from "../server";
import type { DeltaAuth } from "../auth";
import type { RegisterOptions } from "../sqlite";
import { failure } from "../server";
import { createCustomDocs, isPromise } from "../custom";
import { type DeltaOp, splitPath, joinPath, changedFields } from "../../core";
import { createLogger } from "../logger";
import { rowAt, type Ledger } from "../ledger";
import { meets, resolveScope, rowId, sameId, type Scope } from "../scope";
import { holdsField, q, showRow, type DocDef, type ResolvedTable, type Schema } from "../../schema";
import { keeping, scopeValue } from "./keep";
import { readDoc } from "./read";
import { carryUndeclared, closeRow, columnsOf, undeclaredColumns, undeclaredOf, current, decodeRow, insertCollectionRow, insertRow, leftOut, named, now, refuse, sqliteTime, updateRow } from "./rows";
import { namesRootRow, validateOps } from "./validate";

const log = createLogger("[delta-sqlite]");

/**
 * One registration's open documents, as a write through any registration on
 * its database handle tells them: every document open on the
 * database hears a write, whichever registration it was opened through.
 */
export type Fanout = {
  /** The documents open here (and `writer`, the one written through) that hold `row` of `coll`. */
  holders(coll: string, row: any, writer?: string): string[];
  /** Of those, the implied single documents: they showed a root before its row was made. */
  showing(coll: string, row: any, writer?: string): string[];
  /** Tell the documents open here what a write through another registration changed. */
  announce(touched: Touched[], applied: DeltaOp[]): void;
};

/** The registrations over each database handle: a JSON file's registrations on a server share one. */
const fanoutsOn = new WeakMap<object, Set<Fanout>>();

/**
 * A row of a write, for the telling: who held it before -- on each registration
 * over the database -- and what it is now (null: gone); a replace's, what it was
 * (`was`), so a document that holds it either way is told only the fields that
 * changed. A `carried` row is one the write did not change but moved, under a
 * parent it moved: it is told only where it arrives or leaves.
 */
export type Touched = { coll: string; id: string | number; before: Map<Fanout, string[]>; after: any | null; was?: any; carried?: boolean };

/** A document a write is through, by the definition it belongs to and the id its name gives. */
export type Found = { def: DocDef; docId: string };

/**
 * What one `registerDocs` shares with its write path and its walks: what it was
 * given, what it keeps (each document's copy, the implied documents still
 * empty, who has each open), and how it finds, loads and guards a document.
 */
export interface Registration<I> {
  ws: WsServer;
  db: any;
  schema: Schema;
  options: RegisterOptions<I>;
  auth: DeltaAuth<I> | undefined;
  ledger: Ledger | undefined;
  custom: ReturnType<typeof createCustomDocs<I, any>>;
  /** Each open document's copy, by name: what undo and the inverse read. */
  cache: Map<string, any>;
  /** Open implied documents whose root row has not been written yet. */
  implied: Set<string>;
  /** Who has each of these documents open, by name (for scoped fan-out). */
  subscriptions: Map<string, Set<any>>;
  /** The definition a name belongs to: the longest prefix it starts with. */
  findDoc(docName: string): Found | null;
  /** A document from the cache, or loaded into it. */
  load(docName: string, def: DocDef, docId: string): any | null;
  emptyDoc(def: DocDef, docId: string): any;
  rootless(def: DocDef, docId: string): any;
  /** Another connection committed since: every copy dropped. */
  heardElsewhere(): boolean;
  reloadEvicted(): void;
  keepsReach(def: DocDef, docName: string, identity: I): boolean;
  ownsOf(docName: string): ((identity: I, docName: string) => boolean | Promise<boolean>) | undefined;
  unheld(docName: string): void;
  gated(client: any): { identity: I } | { error: { code: number; message: string } };
  whoOf(client: any): string | null;
  cursorOf(msg: any, client: any): string | null;
  identityOf(client: any): I | undefined;
  whenOwned(ok: boolean | Promise<boolean>, respond: (r: any) => void, go: () => void): void | Promise<void>;
  guarded(handler: (msg: any, client: any, respond: (r: any) => void) => any, opts?: { owned?: boolean; gatesCustom?: boolean }): (msg: any, client: any, respond: (r: any) => void) => any;
  underLock(handler: (msg: any, client: any, respond: (r: any) => void) => void): (msg: any, client: any, respond: (r: any) => void) => void;
}

export type Written = { ops: DeltaOp[]; inverse: DeltaOp[]; version?: number; entry?: number };
export type Failed = { error: { code: number; message: string } };

/**
 * The write path of `r`, registered among those over its database: a write
 * through any registration is told to the documents open on each.
 */
export function createWriter<I>(r: Registration<I>) {
  const { ws, db, schema, options, auth, ledger, custom, cache, implied, subscriptions } = r;
  const { findDoc, load, emptyDoc, rootless, heardElsewhere, reloadEvicted, keepsReach, ownsOf, unheld } = r;

  const me: Fanout = { holders, showing, announce };
  const fanouts = fanoutsOn.get(db) ?? new Set<Fanout>();
  fanoutsOn.set(db, fanouts);
  fanouts.add(me);
  /** Who holds `row` of `coll` on each registration over the database: the documents open there, and here `writer`. */
  const heldBy = (coll: string, row: any, writer: string): Touched["before"] =>
    new Map([...fanouts].map((f) => [f, f.holders(coll, row, f === me ? writer : undefined)]));

  /**
   * An implied document's root row, made by its first write -- told as a row
   * carried in (`Touched`): an add to a list of those roots (a cafe's kitchen),
   * nothing to the implied documents, which showed it already. Undefined when
   * the row was there.
   */
  function ensureImpliedRoot(def: DocDef, doc: any, writer: string): Touched | undefined {
    const rootTable = schema.tables[def.root]!;
    const root = doc[def.root];
    if (db.query(`SELECT 1 FROM ${current(rootTable)} WHERE id = ?`).get(root.id)) return;
    if (handedOut(rootTable, root.id)) taken(def.root, root.id);   // made under the add rule (#71)
    const ts = now();
    if (rootTable.temporal) { root.valid_from = ts; root.valid_to = null; }
    insertRow(db, rootTable, root, ts);
    passId(rootTable, root.id);
    const row = readRow(rootTable, root.id);
    const before = new Map([...fanouts].map((f) => [f, f.showing(def.root, row, f === me ? writer : undefined)]));
    return { coll: def.root, id: row.id, before, after: row, carried: true };
  }

  /** The implied single documents open here (and `writer`) that hold `row`: they showed it before it was made. */
  function showing(coll: string, row: any, writer?: string): string[] {
    return holders(coll, row, writer).filter((name) => {
      const m = findDoc(name);
      return !!m?.def.implied && resolveScope(m.def, m.docId).mode === "single";
    });
  }

  /**
   * Tellings run in the order their writes committed: one that waits on an
   * `owns`'s promise holds back those after it. With no promise to wait on,
   * a write is told before it answers, as it always was.
   */
  let telling: Promise<void> | undefined;
  function inOrder(run: () => void | Promise<void>): void {
    const failed = (err: any) => log.error(`delta fan-out failed (write committed): ${err?.message ?? err}`);
    const settle = (p: Promise<void>) => {
      const mine: Promise<void> = p.then(undefined, failed).then(() => { if (telling === mine) telling = undefined; });
      telling = mine;
    };
    if (telling) return settle(telling.then(run));
    let ran: void | Promise<void>;
    try { ran = run(); } catch (err) { return failed(err); }
    if (isPromise(ran)) settle(ran);
  }

  // ---------------------------------------------------------------------------
  // Delta ops → SQL
  // ---------------------------------------------------------------------------

  /** A row outside a document -- of a collection it does not include -- that a write through it reaches (a cascade). */
  type Beyond = { coll: string; row: any };

  /** The document with rows outside it beside it, for the ledger: what an inverse puts back, and what a walk is guarded by. */
  function besides(doc: any, rows: Beyond[]): any {
    if (!rows.length) return doc;
    const out = { ...doc };
    for (const { coll, row } of rows) out[coll] = { ...out[coll], [row.id]: row };
    return out;
  }

  /**
   * The id of the `root` row that `row` (of `coll`) hangs from, following parent
   * keys up through the tables as they stand; null when the chain does not
   * reach `root`.
   */
  function chainRoot(coll: string, row: any, root: string): unknown {
    if (coll === root) return row.id;
    let table = schema.tables[coll];
    if (!table?.parent) return null;
    let id: unknown = row[table.parent.fkColumn];
    let cur = table.parent.collection;
    for (let depth = 0; depth < 32 && id != null; depth++) {
      if (cur === root) return id;
      table = schema.tables[cur];
      if (!table?.parent) return null;
      id = (db.query(`SELECT ${q(table.parent.fkColumn)} AS fk FROM ${current(table)} WHERE id = ?`).get(id as any) as { fk: unknown } | null)?.fk ?? null;
      cur = table.parent.collection;
    }
    return null;
  }

  /**
   * Does the document (`def`, read by `scope`) hold `row` of `coll`? Judged on
   * the row's values, so a row as it was before a write is judged as well as
   * one as it is after.
   */
  function holds(def: DocDef, scope: Scope, coll: string, row: any): boolean {
    if (!row) return false;
    if (coll !== def.root && !def.include.includes(coll)) return false;
    // named with a time past, it holds a temporal row as it stood then, which no write now changes (a table that keeps no history it reads as it is)
    if (scope.at !== undefined && schema.tables[coll]?.temporal && sqliteTime(scope.at) <= sqliteTime(new Date().toISOString())) return false;
    if (coll === def.root) {
      if (scope.mode !== "list" && !sameId(row.id, scope.id)) return false;
      // a name its columns cannot take holds nothing: it is refused (400) when opened or written through
      try { return meets(scope, row, keeping(db, schema.tables[coll]!)); }
      catch (err: any) { if (typeof err.code === "number") return false; throw err; }
    }
    if (scope.mode === "list" || !schema.tables[coll]?.parent) return true;   // in full
    return sameId(chainRoot(coll, row, def.root), scope.id);
  }

  /** The open documents -- and the writer's own -- that hold `row` of `coll`. */
  function holders(coll: string, row: any, writer?: string): string[] {
    if (!row) return [];
    const names = new Set(subscriptions.keys());
    if (writer !== undefined) names.add(writer);
    const out: string[] = [];
    for (const name of names) {
      const m = findDoc(name);
      if (m && holds(m.def, resolveScope(m.def, m.docId), coll, row)) out.push(name);
    }
    return out;
  }

  /** A row as the tables hold it now, as a document reads it; null when not there. */
  function readRow(table: ResolvedTable, id: string | number): any | null {
    const row = db.query(`SELECT ${columnsOf(table)} FROM ${current(table)} WHERE id = ?`).get(id as any);
    if (!row) return null;
    decodeRow(table, row);
    return row;
  }

  /** The rows that hang from a row of `table` -- its children, theirs, and on down -- parent first, as `_delta_hanging_rows` orders them. */
  function hanging(table: ResolvedTable, id: string | number, out: { table: ResolvedTable; row: any }[] = []): { table: ResolvedTable; row: any }[] {
    for (const childKey of table.children.toSorted()) {
      const child = schema.tables[childKey]!;
      for (const row of db.query(`SELECT ${columnsOf(child)} FROM ${current(child)} WHERE ${q(child.parent!.fkColumn)} = ? ORDER BY id`).all(id as any) as any[]) {
        decodeRow(child, row);
        out.push({ table: child, row });
        hanging(child, row.id, out);
      }
    }
    return out;
  }

  /**
   * A row and the rows its removal takes with it (its children, and the rows
   * `cascadeOn` it), parent first -- each once, where the walk first reaches it,
   * as the removal then takes it: a row reached twice (a child of the removed
   * row that also cascades on another row it takes) is not taken again. As the
   * schema says, whichever document the removal is written through: one that
   * does not include the drinks still takes a course's drinks. In one order on
   * every backend: each child collection by key, each row by id, then each
   * collection that cascades on it (`_delta_cascade_remove`).
   */
  function cascadeRows(table: ResolvedTable, id: string | number, out: { table: ResolvedTable; row: any }[] = [], seen = new Set<string>()): { table: ResolvedTable; row: any }[] {
    const key = `${table.docKey}/${id}`;
    const row = seen.has(key) ? null : readRow(table, id);
    if (!row) return out;
    seen.add(key);
    out.push({ table, row });
    for (const childKey of table.children.toSorted()) {
      const child = schema.tables[childKey]!;
      for (const r of db.query(`SELECT id FROM ${current(child)} WHERE ${q(child.parent!.fkColumn)} = ? ORDER BY id`).all(id as any) as any[]) {
        cascadeRows(child, r.id, out, seen);
      }
    }
    const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    for (const ref of table.referencedBy.toSorted((a, b) => byKey(a.collection, b.collection) || byKey(a.fkColumn, b.fkColumn))) {
      const refTable = schema.tables[ref.collection]!;
      for (const r of db.query(`SELECT id FROM ${current(refTable)} WHERE ${q(ref.fkColumn)} = ? ORDER BY id`).all(id as any) as any[]) {
        cascadeRows(refTable, r.id, out, seen);
      }
    }
    return out;
  }

  /**
   * The next serial for a collection: its sequence advanced. A collection with
   * no sequence yet starts from the largest id it holds -- rows put in by
   * hand -- and from then on counts on, as a Postgres sequence does, past
   * any id a write named (`passId`).
   */
  function nextId(table: ResolvedTable): number {
    const next = serial(table) + 1;
    const take = () => db.run("INSERT INTO _delta_sequences (collection, last) VALUES (?, ?) ON CONFLICT (collection) DO UPDATE SET last = MAX(last, excluded.last)", [table.docKey, next]);
    take();
    spent.push(take);
    return next;
  }

  /** The last id a collection's serial handed out: its sequence, or before it has one, the largest id the table holds. */
  function serial(table: ResolvedTable): number {
    const seq = db.query("SELECT last FROM _delta_sequences WHERE collection = ?").get(table.docKey) as { last: number } | null;
    return seq?.last ?? ((db.query(`SELECT MAX(id) AS m FROM ${q(table.name)} WHERE typeof(id) = 'integer'`).get() as { m: number | null } | null)?.m ?? 0);
  }

  /** Whether a collection's serial has handed `id` out: an add may not name it (#71). A text id is the client's own key, which no serial hands out. */
  function handedOut(table: ResolvedTable, id: string | number): boolean {
    return typeof id === "number" && id <= serial(table);
  }

  /** The one answer to an add of an id taken, whether a row holds it or the serial handed it out (#71). */
  function taken(coll: string, id: string | number): never {
    refuse(409, `Id already taken: ${joinPath(coll, String(id))} -- add to ${joinPath(coll, "-")} for a new id`);
  }

  /**
   * An id a write named moves its collection's sequence past it, never back, so a later `add /<coll>/-` does not
   * meet it (#72). As there, once the write is done (`passNamed`), so a
   * write refused part way names none, and a `-` in the write after a named add takes the serial as it stood
   * (#71). A collection with no sequence yet starts one, from the largest id it holds, as `nextId` would, so
   * the id stays passed once its row is gone, as setval's does.
   */
  function passId(table: ResolvedTable, id: string | number): void {
    if (typeof id === "number" && !(id <= (passing.get(table) ?? -Infinity))) passing.set(table, id);
  }

  /** Each collection's highest id the write under way named, its serial passed once the write is done. */
  const passing = new Map<ResolvedTable, number>();

  function passNamed(): void {
    for (const [table, id] of passing) {
      db.run(
        `INSERT INTO _delta_sequences (collection, last) VALUES (?1, MAX(?2, COALESCE((SELECT MAX(id) FROM ${q(table.name)} WHERE typeof(id) = 'integer'), 0)))
         ON CONFLICT (collection) DO UPDATE SET last = MAX(last, ?2)`, [table.docKey, id]);
    }
    passing.clear();
  }

  /**
   * The serials the write under way minted (`-`): taken again when it is rolled
   * back, so a refused write spends them, as a Postgres sequence's nextval is
   * not rolled back -- the next row is named the same on both.
   */
  const spent: (() => void)[] = [];

  // You may write what you may read. Reads were always scoped; writes addressed
  // rows by bare id, so a client holding `customer:alice` could name a row of
  // `customer:bob` and reach it. Every row-addressed write asks `held` (in
  // applyWrite): the row as the tables stand at that point in the write, judged by
  // the rule a document is read by (`holds`)
  // `_delta_row_in_scope` -- so a row that left the document earlier in the same
  // write is not its to write. A row added, or moved by a parent key written, goes
  // only under a parent the document holds (`parentHeld`; one of a collection it
  // does not include, through the tables: `reaches`). The error message
  // deliberately matches the "not there" case: a distinct "forbidden" would
  // confirm the row exists to someone probing ids.
  function applyWrite(docName: string, def: DocDef, doc: any, ops: DeltaOp[], walk: boolean): { applied: DeltaOp[]; touched: Touched[]; beyond: Beyond[]; stored: Map<string, Record<string, unknown>> } {
    const scope = resolveScope(def, docName.slice(def.prefix.length));
    const list = scope.mode === "list";
    const rootId = list ? undefined : rowId(scope.id ?? doc[def.root]?.id);
    const rootTable = schema.tables[def.root]!;
    let opened: boolean | undefined;   // a single document's root was there as the write began (or it is implied)
    let rootWas: any;   // that root as this write took it out: added back, it goes under the same parent
    const broadcastOps: DeltaOp[] = [];
    const touched: Touched[] = [];
    const beyond: Beyond[] = [];   // rows the cascade took that the document does not hold, as they were
    const stored = new Map<string, Record<string, unknown>>();   // what each row removed held in columns this version does not declare
    // A write is one moment, as a Postgres transaction's NOW() is: every version
    // it makes or closes is stamped with it, and a temporal row it writes twice
    // is one new version -- rewritten in place (`made`), not closed a tick later.
    const ts = now();
    const made = new Set<string>();

    /**
     * The row of `table` the document holds, as the tables stand at this point
     * in the write: you may write what you
     * may read. A row that has left the document earlier in the write (moved
     * to another parent, out of a list's condition, its parent gone) is not its
     * to write for the rest of it; null when it is not there or not the document's.
     * The document's copy is not asked: it is the document as it was opened.
     */
    const held = (table: ResolvedTable, id: string | number): any | null => {
      const row = readRow(table, id);
      return row && holds(def, scope, table.docKey, row) ? row : null;
    };

    /**
     * A run of replaces of one row, one op straight after another: merged as
     * they come and written when the run ends -- one write of the row, one
     * answer, one entry and one telling of the run's net change. Every other op
     * ends the run first, so the ops still land in the order sent; nothing
     * between them could see the row part-way.
     */
    let run: { table: ResolvedTable; id: string | number; root: boolean; key: string; before: Touched["before"]; was: any; row: any } | undefined;

    /**
     * Write the run's row: on a temporal table, the version before the write
     * closed and the write's inserted (or, once the write has made it, that
     * version rewritten); else one in-place UPDATE (`id` is the whole PK there,
     * so a reinsert would collide). The row is read back as it is kept (a parent
     * key's "5" is 5), and told as it lands.
     */
    const endRun = () => {
      if (!run) return;
      const { table, id, root, key, before, was, row } = run;
      run = undefined;
      // a row moved to another parent takes the rows under it along: who holds each, asked before it moves
      const fk = table.parent?.fkColumn;
      const moved = fk != null && !sameId(row[fk], readRow(table, id)[fk]);
      const carried: Touched[] = moved ? hanging(table, id).map(({ table: t, row: r }) => ({ coll: t.docKey, id: r.id, before: heldBy(t.docKey, r, docName), after: r, carried: true })) : [];
      if (table.temporal && !made.has(key)) {
        closeRow(db, table, id, ts);
        insertRow(db, table, row, ts);
        carryUndeclared(db, table, id, ts);
        made.add(key);
      } else updateRow(db, table, id, row);
      const collKey = table.docKey;
      const stored = readRow(table, id);
      if (root) doc[collKey] = stored;
      else doc[collKey][id] = stored;
      broadcastOps.push({ op: "replace", path: root ? joinPath(collKey) : joinPath(collKey, String(id)), value: stored });
      touched.push({ coll: collKey, id, before, after: stored, was });
      touched.push(...carried);   // after the row they hang from, unchanged
    };

    /**
     * A parent a row may not go under: not there, or not the document's (404) -- or, named by text that is
     * no number, a mistake (400). (A text id SQLite keeps is there.)
     */
    const noParent = (coll: string, id: unknown): never =>
      typeof id === "string" && !/^\s*[+-]?\d+\s*$/.test(id)
        ? refuse(400, `${coll} "${id}" names no row: an id is a whole number`)
        : refuse(404, `Row not found: ${coll}/${id ?? ""}`);

    /** Is row `id` of `coll` there now? A parent a row is added or moved under must be. */
    const there = (coll: string, id: unknown): boolean => readRow(schema.tables[coll]!, rowId(id as string | number)) != null;

    // Does a parent the document does not include hang from its root? Asked of the tables.
    const reaches = (coll: string, id: unknown): boolean => {
      const parent = readRow(schema.tables[coll]!, rowId(id as string | number));
      return !!parent && sameId(chainRoot(coll, parent, def.root), rootId);
    };

    /**
     * Does the document hold `id` of `coll`, the parent a row is added or moved
     * under, as the tables stand now? One of a collection it does not include
     * is asked of `reaches` (single mode; a list holds none such).
     */
    const parentHeld = (coll: string, id: unknown): boolean =>
      id != null && (coll === def.root || def.include.includes(coll) ? held(schema.tables[coll]!, rowId(id as string | number)) != null : !list && reaches(coll, id));

    /**
     * Replace fields of a row the document holds -- the root (`root`), or a row
     * of a map -- as the op says, into the run of that row. The path names the
     * row, so `id` and the temporal columns in a value are not taken from it.
     * A replace of the row itself (`whole`) is the row, as RFC 6902 says: a
     * column its value leaves out holds what an add would give it;
     * its parent key, where it hangs, stays unless the value names another.
     */
    const replaceRow = (table: ResolvedTable, id: string | number, fields: Record<string, unknown>, root: boolean, whole = false) => {
      const collKey = table.docKey;
      const key = `${collKey}/${id}`;
      if (run && run.key !== key) endRun();
      if (!run) {
        const present = held(table, id);
        if (!present) refuse(404, `Row not found: ${collKey}/${id}`);   // not this document's, or gone from it earlier in this write
        run = { table, id, root, key, before: heldBy(collKey, present, docName), was: present, row: { ...present } };
      }
      // A parent key written moves the row, and only under a parent this
      // document holds, as an add names one: through it, a row is never moved
      // into another document (you may write what you may read). A single
      // document's own root too: it holds no parent of it, so the root moves
      // through a list that holds both (0.10.0 review). A list's included
      // collection is whole; a key written as it is, is no move.
      const parent = table.parent;
      const to = parent ? fields[parent.fkColumn] : undefined;
      const from = parent ? run.row[parent.fkColumn] : undefined;   // as this write has it so far
      if (parent && to != null && !(from != null && sameId(rowId(to as string | number), rowId(from as string | number)))
          && ((!(list && parent.collection !== def.root) && !parentHeld(parent.collection, to)) || !there(parent.collection, to))) {
        noParent(parent.collection, to);
      }
      // (of the columns this document holds: it leaves the rest as they are)
      if (whole) for (const [col, colDef] of Object.entries(table.columns)) if (holdsField(def, schema, collKey, col)) run.row[col] = leftOut(colDef);
      for (const [field, value] of Object.entries(fields)) {
        if (field === "id" || field === "valid_from" || field === "valid_to") continue;
        run.row[field] = value;
      }
      // A list's root row written through the list stays in its scope, as an
      // add through it is given its bindings: a field, a row or a merge that
      // takes it out -- into another owner's list by its key, or out of a
      // condition -- is refused, and the write undone. So
      // does a single document's root, out of the rest of its name's scope
      // (a seat of fo-seat-of:1:3 to table 7; 0.10.0 review).
      if (((list && collKey === def.root) || root) && !holds(def, scope, collKey, run.row)) {
        refuse(404, `Row not found: ${collKey}/${id} -- the write would take it out of ${docName}`);
      }
    };

    // Each op lands in the order sent: a field written and then
    // its row removed is written first, and a row removed is not there for an
    // op after it.
    for (const op of ops) {
      if (op.op !== "replace") endRun();
      // A single document whose root is not there takes no writes (404), as it
      // opens: asked before each op, so one that takes its root out writes
      // nothing more through it -- an add under it would be an orphan -- but
      // that root back, and then on through it (delta_apply asks the same). A
      // walk is not asked: it may start from the root absent (an undo of its
      // removal), guarded by its plan.
      if (!list && !walk) {
        const there = readRow(rootTable, rootId!) != null;
        opened ??= there || !!def.implied;   // an implied document always opens
        const named = (() => { try { return splitPath(op.path); } catch { return []; } })();
        const back = opened && op.op === "add" && named.length === 2 && named[0] === def.root && named[1] !== "-" && sameId(rowId(named[1]!), rootId);
        if (!there && !back) refuse(404, `Document not found: ${docName} (its root, ${joinPath(def.root, String(rootId))}, is not there)`);
      }

      // What the op may say (`validateOps`), asked as it comes, as delta_apply asks it: one refused
      // leaves the ops before it to roll back, and the serials they took spent -- the same on every backend
      const invalid = validateOps(schema, def, [op], { list, values: scope.values, walk, stored: walk ? (t) => undeclaredColumns(db, t) : undefined });
      if (invalid.length) refuse(400, invalid.map((e) => `${e.path}: ${e.message}`).join("; "));

      const parts = splitPath(op.path);
      const collKey = parts[0]!;
      const table = schema.tables[collKey];
      // A single-mode document's root is one row, held at /<root>.
      const isRoot = !list && collKey === def.root;

      // /<root>/<id> and /<root>/<id>/<field> name it by its id
      // and as a list document would say it: a replace of it, or of one field.
      // It holds no other root row, so another id is not found.
      if (isRoot && op.op === "replace" && (parts.length === 3 || (parts.length === 2 && namesRootRow(table!, parts[1]!, rootId)))) {
        if (!sameId(rowId(parts[1]!), rootId)) refuse(404, `Row not found: ${collKey}/${rowId(parts[1]!)}`);
        replaceRow(table!, rootId!, parts.length === 3 ? { [parts[2]!]: (op as any).value } : (op as any).value, true, parts.length === 2);
        continue;
      }

      // /<root>/fieldName is a field of it (an add or a remove of /<root>/<id> is the row itself, below)...
      if (isRoot && parts.length === 2 && op.op !== "add" && op.op !== "remove") {
        if (op.op !== "replace") throw new Error(`Root fields support replace only`);
        replaceRow(table!, rootId!, { [parts[1]!]: (op as any).value }, true);
        continue;
      }

      // ...and /<root> the root row whole.
      if (!list && collKey === def.root && parts.length === 1) {
        if (op.op !== "replace") throw new Error(`Root supports replace only`);
        replaceRow(table!, rootId!, (op as any).value as Record<string, unknown>, true, true);
        continue;
      }

      // Everything else is a row of a map (an included collection, or a list-mode document's root), or the root row itself --
      // or, in a walk, a row outside the document (`beyond`) that the entry's cascade took: put back, or taken again.
      const outside = collKey !== def.root && !def.include.includes(collKey);
      if (!table || (outside && !(walk && parts.length === 2 && op.op !== "replace"))) {
        throw new Error(`Unknown collection: ${collKey}`);
      }

      if (parts.length === 2) {
        // A single document removes the root it is named for,
        // with the rows it holds under it, and an undo adds it back, then them.
        // It holds no other root row, so another is not its to remove (404) or
        // add (400).
        if (isRoot && (parts[1] === "-" || !sameId(rowId(parts[1]!), rootId))) {
          if (op.op === "remove") refuse(404, `Row not found: ${collKey}/${parts[1]}`);
          refuse(400, `${docName} holds ${collKey} ${rootId} alone: add another ${collKey} row through a document that lists them`);
        }
        // `add /<coll>/-` is a new row the store names: the next serial,
        // carried by the broadcast path and the row.
        const mint = op.op === "add" && parts[1] === "-";
        const id = mint ? nextId(table) : rowId(parts[1]!);
        if (op.op === "add") {
          // An add makes a new row, under an id the serial has not handed out
          // (#71): one it has (minted, or passed for an add that named it) is
          // refused, whether a row holds it now or none does, so the answer
          // says nothing of rows the writer may not read. But for ids the
          // writer has read: a walk puts back the rows its entry took, and a
          // write may add back a row it has itself written (a single
          // document's root taken out and put back). A live id is refused all
          // the same (on a temporal table it would be a second live version,
          // #16): a text id, the client's own key, which no serial hands out,
          // or a row put in by hand past the serial. delta_apply keeps the
          // same rule.
          const named = !mint && !walk && !touched.some((t) => t.coll === collKey && sameId(t.id, id));
          if ((named && handedOut(table, id)) || db.query(`SELECT 1 FROM ${current(table)} WHERE id = ?`).get(id)) taken(collKey, id);
          const row = { ...((op as any).value as Record<string, unknown>) };
          // A list-mode document's root row is given its scope's equality bindings:
          // each as its column takes the name's text (a boolean's "0" is false), and the row is read back.
          if (list && collKey === def.root) for (const [col, text] of Object.entries(scope.values)) row[col] = scopeValue(table, col, text);
          // A DIRECT child's FK is forced to `rootId` by insertCollectionRow, but a
          // grandchild's comes verbatim from the client. Unchecked, that grafts the
          // new row onto another doc's parent — a cross-doc write. Require the named
          // parent to be in THIS doc's scope, as it stands now. (The root's own
          // parent is not in the document: its value names it, as a list's root
          // row's does; a list's included collection is whole.)
          const parent = table.parent;
          if (!isRoot && !outside && parent && (list ? parent.collection === def.root : parent.collection !== def.root)) {
            const fk = row[parent.fkColumn];
            if (!parentHeld(parent.collection, fk)) noParent(parent.collection, fk);
          }
          // ... and whatever the document, the parent it names must be there (a list names it only by key;
          // a single document's child goes under its root, gone if a walk puts the child back after it)
          const fk = parent && !list && !isRoot && parent.collection === def.root ? rootId : parent ? row[parent.fkColumn] : undefined;
          if (parent && fk != null && !there(parent.collection, fk)) noParent(parent.collection, fk);
          const fullRow = insertCollectionRow(db, schema, table, id, rootId, def, row, ts, list);
          passId(table, id);
          // A root row added through a document is one it holds: a list's, given
          // its bindings, meets the rest of its conditions too, and a single
          // document's own root added back the whole of its name's scope -- else
          // refused, and the write undone (0.10.0 review).
          if (((list && collKey === def.root) || isRoot) && !holds(def, scope, collKey, fullRow)) {
            refuse(404, `Row not found: ${collKey}/${id} -- the add is not one ${docName} holds`);
          }
          // ... and a single document's own root, added back in the write that took
          // it out, goes back under the parent it had: another would be a move, and
          // the document holds no parent of its root (0.10.0 review).
          if (isRoot && rootWas && parent && !sameId(fullRow[parent.fkColumn], rootWas[parent.fkColumn])) {
            refuse(404, `Row not found: ${parent.collection}/${fullRow[parent.fkColumn] ?? ""}`);
          }
          if (table.temporal) made.add(`${collKey}/${id}`);
          if (isRoot) doc[collKey] = fullRow;
          else if (!outside) doc[collKey][id] = fullRow;
          broadcastOps.push({ op: "add", path: joinPath(collKey, String(id)), value: fullRow });
          touched.push({ coll: collKey, id, before: new Map(), after: fullRow });
        } else if (op.op === "remove") {
          // Remove row + cascades. The removal addresses rows by id ALONE, so
          // without this gate a client could name any id and delete a sibling
          // doc's row -- or one that has left this document earlier in the write.
          if (!(outside ? readRow(table, id) : held(table, id))) refuse(404, `Row not found: ${collKey}/${id}`);
          if (isRoot) rootWas = readRow(table, id);
          // the row and every row its removal takes, and who holds each, asked before any is gone
          const cascade = cascadeRows(table, id).map(({ table: t, row }) => ({ t, row, before: heldBy(t.docKey, row, docName) }));
          for (const { t, row, before } of cascade) {
            const others = undeclaredOf(db, t, row.id);
            if (others) stored.set(joinPath(t.docKey, String(row.id)), others);
            if (t.temporal) closeRow(db, t, row.id, ts);
            else db.run(`DELETE FROM ${q(t.name)} WHERE id = ?`, [row.id]);
            delete doc[t.docKey]?.[row.id];
            if (t.docKey !== def.root && !def.include.includes(t.docKey)) beyond.push({ coll: t.docKey, row });
            broadcastOps.push({ op: "remove", path: joinPath(t.docKey, String(row.id)) });
            touched.push({ coll: t.docKey, id: row.id, before, after: null });
          }
          if (isRoot) doc[collKey] = null;
        } else if (op.op === "replace") {
          // Whole-row replace: /<coll>/<id> -- the row, as an add's value is
          replaceRow(table, id, (op as any).value as Record<string, unknown>, false, true);
        }
      } else if (parts.length === 3 && op.op === "replace") {
        // Field update: /<coll>/<id>/<field>
        replaceRow(table, rowId(parts[1]!), { [parts[2]!]: (op as any).value }, false);
      } else {
        throw new Error(`Invalid op: ${op.op} ${op.path}`);
      }
    }
    endRun();

    return { applied: broadcastOps, touched, beyond, stored };
  }

  /**
   * What each document that held or holds a row the write changed is told, the
   * writer's first: a row that arrives is an add,
   * one that stays a replace of each field that changed (none: nothing), one
   * that leaves a remove; where the row is the document's root, a replace of the
   * root when it arrives (null when it leaves -- or, for an implied document,
   * the empty root it then opens with). A holder is told what changed, never
   * the whole row again.
   *
   * Each touch is told in turn, so a copy is told every step of a row the write
   * touches twice: who holds the row after a touch is who held it at its next,
   * and after its last, who holds it once the write is done. A row made and
   * then taken out (a drink, with its course) is told its add wherever its
   * remove is told, never a remove alone. `_delta_tell` keeps the same.
   */
  function tell(writer: string | undefined, touched: Touched[]): Map<string, DeltaOp[]> {
    const rows = touched.map((t) => ({ ...t, before: t.before.get(me) ?? [], now: [] as string[] }));
    const next = new Map<string, string[]>();   // a row's holders, as its next touch found them
    for (const t of rows.toReversed()) {
      const key = `${t.coll}/${t.id}`;
      t.now = next.get(key) ?? holders(t.coll, t.after, writer);
      next.set(key, t.before);
    }
    const targets = new Set<string>(writer === undefined ? [] : [writer]);
    for (const t of rows) for (const name of [...t.before, ...t.now]) targets.add(name);
    const told = new Map<string, DeltaOp[]>();
    for (const target of targets) {
      const m = findDoc(target);
      if (!m) continue;
      const single = resolveScope(m.def, m.docId).mode === "single";
      const ops: DeltaOp[] = [];
      for (const t of rows) {
        const was = t.before.includes(target);
        const is = t.now.includes(target);
        if ((!was && !is) || (t.carried && was && is)) continue;
        const root = single && t.coll === m.def.root;
        const path = root ? joinPath(t.coll) : joinPath(t.coll, String(t.id));
        const show = (row: any) => showRow(m.def, schema, t.coll, row);   // the columns it holds
        if (was && is) ops.push(...changedFields(path, show(t.was), show(t.after)));
        else if (is) ops.push({ op: root ? "replace" : "add", path, value: show(t.after) });
        else ops.push(root ? { op: "replace", path, value: m.def.implied ? show(emptyDoc(m.def, m.docId)[m.def.root]) : null } : { op: "remove", path });
      }
      told.set(target, ops);
    }
    return told;
  }



  /**
   * The one write path -- a fresh write, an undo, a redo: validated, applied in
   * one transaction with its ledger entry (a savepoint inside a caller's own),
   * and then told: to the document's subscribers, to the other open documents
   * that share its rows, and to the custom documents that watch them.
   */
  function write(docName: string, def: DocDef, doc: any, ops: DeltaOp[], by: { who: string | null; cursor: string | null; undoes?: number; undoable?: boolean; as?: I }): Written | Failed {
    // Each op is validated as it comes (applyWrite), unknown collections, fields and bad types refused
    // rather than acked and dropped by the database.
    const scope = resolveScope(def, docName.slice(def.prefix.length));
    // a document named with a time reads it as it stood: what is written now is not its to write
    if (scope.at !== undefined) return { error: { code: 403, message: `${docName} reads ${def.root} as it stood at ${scope.at}: it takes no writes. Write through a document with no time in its name.` } };

    let snapshot = structuredClone(doc); // for rollback, and for the inverse
    spent.length = 0;
    passing.clear();
    let written: Written;
    let touched: Touched[] = [];
    try {
      // `db.transaction` rather than a bare BEGIN: inside a caller's own
      // transaction (a server-side renderer writing several things as one, a
      // test that rolls every case back) it becomes a savepoint, and still
      // rolls back alone. Rollback owns only this region: a failure in the
      // post-commit block below must not look like a failed write.
      // an implied document's first write makes its root row -- unless it adds the root itself (an undo of its removal)
      const addsRoot = scope.mode === "single" && ops.some((op) => op.op === "add" && splitPath(op.path).length === 2 && splitPath(op.path)[0] === def.root);
      // Immediate: the write lock first, waiting for another process's (busy_timeout),
      // then the reads -- a deferred transaction that read before another committed
      // could not then write (SQLITE_BUSY). Under it, a copy another wrote past is read again.
      written = db.transaction(() => {
        if (heardElsewhere()) {
          reloadEvicted();
          doc = load(docName, def, docName.slice(def.prefix.length)) ?? rootless(def, docName.slice(def.prefix.length));
          snapshot = structuredClone(doc);
        }
        const made = implied.has(docName) && !addsRoot && ops.length > 0 ? ensureImpliedRoot(def, doc, docName) : undefined;   // an empty write makes nothing
        const done = applyWrite(docName, def, doc, ops, by.undoes !== undefined);
        passNamed();
        // a write through a document with a path keeps its row in the writer's reach (a row is never handed away)
        if (def.owns !== undefined && by.as !== undefined && !keepsReach(def, docName, by.as)) refuse(403, `${docName}: that would take it out of your reach (its owns: ${def.owns})`);
        touched = made ? [made, ...done.touched] : done.touched;
        // a removed row comes back as it was stored: with what it held in columns this version does not declare
        const inverse = inverseOf(besides(snapshot, done.beyond), done.applied, ops).map((op) =>
          op.op === "add" && done.stored.has(op.path) ? { ...op, value: { ...(op.value as object), ...done.stored.get(op.path) } } : op);
        const recorded = ledger?.record({ doc: docName, ops: done.applied, inverse, ...by });
        return { ops: done.applied, inverse, version: recorded?.version, entry: recorded?.entry };
      }).immediate();
      if (ops.length > 0) implied.delete(docName);
    } catch (err: any) {
      for (const take of spent) take();
      if (spent.length) options.committed?.();   // the serials it spent are kept: the JSON file saves them
      if (cache.has(docName)) cache.set(docName, snapshot); // restore in-memory cache (a rootless walk's copy was never in it)
      err = named(err);
      log.error(`delta failed: ${err.message}`);
      // A refusal carries its wire code (`refuse`); anything else is the server's.
      return { error: failure(err) };
    }

    // Committed. The telling is a post-commit side effect: a failure here must
    // not roll back (the write is durable) nor masquerade as a write error.
    try {
      // Every document that held or holds a row the write changed is told what
      // changed for it -- the writer's own first, with the version
      // its write made; each other, with a version of its own. Through
      // `createLocal().onPublish`, the one stream of changes an in-process
      // caller (eta) redraws from.
      announce(touched, written.ops, { name: docName, version: written.version });
      for (const f of fanouts) if (f !== me) f.announce(touched, written.ops);
      if (ops.length > 0) options.committed?.();   // an empty write changed nothing: the JSON file has nothing to save
    } catch (err: any) {
      log.error(`delta fan-out failed (write committed): ${err.message}`);
    }
    log.info(`delta ${docName} [${ops.map((o: DeltaOp) => `${o.op} ${o.path}`).join(", ")}]`);
    return written;
  }

  /**
   * Tell the documents open here what a write changed (`writer`: the one
   * written through, if it is this registration's), and the custom documents
   * that watch its rows. Every document that held or holds a row the write
   * changed is told what changed for it -- the writer's own first,
   * with the version its write made; each other, with a version of its own.
   * Through `createLocal().onPublish`, the one stream of changes an in-process
   * caller (eta) redraws from.
   */
  function announce(touched: Touched[], applied: DeltaOp[], writer?: { name: string; version?: number }): void {
    const changes: { name: string; change: Record<string, unknown> }[] = [];
    for (const [name, tOps] of tell(writer?.name, touched)) {
      if (name === writer?.name) {
        // a write that changed nothing tells nothing, and made no version
        if (applied.length > 0) changes.push({ name, change: { doc: name, ops: tOps, ...(writer.version !== undefined ? { v: writer.version } : {}) } });
      } else if (tOps.length > 0) {
        const v = ledger?.bump(name);   // numbered as committed, told in that order
        changes.push({ name, change: { doc: name, ops: tOps, ...(v !== undefined ? { v } : {}) } });
      }
      // an open copy is read again from the tables: it holds exactly what a fresh open would
      if (cache.has(name) || name === writer?.name) refresh(name);
    }
    inOrder(() => {
      // With auth, only to those who may still hear each document.
      const asked = auth ? [...changes.map(({ name }) => custom.letGo(name, subscriptions.get(name), ownsOf(name), { dropped: () => unheld(name) })), custom.letGoWatching(applied)] : [];
      const publish = () => {
        for (const { name, change } of changes) ws.publish(name, change);
        custom.tell(applied);
      };
      const waiting = asked.filter((a): a is Promise<void> => isPromise(a));
      if (!waiting.length) return publish();
      return Promise.all(waiting).then(publish);
    });
  }

  /** Read an open document's copy again from the tables. */
  function refresh(docName: string): void {
    const m = findDoc(docName);
    if (!m) return;
    const doc = readDoc(db, schema, m.def, resolveScope(m.def, m.docId));
    if (doc) cache.set(docName, doc);
    else if (m.def.implied) { cache.set(docName, emptyDoc(m.def, m.docId)); implied.add(docName); }
    else cache.delete(docName);
  }

  return { write, readRow, cascadeRows, besides };
}

// ---------------------------------------------------------------------------
// Inverse
// ---------------------------------------------------------------------------

/** A row as a write may carry it: its temporal columns are storage, not data. */
function withoutStorage(row: any): any {
  if (!row || typeof row !== "object" || !("valid_from" in row || "valid_to" in row)) return row;
  const { valid_from: _from, valid_to: _to, ...data } = row;
  return data;
}

/** A row's path as a write tells it: its id as kept (`/courses/007` is told at /courses/7). */
function toldAt(path: string): string {
  const parts = splitPath(path);
  return parts.length === 2 ? joinPath(parts[0]!, String(rowId(parts[1]!))) : path;
}

/**
 * The inverse of a write, from the document as it was before and the ops the
 * backend applied. Applied ops are whole rows (`/coll/id`) or the root
 * (`/root`; added or removed, `/root/id`, read where the document holds it:
 * `rowAt`), so the inverse of each is the row as it was: an add is removed,
 * a remove is added back, a replace is replaced by its old self. Written in
 * reverse order, except that a remove and the rows its removal cascaded to (a
 * run) are added back in their own order, parent first, so each child finds
 * its parent in scope.
 *
 * `asked`, the ops as the caller sent them, says where each run starts: at a
 * remove the caller asked for. An undo's removes come children first, each
 * asked for, so each is its own run, and the runs come back in reverse: parent
 * first again. Without `asked`, removes one after another are taken for one
 * run, which is right only for a single remove and its cascade.
 *
 * A single document's root written and then removed by the write is one row
 * at two paths (`/<root>`, `/<root>/<id>`): the add that takes back its
 * removal puts it back as it was before the write, so its replaces before the
 * removal have no inverse of their own -- a walk would find `/<root>` gone.
 *
 * A row the write makes and takes out again never was outside it: its make,
 * and what it had since, walk back nothing, and its removal adds nothing back
 * -- `[add, remove]` inverts to `[]`, `[add, remove, add]` to `[remove]`.
 */
export function inverseOf(before: any, applied: DeltaOp[], asked?: DeltaOp[]): DeltaOp[] {
  const heads = asked && new Set(asked.filter((op) => op.op === "remove").map((op) => toldAt(op.path)));
  let inverse: DeltaOp[] = [];
  let run: DeltaOp[] = [];
  const made = new Map<string, DeltaOp[]>();   // each row the write made, by path: its inverse since
  const flush = () => {
    inverse.unshift(...run);
    run = [];
  };
  const rootAt = (coll: string) => (before?.[coll]?.id != null ? joinPath(coll, String(before[coll].id)) : undefined);
  const lastRemoved = new Map<string, number>();   // each path the write removes, at its last remove: one pass, however long the write
  applied.forEach((op, i) => { if (op.op === "remove") lastRemoved.set(op.path, i); });
  for (const [i, op] of applied.entries()) {
    const parts = splitPath(op.path);
    const root = parts.length === 1 ? rootAt(parts[0]!) : undefined;
    if (op.op === "replace" && root !== undefined && (lastRemoved.get(root) ?? -1) > i) continue;
    if (op.op === "remove" && made.has(op.path)) {
      const since = new Set(made.get(op.path));
      made.delete(op.path);
      inverse = inverse.filter((back) => !since.has(back));
      continue;
    }
    const prior = withoutStorage(rowAt(before, op.path)) ?? null;   // null: not there before the write (made by it)
    if (op.op === "remove") {
      if (heads?.has(op.path)) flush();   // a remove asked for starts its own run; one it cascaded to joins it
      run.push({ op: "add", path: op.path, value: prior });
      continue;
    }
    flush();
    const back: DeltaOp = op.op === "add" ? { op: "remove", path: op.path } : { op: "replace", path: op.path, value: prior };
    inverse.unshift(back);
    if (op.op === "add") made.set(op.path, [back]);
    else made.get(op.path)?.push(back);
  }
  flush();
  return inverse;
}

