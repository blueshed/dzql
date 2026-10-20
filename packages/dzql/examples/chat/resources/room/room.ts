import type { PatchOp } from "dzql/rendering/json-patch";
import type { Resource } from "dzql/rendering/resources/resource";
import { read as sessionOf } from "../session/session-api";
import { keepLobby } from "../../presence";

/** A room's conversation, kept in delta (`room:<name>`, ./room-api.ts): a message is written by someone with a name. */
export const room: Resource = {
  docType: "room",
  resolveDoc(ws) {
    return sessionOf(ws.data.sessionId).room ?? undefined;
  },
  permit(ws, op) {
    if (op.path !== "/messages/-" || op.op !== "add") return false;
    return sessionOf(ws.data.sessionId).name !== null;
  },
  // The wire says the text; the document takes a message: a new row, numbered by the store, with
  // its author and the time (its room is the document's). Blank text is no message.
  shape(ws, _room, ops) {
    const { name } = sessionOf(ws.data.sessionId);
    return ops
      .map((op) => String(op.value ?? "").trim())
      .filter((text) => text !== "")
      .map((text): PatchOp => ({ op: "add", path: "/messages/-", value: { name, text, sent_at: Date.now() } }));
  },
  // the first message in a room puts it on the list, and undoing the last takes it off
  afterChange: () => keepLobby(),
};
