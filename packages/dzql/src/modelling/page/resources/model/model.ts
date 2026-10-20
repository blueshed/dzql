import type { Resource } from "dzql/rendering/resources/resource";
import { may, model as modelOf, MODEL, shape } from "./model-api";
import { read as sessionOf } from "../session/session-api";

// The model is the two keepers' alike: what a write to it may be is ./model-api.ts's.

export const model: Resource = {
  docType: "model",
  resolveDoc: (ws) => (sessionOf(ws.data.sessionId).person ? MODEL : undefined),
  permit: (ws, op) => sessionOf(ws.data.sessionId).person !== null && may(modelOf(), op),
  shape: (_ws, _id, ops) => shape(modelOf(), ops),
};
