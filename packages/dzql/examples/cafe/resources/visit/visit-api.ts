import { defineDoc } from "dzql/postgres";
import { address, parseAddress } from "dzql/rendering/bento";
import { read as readDoc } from "dzql/rendering/documents";
import { sessionRows } from "dzql/rendering/sessions";
import { delta, register } from "../../store";

// The visit: the model's own document (`own`), so the app's session. It holds the table a customer
// scanned, as the model says; the app adds who signed in (staff), and the cookie's hash, which is
// never in it. Where they are is each tab's own (dzql/rendering/tabs), never the visit's. Off the ledger: coming in and moving about are not the cafe's history.
// The session a cookie names is found by that hash, through `cookie:` (the model already names a
// document `visit`, sessionRows' default lookup). A visit lasts thirty days unused, renewed as it
// is used, by when it was last (`seen`, never in the visit either); past them its cookie is nobody,
// and the visits past them are let go through `expired:`.
register(
  [
    defineDoc("visit:", { root: "visits", include: [], implied: true, columns: { visits: ["table", "role", "name"] } }),
    defineDoc("cookie:", { root: "visits", scope: { cookie: ":cookie" }, include: [] }),
    defineDoc("expired:", { root: "visits", scope: { seen: "<:before" }, include: [] }),
  ],
  { ledger: false },
);

/** The sessions, a visit each, named by the cookie a browser carries, each lasting thirty days unused. */
export const sessions = sessionRows(delta, "visits", "cookie:", { seen: "seen", expired: "expired:" });

export type Role = "manager" | "cook" | "customer";
export type Visit = { role: Role | null; name: string | null; table: string | null };

/** Who a session is: staff by their role, a customer once they have scanned a table, else nobody yet. */
export function read(sessionId: string): Visit {
  const v = readDoc<{ visits?: { role?: string | null; name?: string | null; table?: string | number | null } }>(`visit:${sessionId}`)?.visits ?? {};
  const table = v.table == null ? null : String(v.table);
  const role = (v.role ?? (table ? "customer" : null)) as Role | null;
  return { role, name: v.name ?? null, table };
}

/** The places each person's tabs may stand, and what may open over them there. */
const PLACES: Record<Role, Record<string, string[]>> = {
  manager: { "": [], tables: ["table", "new"], ready: ["order"] },
  cook: { "": [], orders: ["order"], menu: ["item", "new", "confirm"] },
  customer: { "": [], menu: ["item"], invoice: [] },
};

/** Is a URL's path one of the cafe's screens, a place someone may stand (`tables`, `menu`)? Any other is 404 (the app's `screens`). */
export const isScreen = (path: string): boolean => Object.values(PLACES).some((places) => Object.hasOwn(places, path));

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
