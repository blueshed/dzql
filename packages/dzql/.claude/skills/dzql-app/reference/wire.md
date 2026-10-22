# The wire

The wire carries writes in, and HTML and ops out; there is no JSON tree of app state. The controls
that send writes are [controls.md](controls.md).

```js
// in: chat's "Say something", as the kernel's client sends it
{ "id": 7, "doc": "room", "ops": [{ "op": "add", "path": "/messages/-", "value": "hello" }] }
// out, to its writer: the echo, then the parts of the page that changed
{ "type": "patch", "doc": "room:general", "version": 12, "ops": [/* the row, whole */], "id": 7, "change": "3f…" }
{ "type": "render", "ops": [/* parts */] }
// or, refused
{ "type": "refused", "id": 7, "reason": "…" }
// or, the page could not be drawn (a throw in a render: logged, and the page says so)
{ "type": "failed" }
```

The shapes are `src/rendering/json-patch.ts` (`WIRE`, `LONGEST_ID`) and `src/rendering/server.ts`.

Working: [examples/chat](https://github.com/blueshed/dzql/blob/main/packages/dzql/examples/chat/server.test.ts), writes over a real socket
(`server.test.ts`): the echo naming the bare type of a session, a refused write answered by its
id, `inspect` naming the documents a page sees.

- A document is named whole, `<docType>:<docId>` (`room:general`), so one socket holds any documents.
  A bare type in a write is the one of that type the page is on (`resolveDoc`).
- A `perSession` document is named by its type alone, since the id is a credential. A document keyed
  by a live session's id that is not `perSession` is refused, loudly.
- A session id never goes on the wire: it is the `session_id` cookie and a person's only credential.
  No echo, render, op value or inspect reply may carry one.
- `path` is a JSON Pointer, never a verb. `id` is the sender's own, handed back: a number JSON can
  say, or a string of at most 64 characters; anything else is no write, answered by the page alone.
- A `test` op (RFC 6902) is a condition, not a change: the value a field was drawn with. It never
  reaches `permit` or `shape`, and a write of tests alone is none.
- Only the writer's echo carries `id` and `change`, the handle that undoes it (a write with no undo names none).
- A page is sent whole as `{type: "render", html, wire}`, or in parts as `{type: "render", ops}`.
- A write that applies nothing (refused, nothing to undo, a throw) is answered `refused` when it has
  an id, then with the page whole. A throw goes through `failed()` (`src/rendering/failed.ts`), which fails the
  story it happened in.
- A message in is at most 1 MiB, inflated: send a picture or a file by HTTP, never the socket.
- A write carries at most 1,000 ops (`MOST_OPS`), its tests among them: more is refused, saying so.
- A connection's messages are handled in order, each on its page as drawn after everything before
  it; another connection's do not wait for them. One with more than 100 waiting (`MOST_WAITING`) is
  closed (1008), and so is one that reads slower than it is sent to, once 1 MiB waits for it. Its
  page connects again, after a random share of a wait that doubles, and is drawn afresh.
- The echoes of several changes may come before the parts that show them all: a page is drawn once
  for the changes told while it waited. A test finds what it asks about by document, not position.
- A page the server could not draw is sent `{type: "failed"}`, and says so beside itself until the
  next drawing. A part for something the page does not have, or a patch past the next version a
  watching applet holds, makes the page ask for itself whole.
- The socket is compressed, a message at a time: a big page sent whole to many at once is the cost to
  watch. Draw no secret (a code, a token) beside text others write: compressed sizes can leak it.

## In the page

- `window.eta.docs()`: the small op log, by document name.
- `{type: "inspect", limit?}`: the documents this page sees and their latest ledger entries, each
  `mine: true|false`, never who.
- `window.eta.inspect().lastSent`: the page's last write, `{id, doc, ops, echoed, refused, reason?,
  unanswered?}`.
- `window.eta.send(doc, ops)` is a script's write, sent as a control's is, resolving by its id:
  `{echoed: true, …, change?}`, `{refused: true, reason?}`, `{unanswered: true}` or `{unsent}`.
  `window.eta.undo(change?)` and `redo(change?)` walk the last change, or the one named.
- An assistant in the browser uses the page by its writes: [assistants.md](assistants.md).
