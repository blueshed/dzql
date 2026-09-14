import type { ServerWebSocket } from "bun";
import * as sessionDoc from "../documents/session";
import type { ConnectionData } from "../connection";
import { patchMessage } from "../json-patch";
import { createEvent } from "./bus";
import type { Concept } from "./concept";

export const sessionEnded = createEvent<{ ws: ServerWebSocket<ConnectionData>; sessionId: string }>();

function renderNameForm(): string {
  return `
    <form data-event="set-name">
      <label for="name">Enter your name</label>
      <input id="name" name="name" autocomplete="off" autofocus required />
      <button type="submit">Continue</button>
    </form>
  `;
}

// Only this connection's own session can ever see its session document, so
// the echo is a direct send rather than a broadcast (compare room's).
export function echoOwnSession(ws: ServerWebSocket<ConnectionData>, result: sessionDoc.SessionPatchResult) {
  if (result.applied.length === 0) return;
  ws.send(patchMessage(`session:${ws.data.sessionId}`, result.version, result.applied));
}

export const session: Concept = {
  events: {
    "set-name": (ws, payload) => {
      const result = sessionDoc.patch(ws.data.sessionId, [{ op: "replace", path: "/name", value: payload.name }]);
      echoOwnSession(ws, result);
    },
    logout: (ws) => {
      sessionEnded.emit({ ws, sessionId: ws.data.sessionId });
      const result = sessionDoc.patch(ws.data.sessionId, [{ op: "remove", path: "/name" }]);
      echoOwnSession(ws, result);
    },
  },
  render(sessionId) {
    const { name } = sessionDoc.read(sessionId);
    return name ? undefined : renderNameForm();
  },
};
