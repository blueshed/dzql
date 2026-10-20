import type { Resource } from "dzql/rendering/resources/resource";
import { backToPage } from "../visit/visit";
import { read as visitOf } from "../visit/visit-api";
import { KITCHEN, may } from "./kitchen-api";

const isStaff = (sessionId: string): boolean => ["manager", "cook"].includes(visitOf(sessionId).role ?? "");

// The kitchen's resource: the staff's, a list scoped to what is not yet placed (`kitchen:placed`).
export const kitchen: Resource = {
  docType: "kitchen",
  resolveDoc: (ws) => (isStaff(ws.data.sessionId) ? KITCHEN : undefined),
  permit: (ws, op) => isStaff(ws.data.sessionId) && may(op),
  afterWrite: (ws) => backToPage(ws),
};
