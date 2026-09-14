import * as sessionDoc from "../documents/session";
import type { Concept } from "./concept";
import { broadcastPeople } from "./room";

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
      const { room } = sessionDoc.read(ws.data.sessionId);
      sessionDoc.patch(ws.data.sessionId, [{ op: "remove", path: "/name" }], ws);
      if (room) broadcastPeople(room);
    },
  },
  render(sessionId) {
    const { name } = sessionDoc.read(sessionId);
    return name ? undefined : renderNameForm();
  },
};
