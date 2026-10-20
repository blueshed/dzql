/**
 * An app's documents on Postgres in one call, as delta's SQLite takes them:
 * `registerDocs(ws, pool, schema, docs, customDocs, options)` is
 * `registerDocs(ws, db, schema, docs, customDocs, options)` from `@blueshed/delta/sqlite`,
 * awaited, so an app moving from SQLite changes its import, not the shape of its code. The
 * documents are compiled into the database (`generateSql`, applied), each answered as its
 * definition says (`docTypeFromDef`), and one listener serves them and the custom documents on
 * `ws`. The framework goes first (`applyFramework`), and the tables with the app's migrations;
 * `openStore` does all of it.
 */
import type { Pool } from "pg";
import type { DeltaAuth } from "@blueshed/delta/auth";
import { authless, ownerless } from "@blueshed/delta/auth";
import type { DocDef, Schema, WsServer } from "@blueshed/delta/backend";
import { applySql } from "./bootstrap";
import { generateSql } from "./codegen";
import { createDocListener, type CustomDocDef } from "./listener";
import { docTypeFromDef } from "./registry";

/** SQLite's options (`RegisterOptions` in `@blueshed/delta/sqlite`), and the Postgres schema the app is kept in. */
export interface RegisterOptions<I = unknown> {
  /** Keep the ledger (undo, redo, history); `{ except: [prefix...] }` for every document but those. */
  ledger?: boolean | { except: string[] };
  /** How an identity is written in the ledger. Default: a string or number as it is, anything else as JSON. */
  who?: (identity: I) => string;
  /** The gate every action passes, and the identity it gives: who writes, who a custom document is read as. */
  auth?: DeltaAuth<I>;
  /** With `auth`: who may have a document that says no path of its own. This or `shared` is required for one. */
  owns?: (identity: I, docName: string) => boolean | Promise<boolean>;
  /** With `auth`: every identity that passes the gate may have every document here that says no path. */
  shared?: boolean;
  /** The Postgres schema the app is in, when it is not `public`: the pool must run in it (`openDatabase(url, { namespace })`). */
  namespace?: string;
}

/** The listener for `docs` and `customDocs`, compiled already: `registerDocs` without its `generateSql`, as `openStore` serves them after its `prepare`. */
export function serveDocs<I = unknown>(ws: WsServer, pool: Pool, schema: Schema, docs: DocDef[], customDocs: CustomDocDef<any, I>[] = [], options: RegisterOptions<I> = {}) {
  const { auth, owns, shared } = options;
  // as SQLite refuses them, by this call's name: with auth, a document says who has it (a path, or owns, or shared)
  if (auth) {
    const unsaid = docs.filter((d) => d.owns === undefined);
    if (unsaid.length && !owns && !shared) throw ownerless(unsaid.map((d) => d.prefix).join(", "), "registerDocs");
  } else if (owns || shared || docs.some((d) => d.owns !== undefined)) {
    throw authless(docs.map((d) => d.prefix).join(", "), "registerDocs");
  }
  const types = docs.map((def) => docTypeFromDef<I>(def, pool, def.owns === undefined ? { auth, owns, shared } : { auth }));
  return createDocListener<I>(ws, pool, { types, custom: customDocs, auth, ledger: options.ledger, who: options.who, schema, namespace: options.namespace });
}

/** Every document compiled into the database, then served on `ws`, with the custom documents beside them. */
export async function registerDocs<I = unknown>(ws: WsServer, pool: Pool, schema: Schema, docs: DocDef[], customDocs: CustomDocDef<any, I>[] = [], options: RegisterOptions<I> = {}) {
  await applySql(pool, generateSql(schema, docs), { namespace: options.namespace });
  return serveDocs(ws, pool, schema, docs, customDocs, options);
}
