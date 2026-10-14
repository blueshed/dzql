# Where an app lives, and when it seems to need `src/`

How an app is found and run, how a project moves to a later eta, and the seams to look for before
touching `src/`.

```sh
bun create blueshed/eta my-app   # app/ (the app), model/ (the model's page), src/ (eta's kernel)
cd my-app
bun run model                    # the model, where the stories are told first (the modelling skill)
bun dev                          # the app; bun test, bun run stories and bun run cli work on app/
```

The kernel finds an app by `ETA_EXAMPLE`: an example by name (`chat`) or a folder (`./app`).
`start`, `stories` and `cli` all take it, and none of the steps edits `src/`.

## A project made with `bun create blueshed/eta`

- `app/` starts as a page and no stories (eta's `examples/starter`); it imports the kernel
  (`../src/...`) and never edits it. `bun run cli:model` works on `model/`.
- `.env` holds the model's name, who keeps it, and the password they share.

## Moving a project to a later eta

The project's `CHANGELOG.md` names the eta it started from. Replace `src/` and `model/` whole with
the later eta's, from its repo at its tag; carry across what each "What to change" in eta's
`CHANGELOG.md` says, from the project's version on; run the gate (the stories passing is the proof);
say in the project's changelog which eta it is on now. Never patch `src/` in a project: a change the
kernel needs is eta's, made there and released.

## An app that installs eta

An app in a repo of its own depends on a packed eta, a tarball, never `file:`:

```sh
cd ../blueshed/eta && bun pm pack && cd - && bun add ../blueshed/eta/eta-<version>.tgz
```

- After a change to eta, pack again, then `bun remove eta && bun add` the tarball: the lockfile keeps
  a tarball's first contents.
- It imports `eta/src/...` (the stylesheet: `@import "eta/src/bento.css"`), and has a `server.ts`
  (`createServer(example)`), a stories runner (`print(await run(example, stories, undefined, {
  byHand: !!process.env.STORY_BY_HAND }), { wire: !!process.env.STORY_WIRE })`), and eta's
  `tsconfig.json`, `bunfig.toml` and `.env.test`.
- To be read by eta's loader (`bun run model:check <path>`), it links eta from its checkout instead
  (`bun link`, then `"eta": "link:eta"`), keeping delta and railroad at eta's versions.

## When it looks like you need to touch `src/`

A seam is missing from what you know, not the app special:

- may this session write at all: `Example.active`; an extra HTTP route: `Example.routes`; who a
  request is before its socket opens: `Example.identify` ([example.md](example.md));
- a fresh write that differs from its undo: `shape` (undo is never shaped); what follows a write:
  `afterChange` or `afterWrite`, an undo or redo: `afterWalk` ([compartment.md](compartment.md));
- saying what just happened: `tell`, never a field of your own session ([refusal.md](refusal.md)).

Never teach the kernel the name of a document, applet or compartment.
