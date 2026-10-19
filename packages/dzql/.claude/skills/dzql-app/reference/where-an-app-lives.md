# Where an app lives, and when it seems to need dzql's kernel

How a project is made and laid out, how it moves to a later dzql, and the seams to look for
before touching the kernel.

```sh
bun create dzql my-app   # the app is src/, begun as dzql's examples/starter
cd my-app
bun install              # also installs the skills: dzql-app, modelling, delta-doc
bun dev                  # the app, and the model's page at /model, where the stories are told first
bun test                 # bun run stories and bun run cli work on src/ too
```

## A project made with `bun create dzql`

```
stories.ts    what the app was asked to make true, each told by a test
src/          the app (begun as dzql's examples/starter):
  routes.ts                 the server: the app, its HTTP routes, the model's page in development
  store.ts                  where the documents are kept (PGlite, or a server at DATABASE_URL)
  page.ts                   the page, each resource's part in its place
  resources/<name>/         a document: <name>-api.ts, <name>.ts (its Resource), <name>-view.ts
  index.html, main.ts, styles.css, icons.ts
model/        what `dzql model` makes: types.ts, guards.ts, model.test.ts, and migrations/ (a field
              renamed or dropped, data moved, is a step of its own; never edit one that has run)
tests/        what the stories cannot say
package.json  the app's: dzql and @blueshed/delta as dependencies
CLAUDE.md, README.md, .claude/skills/ (from `delta install-skills`, run by `bun install`)
```

- The app imports dzql and delta by name, from `node_modules`: `import { story } from
  "dzql/modelling/stories"`, `import type { Example } from "dzql/rendering/example"`,
  `@import "dzql/rendering/bento-plain.css"`.
- `bun dev` is `bun --hot src/routes.ts --model`, `bun start` the same without the model and
  `--hot`: the server is delta's one server (`@blueshed/delta/serve`), the app giving it routes
  and resources, never a `Bun.serve` of its own; the model's page is `modelRoute()`
  (`dzql/model`), composed only in development. `bun run stop` is `delta stop`.
- dzql's own files run on the app for the rest: `src/modelling/stories-run.ts` (stories),
  `src/rendering/cli.ts` (cli), `dzql model` (`bun run model`: the model's page alone, and its
  verbs).

The kernel finds an app by `ETA_EXAMPLE`: an example by name (`chat`, in dzql) or a folder (`./src`),
and in it the `app` its `routes.ts` exports.

## Moving a project to a later dzql

Bump `dzql` (and `@blueshed/delta`) in `package.json` and `bun install`: the skills refresh with
it. Read dzql's `CHANGELOG.md` for what changed since your version, then run the gate. Never edit
dzql in `node_modules`: a change the kernel needs is dzql's, made there and released.

## When it looks like you need to touch the kernel

A seam is missing from what you know, not the app special:

- may this session write at all: `Example.active`; an extra HTTP route: one more in `routes.ts`'s `compose`; who a
  request is before its socket opens: `Example.identify` ([example.md](example.md));
- a fresh write that differs from its undo: `shape` (undo is never shaped); what follows a write:
  `afterChange` or `afterWrite`, an undo or redo: `afterWalk` ([resource.md](resource.md));
- saying what just happened: `tell`, never a field of your own session ([refusal.md](refusal.md)).

Never teach the kernel the name of a document, applet or resource.
