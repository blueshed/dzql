import type { Resource } from "dzql/rendering/resources/resource";
import { read as sessionOf } from "../session/session-api";

/** Who is in a room: live, kept by the server (../../presence.ts), written by nobody on the wire. */
export const here: Resource = {
  docType: "here",
  kind: "memory",
  resolveDoc(ws) {
    return sessionOf(ws.data.sessionId).room ?? undefined;
  },
};
