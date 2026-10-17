# The page, and the parts it is sent in

`render(sessionId)` draws one person's whole page as HTML; after a write each page that read the
document is drawn again and sent only the parts that changed. How it looks is [bento.md](bento.md).

```ts
// examples/chat/compartments/room.ts (trimmed)
export function render(sessionId: string): string {
  const { name, room: current, before } = sessionDoc.read(sessionId);
  const page = !name ? renderNameForm() : !current ? renderRooms(name, roomDoc.list()) : renderRoom(name, current, roomDoc.people(current), before, roomDoc.read(current, before));
  return layers(page, "", ""); // the bento's frame, nothing open over it
}
// in renderRoom: who is here, and the messages, each message a part of its own
part("people", `<ul id="people" class="people" aria-label="Here">${people.map(who).join("")}</ul>`),
part("messages", `<ul class="messages" id="messages" data-autoscroll>${messages.map((m, i) => renderMessage(m, i, messages, name)).join("")}</ul>`),
// renderMessage
return part(`m${message.id}`, `<li id="m${message.id}"${mine ? ' class="mine"' : ""}>…</li>`);
```

A message said goes as its one `<li>`, put in after the last; were the messages not parts, every
message would send the whole conversation again. `part(key, html)` is `src/parts.ts`.

- `render` is the only renderer: it decides which screen, and reads whichever documents it must. It
  must `read()` what it shows, or its page is not told of a change ([compartment.md](compartment.md#who-sees-what)).
- A compartment looks after a document, not a place on the page.
- A part is the unit of a message: a change goes as the smallest part that holds it, whole. Make
  what changes alone -- a row, a card, a count -- a part of its own.
- Parts already: the bento's cells, the open window, rows with an id, lists given a key
  (`rows(items, empty, key)`) and drawers. Name the rest where a change should travel alone.
- What is sent: a part whose own tag alone changed, its tag; a part whose inside changed, replaced
  (morphed in place); a list of parts, rows put in and taken out (a list that was empty, or whose
  rows changed order, replaced); a keyed row may move from one list to another; the page whole only
  when its own outline changed.
- A key is unique on its page: two different things under one key are no part, and what holds them
  is sent instead.
- Drawers and modals go through `layers(page, drawer, modal)` (`src/bento.ts`): two layers, always
  there, empty when nothing is open. A modal puts the ground `inert` by its tag; while a modal is
  open, and below 820px a drawer, the page behind holds still.
- Make the page's outermost element a part (the wedding's `.site`), so its class and `data-page` go
  as a tag.
- A mount that watches a document (`data-doc`) is compared without that document and without what
  is inside it ([applets.md](applets.md)).
- The client morphs, never replaces `innerHTML`, and never goes inside a `[data-applet]`.
- The stories check the result: each member's page, rebuilt from exactly what they were sent, must
  equal a fresh render.
