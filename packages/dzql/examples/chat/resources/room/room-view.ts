import { part } from "dzql/rendering/parts";
import { esc, join, write } from "dzql/rendering/html";
import { surfaces } from "../../surfaces";
import { face, renderPeople } from "../here/here-view";
import type { ChatMessage } from "./room-api";

// The room's part of the page: its conversation, and the one form that says something, with who
// is here across its head.

const { collectionPage } = surfaces;

/**
 * A message is a bubble, and a part: yours on the right, everyone else's on the left. A run is
 * said once, at its start: another's face and name, or, for yours, "You" to a reader, who cannot
 * see which side it sits on. The rest of another's run keep the face's place, empty.
 */
function renderMessage(message: ChatMessage, index: number, messages: ChatMessage[], viewer: string): string {
  const mine = message.name === viewer;
  const firstOfRun = index === 0 || messages[index - 1]!.name !== message.name;
  const mark = mine ? "" : firstOfRun ? face(message.name, false) : `<span class="face-gap"></span>`;
  const who = !firstOfRun ? "" : mine ? `<span class="sr-only">You</span>` : `<span class="name">${esc(message.name)}</span>`;
  return part(`m${message.id}`, `<li id="m${message.id}"${mine ? ' class="mine"' : ""}>${mark}<div class="body">${who}<span class="bubble">${esc(message.text)}</span></div></li>`);
}

/**
 * Say something: the room's conversation, and the form at its foot. "Chat" in the trail is the way
 * back to the rooms. Fifty messages at a time (./room-api.ts): "Earlier" at their head while
 * there are more, and reading back, "Latest" at the foot in place of the form. Another fifty
 * share no message with these, so the conversation goes whole, as a room does when you go in.
 */
export function renderRoom(name: string, room: string, people: string[], before: number | null, { messages, earlier }: { messages: ChatMessage[]; earlier: boolean }): string {
  return collectionPage([{ label: "Chat", back: write("session", "remove", "/room") }, { label: `#${room}` }], {
    key: "conversation",
    body: join(
      renderPeople(people, name),
      part(
        "messages",
        `<ul class="messages" id="messages" data-autoscroll>${earlier ? `<li class="earlier"><button type="button" class="tool"${write("session", "replace", "/before", "earlier")}>Earlier</button></li>` : ""}${messages.map((m, i) => renderMessage(m, i, messages, name)).join("")}</ul>`,
      ),
      part(
        "foot",
        `<div class="foot">${
          before === null
            ? `<form class="say" aria-label="Say something"${write("room", "add", "/messages/-")}><input name="text" autocomplete="off" required autofocus placeholder="Message" aria-label="Message"><button type="submit" class="tool">Send</button></form>`
            : `<button type="button" class="tool"${write("session", "remove", "/before")}>Latest</button>`
        }</div>`,
      ),
    ),
  });
}
