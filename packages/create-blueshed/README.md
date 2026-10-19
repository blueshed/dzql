# create-blueshed

**You write your stories, a schema and documents. You get a live page, and proof that every story
holds: on a JSON file today, on SQLite or Postgres later.**

Start a Bun website from [paintbrush](../paintbrush), the light way, for prototyping: routes and
resources, [railroad](../railroad) for the page, [delta](../delta) for the documents, Railway for the
deploy. For performance (pages drawn on the server, documents compiled to Postgres), `bun create
dzql`.

```sh
bun create blueshed my-app
cd my-app
bun dev
```

Needs Bun 1.4.3 or later. This package is only the way in: the app is `packages/paintbrush`, a
working app with its own tests, and publishing this package copies it in. `--no-install` copies it
only; `--no-git` makes no repository. `--local` (or `BLUESHED_LOCAL=1`), run from a blueshed/dzql
checkout, takes railroad, delta and dzql from it rather than npm, held by `overrides`: for trying the
packages as they are, before a release (the Shed eval is made so). Run `bun install` at the checkout's root
first, or delta cannot find railroad's subpaths.

## Releases

From 0.4.0 this package is published from [blueshed/dzql](https://github.com/blueshed/dzql) with
railroad and delta, paintbrush inside it. 0.3.0 ran `bun create blueshed/paintbrush`, which fetched
it from its own GitHub repository.
