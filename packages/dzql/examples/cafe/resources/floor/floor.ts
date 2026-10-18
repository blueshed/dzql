import type { Resource } from "dzql/rendering/resources/resource";
import { backToPage } from "../visit/visit";
import { read as visitOf } from "../visit/visit-api";
import { may, read, shape } from "./floor-api";

const isStaff = (sessionId: string): boolean => ["manager", "cook"].includes(visitOf(sessionId).role ?? "");

// The floor's resource: the staff's, a list (its id is empty: `floor:`).
export const floor: Resource = {
  docType: "floor",
  resolveDoc: (ws) => (isStaff(ws.data.sessionId) ? "" : undefined),
  permit: (ws, op) => isStaff(ws.data.sessionId) && may(op),
  shape: (_ws, _id, ops) => shape(ops, read()),
  afterWrite: (ws) => backToPage(ws.data.sessionId),
};
