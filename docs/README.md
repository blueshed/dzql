# Docs

The documents about the packages, in one place, by package. What a package needs where it is stays
there: its README.md, CHANGELOG.md, CLAUDE.md and its skills (`.claude/skills/`, which
`delta install-skills` and npm read from the package).

Across the packages:

- [monorepo-plan.md](monorepo-plan.md): how railroad, delta, dzql and eta came into one repository.
- [stories-as-code.md](stories-as-code.md): one `story()` format from paintbrush to dzql/rendering.

By package:

- **railroad**: [why-railroad.md](railroad/why-railroad.md), the reasons behind it.
- **dzql**:
  - [philo.md](dzql/philo.md): what dzql is for, stories to documents to pages, and the compiled step.
  - [modelling/stories.md](dzql/modelling/stories.md): what the stories are for, and how they drive an app.
  - [rendering/](dzql/rendering/README.md): pages the server draws (eta): [eta.md](dzql/rendering/eta.md)
    (what it is, its measured costs, kept true by `bun run costs`), [first-app.md](dzql/rendering/first-app.md),
    [the bento](dzql/rendering/bento/README.md), and the requests that shaped it.
  - [postgres/](dzql/postgres/postgres.md): delta on Postgres: setting up, [the stored functions](dzql/postgres/sql.md),
    [row-level security](dzql/postgres/rls.md).
  - [eta-history/](dzql/eta-history/CHANGELOG.md): eta's changelog and ledger, from before it came into dzql.
- **delta** and **paintbrush** keep theirs in their READMEs and skills.
