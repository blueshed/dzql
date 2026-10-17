# Controls: fields, forms and buttons

A control says what it writes, and the kernel's client sends it. The messages are
[wire.md](wire.md); the line that says why is [refusal.md](refusal.md).

```ts
// examples/wedding/views/household.ts: a field that edits one value of a document, in one call
field({ doc: "household", path: "/message", value: h.message, label: "Our words", kind: "textarea", placeholder: "Say something to the couple", said: v.wordsTold })
```

## A field: one call (`field()`, `src/rendering/bento.ts`)

Use `field()` for a field that edits a document: it cannot be wired wrong. Its options are
`FieldOptions` in `src/rendering/bento.ts`.

- It is its own form, writing `path` (`replace`) as it is left (text, number, email, textarea) or as
  it is made (date, select, checkbox). `on: "input"` is for a reading drawn as it is typed (find's
  word), never a document's value.
- `value` is what the page read: drawn into it, so a write typed over it tests what it was drawn with.
- `said` is `toldAt(...)` for its path, drawn beside it (`aria-describedby`).
- `may: false`, the permit's no, draws it read, not a control. `inRow` lays it out in a row, its
  label heard, not seen.
- One field is one write. Several values in one message is a form of the app's own, below.

## By hand: `write()`

```ts
// examples/chat/compartments/room.ts: a form that creates, and a button
`<form class="say" aria-label="Say something"${write("room", "add", "/messages/-")}><input name="text" autocomplete="off" required autofocus aria-label="Message"><button type="submit" class="tool">Send</button></form>`
`<button type="button" class="tool"${write("session", "replace", "/before", "earlier")}>Earlier</button>`
```

`write(doc, op, path, value?)` (`src/rendering/html.ts`) gives `data-write='{"doc","op","path"}'`.

- A **form** writes on submit: its one field's value, or a record of every named field. A box is
  `true` or `false`; a number field a number, or `null` when empty; a group of radios one field, the
  value chosen or `null`; a `multiple` select its last choice or `null`; anything else its text (a
  date its day, `"2026-10-14"`). It clears as it sends.
- Refused, a form hands back what it sent into each field not typed in since; its echo ends the
  wait. What is typed while a write is on its way is kept.
- A **button or row** writes on click, with its `data-value`: JSON, so the value goes with its type
  (`write(…, true)` sends `true`, not `"true"`). A permit takes the type it draws. A click in a field
  never writes.
- **`data-write-on="blur"`, `"change"` or `"input"`** on a form edits in place (leave's day fields):
  `data-write` on each field, and every field that differs from what was rendered is one op in one
  message. `"input"` is debounced about 150ms. The same message is not sent twice until a write lands.
- A field typed in sends first a `test` of what it was drawn with, so someone else's change under the
  caret is not written over unseen. Refused so, the field shows what is drawn.
- A render that changes a field nobody is in shows the new value; a field someone is in keeps what
  they type. A select, box or radio keeps a choice not yet drawn. An editing form never sends a
  `multiple` select.
- Escape (which presses the last `[data-escape]`) and the back button first send the editing form
  someone is in.
- The socket gone: the page stays, `inert`, `#app[data-offline]`, saying "Reconnecting…". A write made while down is not
  sent; one on its way is unanswered, and the page drawn afresh hands back what its form sent.
- `autofocus` is taken only when nothing else has the caret. `data-autoscroll` keeps a list at its foot.
- Label what an assistant should use, in your own words (`aria-label`, `<legend>`, `<label>`): the
  label is its tool's name ([assistants.md](assistants.md)).
