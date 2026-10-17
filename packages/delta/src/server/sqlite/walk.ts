/**
 * The ledger's actions on one SQLite registration: `undo` and `redo` (a walk:
 * the cursor's next entry, or a named change, walked back through the write
 * path, guarded by `planWalk`), and `history`. @internal
 */
import { failure } from "../server";
import { NOT_FOUND } from "../custom";
import { type DeltaOp, splitPath, joinPath } from "../../core";
import { isEntryId, planWalk, type Ledger } from "../ledger";
import { resolveScope, rowId } from "../scope";
import { showOps, utcTime } from "../../schema";
import { readDoc } from "./read";
import { named } from "./rows";
import type { Registration, createWriter } from "./write";

/** Answer `undo`, `redo` and `history` for `r`'s documents, over `ledger`, writing through `writer`. */
export function registerWalks<I>(r: Registration<I>, writer: ReturnType<typeof createWriter<I>>, ledger: Ledger): void {
  const { ws, db, schema, options, auth, cache, implied, subscriptions } = r;
  const { findDoc, load, rootless, heardElsewhere, reloadEvicted, gated, whoOf, cursorOf, identityOf, ownsOf, whenOwned, guarded, underLock } = r;
  const { write, readRow, cascadeRows, besides } = writer;

  /**
   * The entry a walk takes: the named change's next (`change`), or else the
   * cursor's; 400 for a change that is not an entry's id, 404 for one that is
   * no change of this cursor's.
   */
  const nextWalk = (way: "undo" | "redo", msg: any, client: any) => {
    const cursor = cursorOf(msg, client);
    if (msg.change == null) {
      const entry = cursor === null ? undefined : way === "undo" ? ledger.nextUndo(cursor) : ledger.nextRedo(cursor);
      return { entry, cursor, named: false };
    }
    if (!isEntryId(msg.change)) return { error: { code: 400, message: "change must be an entry's id: a whole number from 1" } };
    const entry = cursor === null ? null : ledger.changeTip(cursor, msg.change, way === "undo");
    if (entry === null) return { error: { code: 404, message: `Entry ${msg.change} is no change of this cursor's` } };
    return { entry, cursor, named: true };
  };
  /**
   * Undo or redo: the cursor's next entry, walked through the same write path
   * and recorded as walking it -- only the fields it changed, guarded by what
   * it left (`planWalk`). A walk that meets a later write by someone else, or
   * that no longer applies, changes nothing and answers `conflict`; it is
   * recorded all the same, so the next walk goes on to the entry before it.
   * `dry: true` answers what the walk would do and walks nothing; `entry: id`
   * walks only if that is the cursor's next entry (409 otherwise).
   *
   * `change: id` walks one change instead of the cursor's next: the chain
   * that holds that entry, which must be the cursor's own (404), walked at its
   * tip (`ledger.changeTip`). A named walk that meets a conflict, or that the
   * document refuses, walks nothing and records nothing: no cursor has to
   * move past it, and the change stays to be walked once it can be.
   */
  /**
   * An entry's ops with each time as a row now reads it, in UTC (decodeRow): an entry an earlier
   * release kept holds the text it was given ("10:00:00+02:00"), and a walk compares it to the row
   * by the instant it names, and puts it back in the form the row is now read in.
   */
  const inUtc = (ops: DeltaOp[]): DeltaOp[] => ops.map((op) => {
    if (!("value" in op)) return op;
    const [coll, , field] = splitPath(op.path);
    const columns = schema.tables[coll!]?.columns ?? {};
    const time = (col: string) => columns[col]?.type === "timestamptz";
    const value: any = op.value;
    if (field !== undefined) return time(field) ? { ...op, value: utcTime(value) } : op;
    if (value === null || typeof value !== "object") return op;
    return { ...op, value: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, time(k) && v != null ? utcTime(v) : v])) };
  });

  const walk = (way: "undo" | "redo") => (msg: any, client: any, respond: (r: any) => void) => {
    const next = nextWalk(way, msg, client);
    if ("error" in next) return respond(next);
    const { entry, cursor, named } = next;
    if (!entry) return respond({ result: null });
    if (msg.entry != null && msg.entry !== entry.id) {
      return respond({ error: { code: 409, message: `The ${named ? "change" : "cursor"}'s next entry to ${way} is ${entry.id}, not ${msg.entry}` } });
    }
    const match = findDoc(entry.doc);
    if (!match) return;   // written through another registration's document (one ledger, one database): its walk answers
    heardElsewhere();
    reloadEvicted();   // a walk is a write: its fan-out needs every open doc's copy, as delta's does
    // a single document whose root is gone (removed through it) is walked from
    // its root absent: an undo of the removal puts it back
    const doc = load(entry.doc, match.def, match.docId) ?? rootless(match.def, match.docId);
    try {
      // an implied document whose root row is not written yet holds no root to guard
      // what removing a row would take with it: the rows its cascade reaches
      const under = (key: string) => {
        const [coll, id] = splitPath(key);
        const table = schema.tables[coll!];
        return table && id !== undefined ? cascadeRows(table, id).slice(1).map(({ table: t, row }) => joinPath(t.docKey, String(row.id))) : [];
      };
      // a row outside the document the entry's cascade took is guarded by the tables, as they hold it now
      const outside = [...entry.ops, ...entry.inverse].flatMap((op) => {
        const [coll, id] = splitPath(op.path);
        const table = schema.tables[coll!];
        const row = table && id !== undefined && coll !== match.def.root && !match.def.include.includes(coll!) ? readRow(table, rowId(id)) : null;
        return row ? [{ coll: coll!, row }] : [];
      });
      const plan = planWalk({ ops: inUtc(entry.ops), inverse: inUtc(entry.inverse) }, besides(implied.has(entry.doc) ? { ...doc, [match.def.root]: null } : doc, outside), under);
      const show = (ops: DeltaOp[]) => showOps(match.def, schema, ops);   // as the document shows them
      if (msg.dry) return respond({ result: { doc: entry.doc, entry: entry.id, ops: show(plan.ops), ...(plan.conflict.length ? { conflict: plan.conflict } : {}) } });
      const by = { who: whoOf(client), cursor, as: identityOf(client) };
      const out = plan.conflict.length || !plan.ops.length ? null : write(entry.doc, match.def, doc, plan.ops, { ...by, undoes: entry.id });
      if (out && !("error" in out) && out.entry !== undefined) return respond({ result: { doc: entry.doc, ...out, ops: show(out.ops), inverse: show(out.inverse) } });
      if (out && "error" in out && out.error.code >= 500) return respond(out);
      const conflict = plan.conflict.length ? plan.conflict : out && "error" in out ? plan.ops.map((o) => o.path) : undefined;
      const said = conflict ? { conflict } : {};
      // named, it is left as it is: nothing walked, nothing recorded
      if (named) return respond({ result: { doc: entry.doc, ops: [], inverse: [], version: ledger.version(entry.doc), ...said } });
      // A conflict, a walk the document refuses, or one that changes nothing: walked all the same.
      const skipped = ledger.skip({ doc: entry.doc, ...by, undoes: entry.id });
      options.committed?.();
      respond({ result: { doc: entry.doc, ops: [], inverse: [], version: skipped.version, entry: skipped.entry, ...said } });
    } finally {
      if (!subscriptions.has(entry.doc)) cache.delete(entry.doc); // loaded for this walk only
    }
  };
  /**
   * With `auth`, a walk passes the gate (401) and writes to its entry's
   * document only for one who owns it (404): asked of the
   * cursor's next entry, which the walk then takes alone (409 if it has
   * moved on meanwhile).
   */
  const walkAs = (way: "undo" | "redo") => {
    const walked = underLock(walk(way));
    return (msg: any, client: any, respond: (r: any) => void) => {
      if (!auth) return walked(msg, client, respond);
      const g = gated(client);
      if ("error" in g) return respond(g);
      const next = nextWalk(way, msg, client);
      const entry = "error" in next ? undefined : next.entry;
      const owns = entry && findDoc(entry.doc) ? ownsOf(entry.doc) : undefined;
      if (!entry || !owns) return walked(msg, client, respond);   // another registration's: it asks its own owns
      return whenOwned(owns(g.identity, entry.doc), respond, () => walked(msg.entry == null ? { ...msg, entry: entry.id } : msg, client, respond));
    };
  };
  ws.on("undo", walkAs("undo"));
  ws.on("redo", walkAs("redo"));
  // A document's recent history, to whoever may open it: each entry says `mine`, never who wrote it.
  ws.on("history", guarded((msg, client, respond) => {
    const match = findDoc(msg.doc);
    if (!match) return;
    let there: unknown;
    try { there = match.def.implied || readDoc(db, schema, match.def, resolveScope(match.def, match.docId)); }
    catch (err: any) { return respond({ error: failure(named(err)) }); }
    if (!there) return respond({ error: NOT_FOUND });
    respond({ result: ledger.history(msg.doc, cursorOf(msg, client), msg.limit).map((e) => ({ ...e, ops: showOps(match.def, schema, e.ops), inverse: showOps(match.def, schema, e.inverse) })) });
  }));
}
