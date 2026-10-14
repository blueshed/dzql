# Where an app lives, and when it seems to need `src/`

How an app is found and run (a `bun create` project, an example, a repo that installs eta), how a project moves to a later eta, and the seams to look for before touching `src/`.

## Where an app lives

The kernel finds an app by `ETA_EXAMPLE`: one of eta's examples by name (`chat`), or an app's own
folder (`./app`). `start`, `stories` and `cli` all take it. Whichever it is, the steps are the same,
and none of them edits `src/`.

### A project made with `bun create blueshed/eta`

The usual way to start. `bun create blueshed/eta my-app` makes three folders: `app/`, the app,
begun with a page and no stories (eta's `examples/starter`); `model/`, the model's page, where the
stories are modelled before they are built (the modelling skill); and `src/`, eta's kernel, which
the app imports (`../src/...`) and never edits. `bun dev`, `bun test`, `bun run stories` and
`bun run cli` work on `app/`; `bun run model` and `bun run cli:model` on `model/`. `.env` holds the
model's name, who keeps it, and the password they share.

### Moving a project to a later eta

The project's `CHANGELOG.md` names the eta it started from. To move to a later eta: replace `src/`
and `model/` whole with that eta's, from its repo at its tag; read eta's `CHANGELOG.md` from the
project's version on, and carry across what each "What to change" says for the app -- they are
written for this; run the gate, the stories passing is the proof; and say in the project's
changelog which eta it is on now. Never patch `src/` in a project: a change the kernel needs is
eta's, made there and released.

### An app that installs eta

An app in a repo of its own can depend on a packed eta (`package.json`'s `files`: `src` without its
tests, these skills, the docs) -- a tarball, never `file:`:

```sh
cd ../blueshed/eta && bun pm pack && cd - && bun add ../blueshed/eta/eta-<version>.tgz
```

After a change to eta, pack again, then `bun remove eta && bun add` the tarball: the lockfile keeps a
tarball's first contents (Bun 1.4). The app imports the kernel as `eta/src/...` (the stylesheet:
`@import "eta/src/bento.css"`) and has three small files where a project leans on eta's scripts: a
`server.ts` (`createServer(example)`), a stories runner (`print(await run(example, stories,
undefined, { byHand: !!process.env.STORY_BY_HAND }), { wire: !!process.env.STORY_WIRE })`), and
eta's `tsconfig.json`, `bunfig.toml` and `.env.test`. To be read by eta's loader (`bun run
model:check <path>`), it links eta from its checkout instead (`bun link`, then `"eta":
"link:eta"`), keeping its delta and railroad at eta's versions. `Workshop/canyou-eta` is one.

## When it looks like you need to touch `src/`

It usually means a seam is missing from what you know, not that the example is special (the seams are
[example.md](example.md)'s and [compartment.md](compartment.md)'s):

- a per-example "may this session write" is `Example.active`;
- an extra HTTP route is `Example.routes`;
- who a request is before its socket opens (a proxy's header, a token) is `Example.identify`;
- a fresh write that differs from its undo is `shape` (undo is never shaped);
- what follows a write is `afterChange` or `afterWrite`, and what follows an undo or redo `afterWalk`;
- saying what just happened is `tell` (why, or what it did), never a field of your own session: the
  harness compares an author's pages without what the kernel told them, and with what you keep.

Never teach the kernel the name of a specific document, applet or compartment.
