# Where an app lives, and when it seems to need eta's kernel

How a project is made and laid out, how it moves to a later eta, and the seams to look for before
touching the kernel.

```sh
bun create blueshed/eta my-app   # the root is the app; eta is one folder, eta/, never edited
cd my-app
bun run model                    # the model, where the stories are told first (the modelling skill)
bun dev                          # the app; bun test, bun run stories and bun run cli work on src/
bun run eta:update               # a later eta: eta/ replaced whole, and what to change
```

## A project made with `bun create blueshed/eta`

```
src/          the app: index.ts, stories.ts, delta.ts, page, resources, client (begun as eta's examples/starter)
migrations/   a field renamed or dropped, or data moved; never edit one that has run
eta/          eta's, never edited: src/ (the kernel), model/ (the model's page), docs/, CHANGELOG.md, VERSION, update.ts
package.json  the app's, with eta as a Bun workspace ("workspaces": ["eta"], "eta": "workspace:*")
CLAUDE.md, CHANGELOG.md, todo.jsonl, README.md, .claude/ (skills, hooks), .env, .env.test
```

- The app imports eta by name, never by a path into `eta/`: `import { story } from "eta/stories"`,
  `import "eta/client/app"`, `@import "eta/bento.css"`. eta/package.json's `exports` maps `eta/<x>`
  to `eta/src/<x>.ts`; inside `eta/`, the kernel and the model's page import each other relatively.
- The scripts run eta's own files on the app: `ETA_EXAMPLE=./src bun eta/src/start.ts` (dev, start),
  `eta/src/stories-run.ts` (stories), `eta/src/cli.ts` (cli); `bun run model` and `bun run cli:model`
  are `ETA_EXAMPLE=./eta/model`. `bun run model:check` and `model:load` read `./src`.
- `.env` holds the model's name, who keeps it, and the password they share.
- eta's docs a project keeps are in `eta/docs/` (what stories are for, the bento's rules).

The kernel finds an app by `ETA_EXAMPLE`: an example by name (`chat`, in eta) or a folder (`./src`).

## Moving a project to a later eta

`bun run eta:update` (the latest release), `bun run eta:update 0.54.0` (a release), or
`bun run eta:update ../eta` (a checkout, as it stands). It replaces `eta/` whole, sets the root's eta
scripts and the kernel's dependencies at that eta's versions, installs, refreshes the eta-app,
modelling, delta-doc and railroad skills, notes it in the project's changelog, prints what eta's
changelog says changed since `eta/VERSION` -- what to change first -- and runs the gate. It commits
nothing: carry across what each "What to change" says, run the gate until it passes, then commit.

Never edit `eta/` in a project: the next update replaces it. A change the kernel needs is eta's,
made there and released.

A project made before `eta/` was (`app/`, `model/`, and eta's kernel in `src/`) has no
`eta/update.ts`. From its root, run eta's: `bun ../eta/create/update.ts ../eta` with a checkout
beside it. It moves the project once: `app/` becomes `src/`, its imports of `../src/...` become
`eta/...`; eta's `src/`, `model/` and docs go to `eta/`; `migrations/` is made; `tsconfig.json`,
`bunfig.toml` and `CLAUDE.md` follow (`git diff CLAUDE.md` for lines of your own).

## When it looks like you need to touch the kernel

A seam is missing from what you know, not the app special:

- may this session write at all: `Example.active`; an extra HTTP route: `Example.routes`; who a
  request is before its socket opens: `Example.identify` ([example.md](example.md));
- a fresh write that differs from its undo: `shape` (undo is never shaped); what follows a write:
  `afterChange` or `afterWrite`, an undo or redo: `afterWalk` ([resource.md](resource.md));
- saying what just happened: `tell`, never a field of your own session ([refusal.md](refusal.md)).

Never teach the kernel the name of a document, applet or resource.
