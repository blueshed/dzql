import type { Resource } from "dzql/rendering/resources/resource";
import { parseAddress } from "dzql/rendering/bento";
import type { PatchOp } from "dzql/rendering/json-patch";
import { addressOf, moveTab, type Tab } from "dzql/rendering/tabs";
import { placed, read } from "./visit-api";

// The visit's resource: somewhere for a tab to stand, once you are someone (the kernel moves the
// tab, never the visit), and signing out -- never who you are, nor your table, which a link and a
// scan say (../../routes.ts).
export const visit: Resource = {
  docType: "visit",
  perSession: true,
  ledger: false, // where a person is, is not the cafe's history
  under: "/visits",
  resolveDoc: (ws) => ws.data.sessionId,
  permit: (ws, op) => read(ws.data.sessionId).role !== null && ((op.op === "replace" && op.path === "/page") || (op.op === "remove" && op.path === "/role")),
  shape(ws, _id, ops) {
    const { role } = read(ws.data.sessionId);
    return ops.flatMap((op): PatchOp[] => {
      // signing out: nobody again, at no table, and this tab back at the door
      if (op.op === "remove") return [{ op: "replace", path: "/role", value: null }, { op: "replace", path: "/table", value: null }, { op: "replace", path: "/page", value: "" }];
      const page = placed(role!, op.value);
      return page === undefined ? [] : [{ op: "replace", path: "/page", value: page }];
    });
  },
};

/** A write done from a drawer or a modal puts it away: the writer's tab goes back to the page beneath (but a table, seated, stays open: its invoice is there). */
export function backToPage(ws: Tab): void {
  const { path, what } = parseAddress(addressOf(ws));
  if (what !== undefined && what !== "table") moveTab(ws, path);
}
