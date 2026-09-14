import { type ChatMessage, getMessages, getSessionName, getSessionRoom, listRooms } from "./db";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderNameForm(): string {
  return `
    <form data-event="set-name">
      <label for="name">Enter your name</label>
      <input id="name" name="name" autocomplete="off" autofocus required />
      <button type="submit">Continue</button>
    </form>
  `;
}

function renderRoomSelector(name: string, rooms: string[]): string {
  const props = escapeHtml(JSON.stringify({ rooms }));
  return `
    <div class="user-bar">
      <span class="user-label">${escapeHtml(name)}</span>
      <button data-event="logout">Log out</button>
    </div>
    <h2>Rooms</h2>
    <div data-applet="room-picker" data-props="${props}"></div>
  `;
}

export function renderMessage(message: ChatMessage): string {
  return `<li><strong>${escapeHtml(message.name)}:</strong> ${escapeHtml(message.text)}</li>`;
}

function renderChat(name: string, room: string, messages: ChatMessage[]): string {
  return `
    <div class="user-bar">
      <span class="user-label">${escapeHtml(name)}</span>
      <span class="room-label">#${escapeHtml(room)}</span>
      <button data-event="leave-room">Change room</button>
      <button data-event="logout">Log out</button>
    </div>
    <ul class="messages" data-autoscroll>${messages.map(renderMessage).join("")}</ul>
    <form data-event="send-message">
      <input name="text" autocomplete="off" required autofocus />
      <button type="submit">Send</button>
    </form>
  `;
}

export function renderFor(sessionId: string): string {
  const name = getSessionName(sessionId);
  if (!name) return renderNameForm();

  const room = getSessionRoom(sessionId);
  if (!room) return renderRoomSelector(name, listRooms());

  return renderChat(name, room, getMessages(room));
}
