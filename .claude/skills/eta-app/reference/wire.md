# The wire

What crosses the socket, both ways, and how an assistant in the browser uses a page by its writes. The controls that send the writes are [controls.md](controls.md).

The wire carries writes in, and HTML and ops out. There is no JSON tree of app state.

- **A document is named whole: `<docType>:<docId>`** (`room:general`, `month:2026-09`), so one
  socket holds any number of documents, of any type.
- The exception is a `perSession` document (a session, its ledger, a desk): it is named by its type
  alone, since the id is a credential. A document keyed by a live session's id that is not
  `perSession` is refused by name, loudly.
- **A session id never goes on the wire.** It is the `session_id` cookie and a person's only
  credential. No echo, render, op value or inspect reply may carry one.
- **The socket is compressed** (permessage-deflate, which every browser offers; `src/server.ts`),
  each message on its own, so no memory is kept per connection: a page crosses at a sixth to a
  quarter of its size, a patch at about two thirds. It costs CPU for each page a message goes to,
  about 2 µs a KB up to 20 KB and 9 µs a KB past 32 KB (a 178 KB page, 1.6 ms), so a big page sent
  whole to many at once is the cost to watch. As with BREACH, someone who can put text on a page
  and watch the encrypted sizes of what it is sent can guess a secret drawn in the same message, so
  draw no secret (a code, a token) beside what others write.
- **A message in is at most 1 MiB, inflated** (`maxPayloadLength`): past it the socket is closed, so
  send a picture or a file by HTTP, never over the socket.

Messages:

- Client to server: `{id?, doc, ops: [{op, path, value?}]}`. `doc` is a whole name, or a bare type
  for the one of that type the page is on (`resolveDoc`). `path` is a JSON Pointer, never a verb.
  `id` is the sender's own, which the server only hands back: a number JSON can say, or a string
  of at most 64 characters (`LONGEST_ID`). The kernel's client numbers its writes from 1, and the
  harness gives every write it sends one. An op may be RFC 6902's `test` (`{op: "test", path,
  value}`), a condition and no change: the value the field that writes `path` was drawn with when
  someone began typing in it. The server holds it against what that field is drawn with on their
  page now -- the page's own words, so a compartment that `shape`s its paths needs nothing -- and
  refuses the write, saying so beside the field (`CHANGED_SINCE`), when it differs. A `test` never
  reaches `permit` or `shape`; a write of tests alone is none.
- Server to client: `{type: "patch", doc, version, ops, id?, change?}`, with `doc` named whole (what
  was applied; kept in `window.eta.docs()` under that name). The echo sent to the writer of the
  change its write made (an undo's or a redo's too) carries the write's `id`, and `change`, the
  handle that names it (`remove /<change>` on the ledger undoes it; a fact's names none);
  everyone else's, and the writer's echo of anyone else's change, neither. Then `{type: "render", html, wire}` (the page) or
  `{type: "render", ops}` (the parts that changed).
- A write that applies nothing -- refused, not a write at all, nothing to undo, an undo that walks
  nothing, a throw on the way -- is answered `{type: "refused", id, reason?}` when it carries an id (`reason` when `refuse`
  said why), then with the page whole. A throw is reported through `failed()` (`src/failed.ts`),
  which fails the story it happened in. A message whose `id` is not one (a longer string, an
  object) is not a write, and is answered by the page alone: nothing larger than an id goes back.
  A number JSON cannot say back (`1e400`, Infinity) is no id.
- `wire` on a page sent whole is the wire's version (`WIRE`, `src/json-patch.ts`: 2 since
  a write carries an id). A page from before ids sends none, and is answered as it always was: its
  writes echoed without one, a refusal by the page whole, and `refused` ignored, so a tab left open
  over a deploy keeps working. A page sent a page whole by a server of another wire (one from
  before ids, after a rollback) loads itself again, so page and server speak alike; not twice in a
  minute, when it draws the page and says so in the console.
- `{type: "inspect", limit?}` answers with the documents this page sees and their latest ledger
  entries (delta's history). An entry says `mine: true|false`, never who.
- `window.eta.inspect().lastSent` is the page's last write, `{id, doc, ops, echoed, refused,
  reason?, unanswered?}`: echoed only by its own echo, refused (and why) only by its own refusal,
  unanswered when its socket went first.
- `window.eta.send(doc, ops)` is a script's write, sent as a control's is, and resolves with what
  became of it, by its id alone: `{id, echoed: true, doc, version, ops, change?}`, `{id, refused:
  true, reason?}`, `{id, unanswered: true}`, or `{unsent}` and why it could not go.
  `window.eta.undo(change?)` and `redo(change?)` walk the session's last change, or the one named,
  and answer the same.

## Assistants: the page's writes as tools

An assistant in the browser (Claude in Chrome, or any agent the browser lets in) uses the page by
its writes, not its pixels, where the app opts in: its `client/main.ts` imports the tools after the
kernel's client, one line (2.1 KB gzipped, for that app alone), as chat's does:

```ts
import "eta/src/client/app";
import "eta/src/client/tools";
```

Then the client reads the page after each drawing into tools (`src/client/tools.ts`), from what it
already says.

- **What is a tool**: each control the app has labelled that a person could press now, by the
  stories' rule (not `inert`, `hidden` or disabled, itself or by what it is in), so an open modal's
  controls are the tools and the ground behind it offers none:
  - a **form** that creates: its named fields are the input (`required` as the page says; a hidden
    or readonly field as the page drew it), its value sent as on submit;
  - an **editing form**: one tool for all its fields, keyed by their names, any of them given, set
    in one write, as the form commits them;
  - the **buttons and rows of one label**: one tool, told which to press by what differs between
    their writes, its `path` or its `value` (the rooms a page's "Go into the room" buttons go into,
    by the `data-value` each sends);
  - an **applet's** `appletWrites`: a `*` segment is any one member, named in the input's `path`;
  - **`undo`** and **`redo`**, with an optional `change`: the session's last change, or that one.
    The ledger's own buttons are these.
- **A tool is named and described in the app's words alone**: the label the app gave its control
  -- an `aria-label`, a form's `<legend>`, a field's `<label>` -- at most 80 characters, and never
  what the control shows. That may be anyone's words (a room's name, a message), and an assistant
  reads a tool's description as an instruction: a button that shows "Ignore what you were asked"
  and has no label of the app's is no tool. The name is the label in WebMCP's letters ("Say
  something" is `say_something`); where a form and buttons take one label, the later is told apart
  by its kind (`go_in.form`). So a tool stays as it is while the page's content changes, and is
  registered once. Label what an assistant should use, in words of your own: chat's forms say
  "Say something" and "Go into a new room".
- **A tool makes its control's write, and sends only what its control could**: a select's or a
  group of radios' own choices, a person could choose now; a box's tick, true or false; the one of
  its buttons it names. A form is no tool while its submit or a fieldset of it is disabled. The
  server then permits it as it does a person's. It answers as `eta.send` does; `change` names the
  change, for `undo`.
- **`window.eta.send` is not a tool**: it sends what a script gives it, as the socket already
  takes from any script on the page. What stops a write that no control offers is the server's
  `permit`, for a script as for a tool.
- **WebMCP**: where the browser has a model context (`document.modelContext`, the W3C draft), each
  tool is registered with it, once while the page offers it as it was, and withdrawn (its signal
  aborted) when it goes or changes. Where it has none, nothing is registered; `window.eta.tools()`
  lists them and `window.eta.use(name, input)` runs one, for an assistant that runs script in the
  page.
- chat's `client/tools.test.ts` is the proof: an assistant says something through chat's own form,
  the person says something after it, and the assistant undoes its own, by its handle.
