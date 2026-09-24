# eta

eta is a small kernel for live apps that several people use at once, drawn on the server. Every
change is a patch to a document, so everyone who can see it is told at once, and anyone can undo
their own.

It exists because the usual stack for this -- a client framework, an API, a cache, a socket
server -- is a lot to carry for a wedding site or a booking board. eta is one Bun process: the
server draws every page as HTML, the browser morphs it in place, and what crosses the wire is
documents, patches and HTML that a person can read.

## Try it

You need Bun, and delta checked out beside this repository at `../blueshed/delta`. eta needs
delta 0.6.0, which is not on npm yet: `createLocal`, documents that are `implied`, and the
ledger's undo, redo and history are new there. Until it is, `package.json` takes
`@blueshed/delta` from that checkout.

```
bun install
bun run dev
```

Open http://localhost:3000. Give a name, name a room, say something. Open a private window, give
another name and go into the same room: each of you sees the other arrive and speak. Undo, at the
bottom right, takes back your own last write, and the other sees it go: your last message, or, if
you have only just come in, your coming into the room.

That is chat, the smallest example. Two more, and a mock-up:

- `bun run dev:wedding` (port 3001): a site for one wedding. The codes are `DASH` (the couple),
  `OKAFOR` and `BEN` (two households). There is a Lego minifigure builder, and a photo of
  everyone coming that fills in live.
- `bun run dev:ticker` (port 3002): a price board and a Swiss railway clock, both drawn in the
  browser.
- `bun run dev:bento` (port 3003): the bento mock-up, a page to look at and click, with no eta
  behind it.

`ETA_EXAMPLE=<name>` picks the example for `bun run dev`, `start`, `stories` and `cli` (default
`chat`); `dev:wedding`, `dev:ticker` and `stories:all` set it themselves. The CLI also needs
`ETA_URL` for the server it talks to (default `ws://localhost:3000`). `.env.example` explains every
setting, among them `ETA_URL`, `TICK_MS` and `CLOCK_TZ` (the ticker) and `REVEAL` (the
wedding).

## What it pairs with

- **[@blueshed/delta](../blueshed/delta)** keeps the documents, their ledger and their one stream
  of changes. eta owns people and pages; delta owns the data. An example's `delta.ts` says which
  tables it has and which documents are cut from them.
- **[@blueshed/railroad](../blueshed/railroad)** can draw an applet, the part of a page that keeps
  state of its own in the browser. No example uses it today; an example may, and eta does not
  depend on it.

## Why eta

- **Undo and redo.** A write to a document on delta's ledger is a patch recorded with its
  inverse. Undo walks your own writes back, even while others keep writing.
- **Stories are the tests.** An example is a list of sentences -- who does what, and who then
  sees it -- and `bun run stories` checks each one over real sockets, with its undo and redo.
- **A small client.** The kernel's client is about 2.7 KB minified and gzipped: a morph, the write
  gestures and an applet registry. There is no framework to learn.
- **Nothing else to run.** Bun and SQLite, one process, one file.
- **A readable wire.** `bun run cli watch` prints every patch as it happens; `bun run cli undo`
  undoes the CLI session's own last write, from a terminal.

It suits small teams making live apps where being able to undo and to see what happened matter
more than scale: a wedding, a booking board, a classroom, an ops console. It is not built for a
large consumer product.

## What a write costs

After a write, each page that read the document is drawn again and sent only the parts that
changed. Each example measures this with a script
(`DB_PATH=:memory: bun examples/<name>/scripts/measure-render-cost.ts`). Today:

- **Chat**, a room of 100 messages and 5 members: 1,111 B to each other member per message (a
  293 B patch and 818 B of HTML).
- **The wedding**, one guest's top changed to green: 1.8 KB to the same household's other tab,
  3.8 KB to the couple, and to another household only the photo's one changed figure (302 B), with
  no HTML.
- **The ticker**, one price tick: a 186 B patch to each viewer, and no HTML. The same tick as a
  bare JSON feed would be 41 B.

Up to 0.23.0 every write sent the whole page: 7.4 KB to each member for one chat message, 8.9 KB
to the couple for the wedding's green top. `CHANGELOG.md` has the steps between.

## Commands

```
bun run dev          # chat, watching for changes (dev:wedding, dev:ticker too)
bun run start        # detached, in production mode; bun run stop stops it
bun test             # the tests; below 100% coverage the run fails
bun run check        # the type check
bun run stories      # one example's stories; stories:all runs every example's
bun run cli <verb>   # a terminal client: inspect, watch, undo, redo, write, and the example's own
```

## Where to go next

- `stories.md`: what eta is for, and how stories drive it.
- `.claude/skills/eta-app/`: how to build or extend an example, step by step, with the contracts
  in `reference.md`.
- `CLAUDE.md`: the rules a change must not break.
- `examples/bento/README.md`: how a page looks and moves.
- `CHANGELOG.md`: what changed, and how to move an example across a breaking change.
