import type { Resource } from "dzql/rendering/resources/resource";
import { backToPage } from "../visit/visit";
import { read as visitOf } from "../visit/visit-api";
import { read as menu } from "../menu/menu-api";
import { may, read, shape } from "./table-api";

// A table's resource: the customer's at it, the one their visit names; the manager's, named whole
// (`table:1`), from the floor.
export const table: Resource = {
  docType: "table",
  resolveDoc: (ws) => {
    const v = visitOf(ws.data.sessionId);
    return v.role === "customer" ? v.table! : undefined;
  },
  permit: (ws, op) => may(op, visitOf(ws.data.sessionId).role),
  shape: (_ws, id, ops) => shape(ops, read(id), menu()),
  afterWrite: (ws) => backToPage(ws),
};
