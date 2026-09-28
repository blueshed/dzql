# eta

**eta builds apps that several people use at once, where every change reaches everyone who should
see it and nobody who shouldn't, and checks that before anyone signs in.**

You start by writing the app as stories: who does what, and who then sees it. "Ann asks for three
days off, and Mo sees it waiting on the calendar." eta runs every story against the real app,
over real sockets. It checks that the write lands, that the right people's pages change and
nobody else's does, that anyone the story says must not even be told is sent nothing, and that
undo and redo put every page back. The stories are the specification and the test, and the rule
is to build nothing a story doesn't need.

The usual stack for this -- a client framework, an API, a cache, a socket server -- is a lot to
carry for a wedding site or a booking board. eta is one Bun process: the server draws every page
as HTML, the browser patches it in place, and what crosses the wire is documents, patches and
HTML a person can read. Every change is a document patch from delta, so each person's page
updates as it happens, and each can undo their own writes while others keep writing. Where a
piece of a page must keep state in the browser, like a drag or a chart, it's a small railroad
applet, and only there.

In one line: **multi-person live apps told as stories and checked by them, drawn on the server,
on delta's live documents.**

## Try it

You need Bun. `bun install` brings `@blueshed/delta` and `@blueshed/railroad` from npm.

```
bun install
bun run dev
```

Open http://localhost:3000. Give a name, name a room, say something. Open a private window, give
another name and go into the same room: each of you sees the other arrive and speak. Undo, at the
bottom right, takes back your own last write, and the other sees it go: your last message, or, if
you have only just come in, your coming into the room.

That is chat, the smallest example. Three more, and a mock-up:

- `bun run dev:wedding` (port 3001): a site for one wedding. The codes are `DASH` (the couple),
  `OKAFOR` and `BEN` (two households). There is a Lego minifigure builder, and a photo of
  everyone coming that fills in live.
- `bun run dev:ticker` (port 3002): a price board and a Swiss railway clock, both drawn in the
  browser.
- `bun run dev:leave` (port 3004): a small team's leave, on one calendar. Drag across days for a
  draft and see who else is off before you ask; drag your own waiting request to move it; a
  manager answers. People sign in: `ann@leave.example` and `bo@leave.example` ask,
  `mo@leave.example` answers; each password is the name and `-password` (`ann-password`).
- `bun run dev:bento` (port 3003): the bento mock-up, a page to look at and click, with no eta
  behind it.

`ETA_EXAMPLE=<name>` picks the example for `bun run dev`, `start`, `stories` and `cli` (default
`chat`); `dev:wedding`, `dev:ticker`, `dev:leave` and `stories:all` set it themselves. The CLI also needs
`ETA_URL` for the server it talks to (default `ws://localhost:3000`). `.env.example` explains every
setting, `TICK_MS` and `CLOCK_TZ` (the ticker), `REVEAL` (the wedding) and `ETA_ORIGINS` (other
sites whose pages may open a socket) among them.

## What it pairs with

- **[@blueshed/delta](https://www.npmjs.com/package/@blueshed/delta)** keeps the documents, their ledger and their one stream
  of changes. eta owns people and pages; delta owns the data. An example's `delta.ts` says which
  tables it has and which documents are cut from them.
- **[@blueshed/railroad](https://www.npmjs.com/package/@blueshed/railroad)** draws an island: an
  applet, the part of a page that keeps state of its own in the browser, written as a railroad
  component (`island()`, `src/island.ts`). The ticker's city picker is one. The kernel's client
  does not import it; a page with an island carries railroad too (<!-- measured:railroad -->3.5 KB
  gzipped for `signal` and `mount`, 4.4 KB with `list`<!-- /measured -->).

## Why eta

- **Undo and redo.** A write to a document on delta's ledger is a patch recorded with its
  inverse. Undo walks your own writes back, newest first, even while others keep writing, and
  sets back only what your write changed: if someone has changed it since, the undo is refused
  and says so. A compartment can refuse one that breaks a rule of time or state
  (`permitUndo`: answers closed at the deadline).
- **Stories are the tests.** An example is a list of sentences -- who does what, and who then
  sees it -- and `bun run stories` checks each one over real sockets, with its undo and redo;
  `bun run stories:all` runs every example's (<!-- measured:stories -->11 in chat, 21 in leave, 17 in ticker and 50 in wedding<!-- /measured -->),
  and does again by hand, in a browser the size of a phone, each write a page sends and each
  refusal a control of the page sends, so a control nobody can press fails.
- **A small client.** The kernel's client is <!-- measured:client -->6.0 KB<!-- /measured --> minified
  and gzipped: a morph, the write gestures and an applet registry. There is no framework to learn.
- **Nothing else to run.** Bun and SQLite, one process, one file.
- **A readable wire.** `bun run cli watch` prints every patch as it happens; `bun run cli undo`
  undoes the CLI session's own last write, from a terminal.

It suits small teams making live apps where being able to undo and to see what happened matter
more than scale: a wedding, a booking board, a classroom, an ops console. It is not built for a
large consumer product.

## What a write costs

After a write, each page that read the document is drawn again and sent only the parts that
changed, and the socket compresses each message (permessage-deflate, which every browser offers).
Each example measures what one write sends everyone else as it crosses the wire, and what it was
before compression, with a script (`examples/<name>/scripts/measure-render-cost.ts`).
`bun run costs` runs each from an empty database and writes what it finds here, and every other
number this README quotes; `bun test` fails when the README says otherwise.

<!-- measured:writes -->
- **Chat**, one message in a room of 100 messages and 5 members: 518 B, compressed from 1.2 KB, to
  each other member (a 207 B patch and 311 B of HTML).
- **The ticker**, one price tick with 5 viewers watching its symbol: 283 B, compressed from 364 B,
  to each other viewer (patches of 143 B and 140 B, and no HTML). The same tick as a bare JSON feed
  would be 41 B.
- **The wedding**, one guest's top changed to green: 917 B, compressed from 2.3 KB, to the same
  household's second tab, on its photo (patches of 250 B and 218 B, and 449 B of HTML); 856 B,
  compressed from 5.4 KB, to the couple, on their photo of families (a 252 B patch and 604 B of
  HTML); 218 B, compressed from 300 B, to another household, on its photo (one patch and no HTML);
  and 566 B, compressed from 1.9 KB, to another household, reading everyone (a 218 B patch and 348 B
  of HTML).
<!-- /measured -->

## Commands

```
bun run dev          # chat, watching for changes (dev:wedding, dev:ticker too)
bun run start        # detached, in production mode; bun run stop stops it
bun test             # the tests
bun run check        # the type check
bun run stories      # one example's stories; stories:all runs every example's, and by hand
bun run cli <verb>   # a terminal client: inspect, watch, undo, redo, write, and the example's own
bun run costs        # measures every number this README quotes, and writes it in
```

Two tools sit beside the kernel and are not shipped: `modeller/` (`bun run modeller <example>`:
hjeli's predicates over an example's stories; `bun run modeller:page <example>`: its demo page, in
`modeller/dist/`) and `uml/`, a live ASCII-UML session (`bun run uml`, PlantUML in docker, on
:3700; `bun run uml:check` checks the diagrams without it).

## Where to go next

- `first-app.md`: your first app, step by step, with the words met at each step.
- `stories.md`: what eta is for, and how stories drive it.
- `.claude/skills/eta-app/`: how to build or extend an example, step by step, with the contracts
  in `reference.md`.
- `CLAUDE.md`: the rules a change must not break.
- `examples/bento/README.md`: how a page looks and moves.
- `CHANGELOG.md`: what changed, and how to move an example across a breaking change.
