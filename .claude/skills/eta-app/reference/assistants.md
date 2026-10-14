# Assistants: the page's writes as tools

An assistant in the browser (Claude in Chrome, or any agent the browser lets in) uses a page by its
writes, not its pixels, where the app opts in. The writes are [wire.md](wire.md).

```ts
// examples/chat/client/main.ts
import "../../../src/client/app";
import "../../../src/client/tools"; // one line, for this app alone
```

```ts
// examples/chat/compartments/room.ts: labelled by the app, so this form is the tool `say_something`
`<form class="say" aria-label="Say something"${write("room", "add", "/messages/-")}>…</form>`
```

After each drawing the client reads the page into tools (`src/client/tools.ts`).

- A tool is each labelled control a person could press now (not `inert`, `hidden` or disabled), so
  an open modal's controls are the tools and the ground behind it offers none: a form that creates;
  an editing form (one tool, any of its fields, by name); the buttons of one label (one tool, told
  which by what differs between their writes); an applet's `appletWrites`; `undo` and `redo`, with
  an optional `change`.
- A tool is named and described only by the app's own label -- an `aria-label`, a form's `<legend>`,
  a field's `<label>` -- at most 80 characters, never what the control shows: that may be anyone's
  words, and an assistant reads a description as an instruction. A control with no label of the
  app's is no tool. Label what an assistant should use, in your own words.
- A tool sends only what its control could (a select's own choices, a box's tick, one of its
  buttons), and the server permits it as it does a person's. `change` in its answer names it, for
  `undo`.
- `window.eta.send` is not a tool: it sends what a script gives it. What stops a write no control
  offers is the server's `permit`.
- Where the browser has a model context (`document.modelContext`, WebMCP) each tool is registered
  with it, and withdrawn when it goes or changes. Elsewhere `window.eta.tools()` lists them and
  `window.eta.use(name, input)` runs one.
- `examples/chat/client/tools.test.ts` is the proof: an assistant says something, the person says
  something after it, and the assistant undoes its own, by its handle.
