import { defineDoc, registerDocs } from "@blueshed/delta/sqlite";
import { address, parseAddress } from "dzql/rendering/bento";
import { read as readDoc } from "dzql/rendering/documents";
import { sessionRows } from "dzql/rendering/sessions";
import { db, delta, schema } from "../../store";

// The visit: the model's own document (`own`), so the app's session. It holds the table a customer
// scanned, as the model says; the app adds who signed in (staff), where they are, and the cookie's
// hash, which is never in it. Off the ledger: coming in and moving about are not the cafe's history.
// The session a cookie names is found by that hash, through `cookie:` (the model already names a
// document `visit`, sessionRows' default lookup).
registerDocs(delta.server, db, schema, [
  defineDoc("visit:", { root: "visits", include: [], implied: true, columns: { visits: ["table", "role", "name", "page"] } }),
  defineDoc("cookie:", { root: "visits", scope: { cookie: ":cookie" }, include: [] }),
]);

/** The sessions, a visit each, named by the cookie a browser carries. */
export const sessions = sessionRows(delta, "visits", "cookie:");

export type Role = "manager" | "cook" | "customer";
export type Visit = { role: Role | null; name: string | null; table: string | null; page: string };

/** Who a session is -- staff by their role, a customer once they have scanned a table, else nobody yet -- and where they are. */
export function read(sessionId: string): Visit {
  const v = readDoc<{ visits?: { role?: string | null; name?: string | null; table?: string | number | null; page?: string | null } }>(`visit:${sessionId}`)?.visits ?? {};
  const table = v.table == null ? null : String(v.table);
  const role = (v.role ?? (table ? "customer" : null)) as Role | null;
  return { role, name: v.name ?? null, table, page: v.page ?? "" };
}

/** The places each person may stand, and what may open over them there. */
const PLACES: Record<Role, Record<string, string[]>> = {
  manager: { "": [], tables: ["table", "new"], ready: ["order"] },
  cook: { "": [], orders: ["order"], menu: ["item", "new", "confirm"] },
  customer: { "": [], menu: ["item"], invoice: [] },
};

/** An address `role` may stand at, or undefined. */
export function placed(role: Role, value: unknown): string | undefined {
  const { path, what, which = "" } = parseAddress(String(value ?? ""));
  const opens = PLACES[role][path];
  if (!opens) return undefined;
  if (what === undefined) return path;
  if (!opens.includes(what)) return undefined;
  if (what === "new") return address(path, what);
  return /^\d+$/.test(which) ? address(path, what, which) : undefined;
}
