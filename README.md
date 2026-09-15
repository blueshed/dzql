# eta

A kernel for live, multi-person apps, made of three things that compose:

- **Documents.** The whole app is documents in SQLite, each with one `read()` and one `patch()`.
  A write is a patch: a document, a JSON Pointer path, a value. Because every write is a patch,
  every write has an inverse, and the ledger keeps both.
- **Render.** A concept turns a document into HTML for one person. The server is the only
  renderer; the browser keeps that HTML alive by morphing, so a re-render never disturbs what
  someone is doing, and a render can be as small as the change.
- **Applets.** Where a page needs behaviour of its own -- a figure being dressed, a price board
  moving -- an applet takes its data as props, answers with writes, and can take a document's
  patches straight off the wire.

Three examples prove the three are enough, and each needed nothing in `src/` it did not already
have: `examples/chat/`, a room with people in it; `examples/wedding/`, a site for one wedding with
a Lego minifigure builder and a live photo of everyone coming; `examples/ticker/`, a price board
and a Swiss railway clock, both drawn in the browser.

## Why eta

- **Undo and redo, for free.** Every patch records its inverse. Undo walks a session's own writes
  back, redo walks them forward again, and a removed course comes back with its dishes, because
  the inverse was written once when the write was.
- **A legible wire.** Only documents, patches and HTML cross it. A person with a terminal can
  `watch` an app and read what happened, `inspect` any document's history, or `undo` from the
  CLI, with no browser open.
- **Almost no client.** The kernel's client is 2.3 KB gzipped: a morph and an applet registry.
  The wedding's, with four applets and the figure, is 8 KB. There is no framework to learn.
- **Zero infrastructure.** Bun and SQLite, one process, one file. A multi-person live app deploys
  without a queue, a cache or a build step.
- **Measured, not claimed.** What a write costs on the wire is a number in this README, from a
  script you can run: a chat message is 427 bytes to each other member, a price tick 104, a
  guest's changed top on the wedding nothing at all to the households it does not concern.

It is for small teams and solo builders making live apps where reversibility and legibility
matter more than scale: a wedding, a booking board, a classroom, an ops console. It is not a
CDN-scale consumer product, and does not try to be.

## Running

Bun only — no Node, no npm.

```
bun install
bun run dev     # foreground, --watch (chat, by default)
bun run dev:wedding  # the wedding, on port 3001
bun run dev:ticker   # the board, on port 3002
bun run start   # detached (server.pid, server.log)
bun run stop
bun run test    # bun test --coverage
```

Which example runs is `ETA_EXAMPLE` (default `chat`): `ETA_EXAMPLE=wedding bun run dev`. It
resolves `examples/<name>/index.ts`'s `example` export. The wedding's demo codes are
`DASH` (the couple), `OKAFOR` and `BEN` (two households); `REVEAL=1` shows the names in
the photo before the day. The ticker's feed ticks every `TICK_MS` (500) while anyone is
connected; `CLOCK_TZ` is the city a new visitor's clock shows. Each example lives entirely under its own directory --
documents, concepts, applets, client, migrations; `src/` never imports from any of them.

## Cost

A write reaches every connection that sees its document as a patch echo and then a render. From
0.12.0 (morph, don't replace) to 0.23.0 the render was always the whole page; since 0.24.0 a concept
may answer with the delta in HTML's terms instead -- `Concept.fragments` -- and the page is the
fallback. Measured with each example's own script (`DB_PATH=:memory: bun
examples/<name>/scripts/measure-render-cost.ts`):

Chat, a room at 100 messages and 5 members, bytes sent to each *other* member per message:

| | patch echo | render | total |
|---|---|---|---|
| 0.4.0 (append) | 159 B | 120 B | 279 B |
| 0.12.0 to 0.23.0 (full page) | 159 B | 7373 B | 7532 B |
| 0.24.0 (fragment: one `<li>`) | 159 B | 268 B | 427 B |

The wedding, one guest's top changed to green, bytes sent to each viewer:

| viewer | 0.23.0 (full page) | 0.24.0 (fragments) |
|---|---|---|
| the sender, drawer open | 14146 B | 1918 B |
| the same household, a second tab on its box | 11387 B | 1441 B |
| the couple, on their home | 8912 B | 123 B (the patch alone) |
| another household, on its box | 10879 B | 0 B |
| another household, on the everyone page | 3781 B | 1612 B |

The ticker, one price tick, five viewers watching the symbol, bytes sent to each:

| | bytes |
|---|---|
| the tick as a bare JSON feed (`{s, p, t}`), for comparison | 41 B |
| eta: the patch echo, and nothing else | 104 B |

No render follows a tick: the board applet names the market document (`data-doc="ticker"`) and
takes the ops itself (`Applet.patch`), so the delta is the update. The clock is the same shape:
it is drawn and driven in the browser, where the time is, and when you choose another city the
only thing that crosses the wire is the clock document's `replace /tz`, which the applet takes.

An applet's props still go whole when they change (the wedding's photo re-sends every figure for
one changed top), and every connection is still asked -- the answer is now often nothing, but the
fan-out is the same. Those are the change request's items 7 and 1.

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
