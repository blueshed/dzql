import * as clockDoc from "../documents/clock";
import type { Resource } from "dzql/rendering/resources/resource";

// A session's clock: its own to write, seen by nobody else. The clock applet names this document
// and takes the `replace /tz` itself, so the face and the hands follow at once; the page says the
// city too (on the clock's resource, in its drawer), so the write is answered with the page,
// and the applets, being a morph boundary, are left as they are. Undo and Redo walk the choice of
// city like any write.

export const clock: Resource = {
  docType: "clock",
  perSession: true, // keyed by the session id: this session's alone
  under: "/clocks", // eta's `/tz` is the document's `/clocks/tz`
  // No render(): the ticker resource renders the page, the clock within it.
  resolveDoc(ws) {
    return ws.data.sessionId;
  },
  permit(_ws, op) {
    return op.op === "replace" && op.path === "/tz";
  },
  shape(_ws, sessionId, ops) {
    const { tz } = clockDoc.read(sessionId);
    const next = clockDoc.after(tz, ops);
    return next === tz ? [] : [{ op: "replace", path: "/tz", value: next }];
  },
};
