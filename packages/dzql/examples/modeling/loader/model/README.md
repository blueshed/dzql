# loader/model

A copy of hjeli's model and its six predicates (`grammar.ts`, `predicates.ts`, `paths.ts`,
`document-first.ts`, `migrations.ts`, from hjeli's `src/core/` at commit 98f3c9a), so that eta
depends on nothing outside itself. The files are as hjeli has them. A change to the predicates
is made in hjeli first, and copied here by hand when the loader needs it. hjeli's own tests
cover these files; eta's cover what the loader does with them.
