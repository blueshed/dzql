import type { Resource } from "dzql/rendering/resources/resource";
import { backToPage } from "../visit/visit";
import { read as visitOf } from "../visit/visit-api";
import { read as menu } from "../menu/menu-api";
import { may, read, shape } from "./table-api";

// A table's resource: the customer's at it, the one their visit names.
export const table: Resource = {
  docType: "table",
  resolveDoc: (ws) => {
    const v = visitOf(ws.data.sessionId);
    return v.role === "customer" ? v.table! : undefined;
  },
  permit: (_ws, op) => may(op),
  shape: (_ws, id, ops) => shape(ops, read(id), menu()),
  afterWrite: (ws) => backToPage(ws.data.sessionId),
};
