# eta

A kernel for live, multi-person apps, made of three things that compose:

- **Documents.** The whole app is documents, kept by [delta](../blueshed/delta) -- in SQLite here,
  Postgres or memory as the document needs. A write is a patch: a document, a JSON Pointer path,
  a value. Because every write is a patch, every write has an inverse, and the ledger keeps both.
- **Render.** A compartment turns a document into HTML for one person. The server is the only
  renderer; the browser keeps that HTML alive by morphing, so a re-render never disturbs what
  someone is doing, and a render can be as small as the change. The session sits beside the
  compartments as the tray -- which page, which drawer is open -- and undo/redo/leaving are
  tools, not compartments of their own.
- **Applets.** Where a page needs behaviour of its own -- a figure being dressed, a price board
  moving -- an applet takes its data as props, answers with writes, and can take a document's
  patches straight off the wire.

Three examples show the three at work. What they asked of the kernel as they grew is recorded in
`history/`; none of it is knowledge of an example, and `src/` never imports one:
`examples/chat/`, a room with people in it; `examples/wedding/`, a site for one wedding with
a Lego minifigure builder and a live photo of everyone coming; `examples/ticker/`, a price board
and a Swiss railway clock, both drawn in the browser.

## Why eta

- **Undo and redo, for free.** Every patch records its inverse. Undo walks a session's own writes
  back, redo walks them forward again, and a removed course comes back with its dishes, because
  the inverse was written once when the write was.
- **A legible wire.** Only documents, patches and HTML cross it. A person with a terminal can
  `watch` an app and read what happened, `inspect` any document's history, or `undo` from the
  CLI, with no browser open.
- **Almost no client.** The kernel's client is 2.6 KB minified and gzipped: a morph, the write
  gestures and an applet registry. The wedding's, with its applets and the figure, is 9.1 KB.
  There is no framework to learn.
- **Zero infrastructure.** Bun and SQLite, one process, one file. A multi-person live app deploys
  without a queue, a cache or a build step.
- **Measured, not claimed.** What a write costs on the wire is a number in this README, from a
  script you can run: a chat message is 425 bytes to each other member, a price tick 104, a
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
bun run start   # detached, in production mode (server.log)
bun run stop    # whatever is listening on PORT (3000)
bun run test    # or a bare `bun test`: .env.test and bunfig.toml make them the same, and 100% coverage is a gate
bun run stories # run an example's stories against it (stories.md)
```

Which example runs is `ETA_EXAMPLE` (default `chat`): `ETA_EXAMPLE=wedding bun run dev`. It
resolves `examples/<name>/index.ts`'s `example` export. The wedding's demo codes are
`DASH` (the couple), `OKAFOR` and `BEN` (two households); `REVEAL=1` shows the names in
the photo before the day. The ticker's feed ticks every `TICK_MS` (500) while anyone is
connected; `CLOCK_TZ` is the city a new visitor's clock shows. Each example lives entirely under its own directory --
documents, compartments, applets, client, its `delta.ts`; `src/` never imports from any of them.

## Cost

A write reaches everyone who sees its document as a patch echo, and everyone whose page read it
as a render. From 0.12.0 (morph, don't replace) to 0.23.0 the render was always the whole page;
from 0.24.0 a compartment could hand-write the delta in HTML's terms (`fragments`), and the page
went whole where it did not. Now a page is sent in parts: a render names its regions
(`part(key, html)`; the bento's cells, rows and drawers are parts already), the kernel draws the
page again after a write and sends only the parts that differ from what that connection was last
sent -- a part replaced, a row put in or taken out -- and the page whole only when it is a different
page. Nothing is hand-written, and nothing is sent to a page that did not change. Measured with
each example's own script (`DB_PATH=:memory: bun examples/<name>/scripts/measure-render-cost.ts`):

Chat, a room at 100 messages and 5 members, bytes sent to each *other* member per message:

| | patch echo | render | total |
|---|---|---|---|
| 0.4.0 (append) | 159 B | 120 B | 279 B |
| 0.12.0 to 0.23.0 (full page) | 159 B | 7373 B | 7532 B |
| 0.24.0 to 0.46.0 (hand-written: one `<li>`) | 159 B | 266 B | 425 B |
| now (parts) | 196 B | 608 B | 804 B |

The hand-written fragment was wrong: a room shows its latest 50 messages, and it only ever
appended, so an open page grew past 50 while a fresh one did not. Parts send what makes the page
true: the new message after the last, the oldest taken out, and the new first one again, since it
now starts a run and shows its name.

The wedding, one guest's top changed to green, bytes sent to each viewer:

| viewer | 0.23.0 (full page) | 0.46.0 (hand-written) | now (parts) |
|---|---|---|---|
| the sender, drawer open | 14146 B | 1692 B | 1794 B |
| the same household, a second tab on its box | 11387 B | 1215 B | 1272 B |
| the couple, on their home | 8912 B | 3570 B | 3626 B |
| another household, on its box | 10879 B | 0 B | 0 B |
| another household, on the everyone page | 3781 B | 1612 B | 1664 B |

The same pieces the wedding's seventy lines of `fragments` named, found by comparing the page;
the few bytes more are each part's `data-eta-part` and target.

The ticker, one price tick, five viewers watching the symbol, bytes sent to each:

| | bytes |
|---|---|
| the tick as a bare JSON feed (`{s, p, t}`), for comparison | 41 B |
| eta: the patch echo, and nothing else | 111 B |

No render follows a tick for a page on the box: the board applet names the market document
(`data-doc="ticker:market"`) and takes the ops itself (`Applet.patch`), and an applet that does so
is compared without its props, so the page has not changed. A page reading the market as rows is
sent the one row that moved. The clock is the same shape as the board.

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

## Stories

`stories.md` says what all of this is for. An example is a set of stories, each a sentence and
the write behind it -- who does what, and who then sees it where -- and `bun run stories` runs
them against the example over real sockets, undo and redo included, and reports by sentence:

```
 ok   Ada says hello; Bob, in the room, sees it; Cy, in the kitchen, does not
FAIL  The couple invite the Londons
        couple did not see it
```

A failing story is a finding: against the example, or against the story, or against the shape of
stories itself. `STORY="invite"` runs the ones whose name contains that; `STORY_DIFF=1` shows
where two renders part company.

Run it to see the counts; they are not repeated here, because a number in a README goes stale and
a run does not. What the harness checks today, and what `stories.md` still only intends, is said
in `stories.md` under "The harness".
