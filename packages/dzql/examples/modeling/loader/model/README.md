# loader/model

What `bun run model:check` uses of hjeli's model and its predicates (`grammar.ts`, `predicates.ts`,
`paths.ts`, from hjeli's `src/core/` at commit 98f3c9a): the model's types and four of the six
predicates (actor, precondition, referential and authorization closure), which the report reads
from a model made from an example's stories (`../from-stories.ts`, `../report.ts`). What nothing
here used was cut on 19 October (the comparison with another model, `--against`; the migrations
and document-first lowering; RLS compilation). The model's page has its own checks, `closure.ts`.
