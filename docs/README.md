# Docs

The documents about the packages, in one place, by package. What a package needs where it is stays
there: its README.md, CHANGELOG.md, CLAUDE.md and its skills (`.claude/skills/`, which
`delta install-skills` and npm read from the package).

Across the packages:

- [monorepo-plan.md](monorepo-plan.md): how railroad, delta, dzql and eta came into one repository.
- [stories-as-code.md](stories-as-code.md): one `story()` format from paintbrush to dzql/rendering.
- [stories-plan.md](stories-plan.md): where stories live, across eta, delta and paintbrush.
- [history/](history/documents-history.md): the lineage: documents, paintbrush, eta on delta, and before.

By package:

- **railroad**: [why-railroad.md](railroad/why-railroad.md), the reasons behind it.
- **delta**: [link-sign-in-plan.md](delta/link-sign-in-plan.md) (built in 1.1.0), [peared-plan.md](delta/peared-plan.md) (pears on delta, proposed).
- **dzql**:
  - [philo.md](dzql/philo.md): what dzql is for, stories to documents to pages, and the compiled step.
  - [postgres-split-plan.md](dzql/postgres-split-plan.md): how Postgres moved from delta to dzql.
  - [modelling/stories.md](dzql/modelling/stories.md): what the stories are for, and how they drive an app;
    [eta-modeller.md](dzql/modelling/eta-modeller.md), [document-proofs.md](dzql/modelling/document-proofs.md).
  - [rendering/](dzql/rendering/README.md): pages the server draws (eta): [eta.md](dzql/rendering/eta.md)
    (what it is, its measured costs, kept true by `bun run costs`), [first-app.md](dzql/rendering/first-app.md),
    [the bento](dzql/rendering/bento/README.md), [eta-language.md](dzql/rendering/eta-language.md),
    [css-review.md](dzql/rendering/css-review.md), and the requests that shaped it.
  - [postgres/](dzql/postgres/postgres.md): delta on Postgres: setting up, [the stored functions](dzql/postgres/sql.md),
    [row-level security](dzql/postgres/rls.md).
  - [eta-history/](dzql/eta-history/CHANGELOG.md): eta's changelog and ledger, from before it came into dzql.
- **paintbrush** keeps its in its README and the evolve skill.

These came from Workshop/docs on 17 October; the originals are still there.
