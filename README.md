# eta

A tiny real-time chat app built around one idea: HTML is the only
vocabulary. The server renders, the client morphs, and every change is a
JSON Patch recorded in a SQL ledger.

- **Documents, not endpoints.** Session and room state live in SQLite; a
  document's `patch()` is the only way to write it, `read()` is a single
  query.
- **The write is the truth.** An element declares what it writes
  (`data-write='{"doc":"room","op":"add","path":"/transcript/-"}'`); the
  server permits it, applies it, echoes the ops, then renders.
- **Undo, for free.** Every patch records its inverse in the ledger.
  Pressing Undo walks a session's own writes backward, one at a time.
- **The client only morphs.** No framework, no virtual DOM — a hand-rolled
  diff reconciles the existing tree against new server HTML, so focus,
  caret, and scroll survive a re-render that isn't about you.

## Running

Bun only — no Node, no npm.

```
bun install
bun run dev     # foreground, --watch
bun run start   # detached (server.pid, server.log)
bun run stop
bun run test    # bun test --coverage
```

## Cost

Morphing (request 5) removed the granular `append` message: a room write now
sends every *other* member a patch echo plus a full re-render of the chat
view, where before it sent a patch echo plus one appended `<li>`. Measured
with a room at 100 messages and 5 members (`bun scripts/measure-render-cost.ts`),
bytes sent to each other member per message sent:

| | patch echo | second message | total |
|---|---|---|---|
| before (append) | 159 B | 120 B | 279 B |
| after (full render) | 159 B | 2981 B | 3140 B |

About 11x more per message. It doesn't keep growing with history, though:
`documents/room.ts::read()` caps the transcript at 50 messages regardless of
how many exist, so the render payload plateaus there (measured ~2971 B at
50 messages, ~3030 B at 200) rather than growing unbounded. Not fixed here —
see the CHANGELOG for the candidate (render just the new item when the
write was a single append, else the whole view) and why it isn't free.

## Poking at it

- `window.eta.docs()` — documents this tab has seen, with version and recent ops.
- `window.eta.inspect()` — the above, plus the last write this tab sent and whether it was echoed.
- Send `{"type":"inspect"}` over the websocket to ask the server the same question from its side: this connection's session, the docs it sees, and the latest ledger entry behind each.

## CLI

A terminal client for the same protocol — it never touches rendered HTML, only ops and `inspect`, since those are what's actually true.

```
bun run cli name Ada
bun run cli room lobby
bun run cli send "hello"
bun run cli undo
bun run cli inspect
bun run cli watch     # streams patches for the room you're in until you stop it
```

Identity persists across invocations in a local `.eta-session` file (a cookie jar of one), the same way a browser tab would. Point it at a non-default server with `ETA_URL=ws://host:port`.

Pass `--session <file>` to use a different identity — e.g. `watch` as one person in one terminal while sending as another elsewhere:

```
bun run cli name Alice --session alice.session
bun run cli name Bob --session bob.session
bun run cli watch --session alice.session
```
