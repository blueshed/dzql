# Docs

What is here goes deeper than a README and is not the manual: the root
[CLAUDE.md](../CLAUDE.md#what-each-document-is-for) says what each kind of document is for.

- [stories.md](stories.md): what the stories are for, and how they drive an app, from paintbrush to dzql.
- [rendering.md](rendering.md): the thin client, dzql's pages drawn on the server, and what a write
  costs, measured (kept true by dzql's `bun run costs`).
- [bento/](bento/README.md): how a page looks and moves, and the designs it was drawn from.
- [postgres/](postgres/postgres.md): delta's documents on Postgres, compiled by dzql: setting up,
  [the stored functions](postgres/sql.md), [row-level security](postgres/rls.md).
- [why-railroad.md](why-railroad.md): the reasons behind railroad.
- [history/](history/documents-history.md): the lineage, from documents and paintbrush to dzql on delta.

Finished plans, change requests, reviews and the feedback from blank-agent runs are in git's history
or in `history/` (the plan of 19 October and the client plan, both done), not here; CHANGELOG.md
says what each changed, and `todo.jsonl` what is still open.
