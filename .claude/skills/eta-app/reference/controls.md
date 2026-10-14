# Controls

How a form, a button or a field says what it writes, and what it does as the write goes, is refused or lands. The messages are [wire.md](wire.md); the line that says why is `toldAt` ([compartment.md](compartment.md#saying-why-a-write-was-refused-or-what-one-did)).

A control says what it writes with `write(doc, op, path, value?)`, which gives
`data-write='{"doc","op","path"}'`:

```ts
`<form${write("room", "add", "/messages/-")}><input name="text" required>…</form>`
```

- A **form** writes on submit: its one field's value, or a record of several. A field has one
  type whatever form it is in: a box is `true` or `false`, a group of radios is one field, the
  value chosen or `null`, a `multiple` select its last choice or `null`, anything else its text.
  A record keeps every named field's key, so a value keeps one shape. It clears as it sends. Its
  write's own refusal (`refused`, by the write's id, before the page handed back) hands back what
  was sent, into each field not typed in since; its own echo ends the wait. What is typed while a
  write is on its way is kept, whoever's echo comes, and so is what a page sent whole for another
  reason finds there (someone else's write turning the page into another). A write on its way
  when the socket goes is unanswered: the page drawn afresh hands back what its form sent, as a
  refusal would (it may have landed, which that page then shows: better there twice than lost),
  and then each editing form says, once, any edit that page does not show -- one unanswered, or
  one the closed socket never took; one that landed is drawn, and not said again.
- A **button or row** writes on click, with its `data-value` if it has one. A click in a field
  never writes.
- A form with **`data-write-on="blur"`, `"change"` or `"input"`** edits in place: `data-write`
  goes on each field, and every field whose value differs from what was rendered becomes one op
  in one message. `"input"` is debounced about 150ms and sent when focus leaves. None of them
  sends the same message twice until a write lands; after that (an echo, an undo) it may. A render that changes a field nobody is in shows the new value (an undo's), so it is not
  sent again; a field someone is in keeps what they type. So a field typed in (not a box, a radio
  or a select) sends, before its op, a `test` of what it was drawn with when its typist last saw
  it drawn: a change from someone else drawn under the caret is not written over unseen. Refused
  so, the field shows what is drawn; draw `toldAt` beside it to say why. A select was rendered showing the last
  option drawn `selected`, else its first not disabled; it keeps a choice not yet drawn, by its
  value, however its options move, and otherwise shows what is drawn. A box was rendered ticked
  or not (`checked`), a group of radios with the value drawn `checked`; each goes only when what
  it holds differs, as it would from a form that creates. It keeps a tick not yet drawn (a
  radio's by its value, while its group offers it) and otherwise shows what is drawn. A
  `multiple` select is not a field here (a write carries one value): an editing form never sends
  it, nor a refusal hands it back. Escape (which presses the last `[data-escape]`) and the back
  button first say the editing form someone is in, as leaving its field would: a drawer's words
  are not lost with it, though WebKit fires no `focusout` for a field a render takes out.

Also:

- The stories count a control only where a person could press it: not drawn `disabled`, and not
  `inert`, `hidden` or in a disabled fieldset, itself or by what it is in. So a story told from a
  modal is done in the modal: the page behind it, inert, offers nothing. The page's address
  (`data-page-write`) is the URL bar's, not a control: a story that goes somewhere needs the
  button that goes there.
- When the connection drops, the page stays as it was (what is typed, what applets hold), but
  `inert`, and `#app` is marked `data-offline` (`src/bento.css` dims it) until the server, reached
  again, draws it afresh. The client says "Reconnecting…" in a `role="status"` region it puts
  beside `#app` (`.connection`), since what is inert is not read out. It says nothing else: a
  change from someone else is drawn in silently, as a change speaks to the person who made it. A write made while it is down is not sent, nor taken
  for sent: a form keeps what is typed, and an editing form says it once the page is drawn afresh.
- `autofocus` means "this field is waiting for the caret": after a render the client focuses it,
  but only when nothing else has the caret.
- `data-autoscroll` keeps a list at its foot as it grows.
