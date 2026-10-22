import { refuse } from "dzql/rendering/refusal";
import type { Resource } from "dzql/rendering/resources/resource";
import { backToPage } from "../visit/visit";
import { read as visitOf } from "../visit/visit-api";
import { read as menu } from "../menu/menu-api";
import { may, paying, read, shape, unpaidOnly } from "./table-api";

// A table's resource: the customer's at it, the one their visit names; the manager's, named whole
// (`table:1`), from the floor. Paying is on the ledger and never undone: Undo passes it by, and changes nothing
// on an invoice once it is paid.
export const table: Resource = {
  docType: "table",
  resolveDoc: (ws) => {
    const v = visitOf(ws.data.sessionId);
    return v.role === "customer" ? v.table! : undefined;
  },
  permit: (ws, op) => may(op, visitOf(ws.data.sessionId).role),
  shape: (_ws, id, ops) => shape(ops, read(id), menu()),
  undoable: (_ws, _id, ops) => !paying(ops), // a payment taken is never undone; an order, or a table seated, is
  // and once paid, Undo walking past the payment takes nothing off the invoice, nor puts it back
  permitUndo: (_ws, id, ops) => {
    const why = unpaidOnly(ops, read(id));
    if (why) throw refuse(why);
    return true;
  },
  afterWrite: (ws) => backToPage(ws),
};
