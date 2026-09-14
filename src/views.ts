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

function renderRoomButton(room: string): string {
  return `<li><button data-event="join-room" data-room="${escapeHtml(room)}">${escapeHtml(room)}</button></li>`;
}

function renderRoomSelector(name: string, rooms: string[]): string {
  return `
    <div class="user-bar">
      <span class="user-label">${escapeHtml(name)}</span>
      <button data-event="logout">Log out</button>
    </div>
    <h2>Rooms</h2>
    ${rooms.length ? `<ul class="room-list">${rooms.map(renderRoomButton).join("")}</ul>` : "<p>No rooms yet &mdash; start one below.</p>"}
    <form data-event="join-room">
      <label for="room">Join or create a room</label>
      <input id="room" name="room" autocomplete="off" autofocus required />
      <button type="submit">Join</button>
    </form>
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
