import type { ServerWebSocket } from "bun";
import * as sessionDoc from "../documents/session";
import type { SessionData } from "../session";
import { createEvent } from "./bus";
import type { Concept } from "./concept";

export const sessionEnded = createEvent<{ ws: ServerWebSocket<SessionData>; sessionId: string }>();

function renderNameForm(): string {
  return `
    <form data-event="set-name">
      <label for="name">Enter your name</label>
      <input id="name" name="name" autocomplete="off" autofocus required />
      <button type="submit">Continue</button>
    </form>
  `;
}

export const session: Concept = {
  events: {
    "set-name": (ws, payload) => {
      sessionDoc.patch(ws.data.sessionId, [{ op: "replace", path: "/name", value: payload.name }]);
    },
    logout: (ws) => {
      sessionEnded.emit({ ws, sessionId: ws.data.sessionId });
      sessionDoc.patch(ws.data.sessionId, [{ op: "remove", path: "/name" }]);
    },
  },
  render(sessionId) {
    const { name } = sessionDoc.read(sessionId);
    return name ? undefined : renderNameForm();
  },
};
