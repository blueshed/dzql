import type { Resource } from "dzql/rendering/resources/resource";
import { backToPage } from "../visit/visit";
import { read as visitOf } from "../visit/visit-api";
import { may, shape } from "./floor-api";

const isManager = (sessionId: string): boolean => visitOf(sessionId).role === "manager";

// The floor's resource: the manager's, a list (its id is empty: `floor:`).
export const floor: Resource = {
  docType: "floor",
  resolveDoc: (ws) => (isManager(ws.data.sessionId) ? "" : undefined),
  permit: (ws, op) => isManager(ws.data.sessionId) && may(op),
  shape: (_ws, _id, ops) => shape(ops),
  afterWrite: (ws) => backToPage(ws),
};
