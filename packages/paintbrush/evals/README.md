# Skill evaluations

Four scenarios for the `evolve` skill (a new document; two documents, the kitchen and undo; files over HTTP; a schema change on a database holding orders), in the shape Anthropic's skill guidance uses:
a `query` to give a fresh session, and `expected_behavior` to check in what it writes.

To run one by hand: make an app from this template (the README says how),
open a new Claude Code session in it, paste the `query`, and check each expected behaviour
in the code and in `bun test`. Run each with Haiku, Sonnet and Opus when the skill changes.

**The Shed** (`shed/`) is a held-out example: an allotment society's tool library, told as
stories in five stages, from one shared document to two servers on dzql with each member seeing
their own. It appears in no skill or reference, so what a session makes of it is what the skills
and libraries lead it to. `shed/stories.md` is what a session is given, a stage at a time;
`shed/expected.md` is what each stage is checked against, and how a run is recorded.

These are about the template; setup deletes `evals/` from a new app.
