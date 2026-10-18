import type { Resource } from "dzql/rendering/resources/resource";
import { serverWrite } from "dzql/rendering/documents";
import { parseAddress } from "dzql/rendering/bento";
import type { PatchOp } from "dzql/rendering/json-patch";
import { placed, read } from "./visit-api";

// The visit's resource: somewhere to stand, once you are someone, and signing out -- never who you
// are, nor your table, which a link and a scan say (../../routes.ts).
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
      // signing out: nobody again, at no table, back at the door
      if (op.op === "remove") return [{ op: "replace", path: "/role", value: null }, { op: "replace", path: "/table", value: null }, { op: "replace", path: "/page", value: "" }];
      const page = placed(role!, op.value);
      return page === undefined ? [] : [{ op: "replace", path: "/page", value: page }];
    });
  },
};

/** A write done from a drawer or a modal puts it away: the writer goes back to the page beneath (but a table, seated, stays open: its invoice is there). */
export async function backToPage(sessionId: string): Promise<void> {
  const { path, what } = parseAddress(read(sessionId).page);
  if (what !== undefined && what !== "table") await serverWrite(`visit:${sessionId}`, [{ op: "replace", path: "/visits/page", value: path }]);
}
