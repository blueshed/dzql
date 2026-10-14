# Controls

A control says what it writes, and the kernel's client sends it: a form, a button, a field that
edits in place. The messages are [wire.md](wire.md); the line that says why is [refusal.md](refusal.md).

```ts
// examples/chat/compartments/room.ts: a form that creates, and a button
`<form class="say" aria-label="Say something"${write("room", "add", "/messages/-")}><input name="text" autocomplete="off" required autofocus aria-label="Message"><button type="submit" class="tool">Send</button></form>`
`<button type="button" class="tool"${write("session", "replace", "/before", "earlier")}>Earlier</button>`

// examples/leave/page.ts: an editing form, each field writing its own path when it changes
const field = (which: "starts" | "ends", label: string) =>
  `<label class="modal-field"><span class="note">${label}</span><input type="date" name="${which}"${write(doc, "replace", `${base}/${which}`)} value="${esc(s[which] ?? "")}"></label>${toldAt(sessionId, doc, `${base}/${which}`)}`;
return `<form class="days" data-write-on="change">${field("starts", "First day")}${field("ends", "Last day")}</form>`;
```

`write(doc, op, path, value?)` (`src/html.ts`) gives `data-write='{"doc","op","path"}'`.

- A **form** writes on submit: its one field's value, or a record of every named field. A box is
  `true` or `false`; a group of radios one field, the value chosen or `null`; a `multiple` select its
  last choice or `null`; anything else its text. It clears as it sends.
- Refused, a form hands back what it sent into each field not typed in since; its echo ends the
  wait. What is typed while a write is on its way is kept.
- A **button or row** writes on click, with its `data-value`. A click in a field never writes.
- **`data-write-on="blur"`, `"change"` or `"input"`** edits in place: `data-write` on each field, and
  every field that differs from what was rendered is one op in one message. `"input"` is debounced
  about 150ms and sent when focus leaves. The same message is not sent twice until a write lands.
- A field typed in sends first a `test` of what it was drawn with: someone else's change drawn under
  the caret is not written over unseen. Refused so, the field shows what is drawn: put `toldAt`
  beside it.
- A render that changes a field nobody is in shows the new value; a field someone is in keeps what
  they type. A select, box or radio keeps a choice not yet drawn, and goes only when it differs.
  An editing form never sends a `multiple` select.
- Escape (which presses the last `[data-escape]`) and the back button first send the editing form
  someone is in.
- The socket gone: the page stays, `inert`, `#app[data-offline]`, and says "Reconnecting…" (`.connection`).
  A write made while down is not sent; one on its way is unanswered, and the page drawn afresh hands
  back what its form sent, and each editing form says once any edit that page does not show.
- A change from someone else is drawn in silently.
- `autofocus`: focused after a render only when nothing else has the caret. `data-autoscroll` keeps
  a list at its foot as it grows.
- Label what an assistant should use, in your own words (`aria-label`, `<legend>`, `<label>`):
  the label is its tool's name ([assistants.md](assistants.md)).
- The page's address (`data-page-write`) is the URL bar's, not a control ([bento.md](bento.md#where-you-are-the-address)).
