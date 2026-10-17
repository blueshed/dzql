# Docs

The vision, how an app is made, is stated once: the root [README](../README.md#how-an-app-is-made).
Each package's README, CHANGELOG.md, CLAUDE.md and skills (`.claude/skills/`) stay with the package.
The documents here go deeper, by package. Where one disagrees with the code or a skill, the code is
right; fix the doc.

## Guidance

- **railroad**: [why-railroad.md](railroad/why-railroad.md), the reasons behind it.
- **dzql**:
  - [modelling/stories.md](dzql/modelling/stories.md): what the stories are for, and how they drive an app.
  - [rendering/](dzql/rendering/README.md): pages the server draws (eta): [eta.md](dzql/rendering/eta.md)
    (what it is, its measured costs, kept true by `bun run costs`), [first-app.md](dzql/rendering/first-app.md),
    [the bento](dzql/rendering/bento/README.md).
  - [postgres/](dzql/postgres/postgres.md): delta on Postgres: setting up, [the stored functions](dzql/postgres/sql.md),
    [row-level security](dzql/postgres/rls.md).
- **delta** and **paintbrush** keep theirs in their READMEs and skills.

## The record

How things came to be, all built. Kept because the changelogs and code comments cite them; nothing
here is guidance.

- [monorepo-plan.md](monorepo-plan.md): how railroad, delta, dzql and eta came into one repository.
- [stories-as-code.md](stories-as-code.md): how `story()` came to be one format from paintbrush to eta.
- [delta/link-sign-in-plan.md](delta/link-sign-in-plan.md): sign-in by link (delta 1.1.0).
- [dzql/postgres-split-plan.md](dzql/postgres-split-plan.md): how Postgres moved from delta to dzql.
- [dzql/modelling/](dzql/modelling/): [eta-modeller.md](dzql/modelling/eta-modeller.md),
  [document-proofs.md](dzql/modelling/document-proofs.md).
- [dzql/rendering/](dzql/rendering/README.md): the requests and reviews that shaped eta.
- [dzql/eta-history/](dzql/eta-history/CHANGELOG.md): eta's changelog and ledger, from before it came into dzql.
- [history/](history/documents-history.md): the lineage: documents, paintbrush, eta on delta, and before.
