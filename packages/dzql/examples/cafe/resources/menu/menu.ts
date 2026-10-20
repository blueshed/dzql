import type { Resource } from "dzql/rendering/resources/resource";
import { backToPage } from "../visit/visit";
import { read as visitOf } from "../visit/visit-api";
import { may, shape } from "./menu-api";

// The menu's resource: the cook's and the customers', a list (`menu:`).
export const menu: Resource = {
  docType: "menu",
  resolveDoc: (ws) => (["cook", "customer"].includes(visitOf(ws.data.sessionId).role ?? "") ? "" : undefined),
  permit: (_ws, op) => may(op),
  shape: (_ws, _id, ops) => shape(ops),
  afterWrite: (ws) => backToPage(ws),
};
