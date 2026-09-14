# eta

A tiny kernel for building real-time, server-rendered apps, built around one
idea: HTML is the only vocabulary. The server renders, the client morphs,
and every change is a JSON Patch recorded in a SQL ledger. `src/` is the
generic kernel; it knows nothing about any specific app. `examples/chat/` is
the first example built on it -- a real-time chat -- and `examples/wedding/`
the second -- a site for one wedding, with Lego minifigures. Another can be
added under `examples/<name>/` without editing anything in `src/`.

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
bun run dev     # foreground, --watch (chat, by default)
bun run dev:wedding  # the wedding, on port 3001
bun run start   # detached (server.pid, server.log)
bun run stop
bun run test    # bun test --coverage
```

Which example runs is `ETA_EXAMPLE` (default `chat`): `ETA_EXAMPLE=wedding bun run dev`. It
resolves `examples/<name>/index.ts`'s `example` export. The wedding's demo codes are
`DASH` (the couple), `OKAFOR` and `BEN` (two households); `REVEAL=1` shows the names in
the photo before the day. The chat app itself
lives entirely under `examples/chat/` — its documents, concepts, applets,
client, and migrations; `src/` never imports from it.

## Cost

Morphing (request 5) removed the granular `append` message: a room write now
sends every *other* member a patch echo plus a full re-render of the chat
view, where before it sent a patch echo plus one appended `<li>`. Measured
with a room at 100 messages and 5 members
(`bun examples/chat/scripts/measure-render-cost.ts`), bytes sent to each
other member per message sent:

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
- Send `{"type":"inspect"}` over the websocket to ask the server the same question from its side: the docs this connection sees, each with its version and the latest ledger entry behind it.

## CLI

A terminal client for the same protocol — it never touches rendered HTML, only ops and `inspect`, since those are what's actually true. The kernel itself only knows a few doc-agnostic commands:

```
bun run cli undo
bun run cli inspect
bun run cli watch                          # streams patches until you stop it
bun run cli write <doc> <op> <path> [value]
```

`ETA_EXAMPLE` (default `chat`) also picks which example's own short verbs (its `cli.ts`, if it has one) are available alongside those. Chat's are `name`, `room`, `leave`, `logout`, and `send`:

```
bun run cli name Ada
bun run cli room lobby
bun run cli send "hello"
bun run cli undo
bun run cli inspect
```

Identity persists across invocations in a local `.eta-session` file (a cookie jar of one), the same way a browser tab would. Point it at a non-default server with `ETA_URL=ws://host:port`.

Pass `--session <file>` to use a different identity — e.g. `watch` as one person in one terminal while sending as another elsewhere:

```
bun run cli name Alice --session alice.session
bun run cli name Bob --session bob.session
bun run cli watch --session alice.session
```
