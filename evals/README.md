# Skill evaluations

Three scenarios for the `evolve` skill (a new document; two documents, the kitchen and undo; files over HTTP), in the shape Anthropic's skill guidance uses:
a `query` to give a fresh session, and `expected_behavior` to check in what it writes.

To run one by hand: make an app from this template (the README says how),
open a new Claude Code session in it, paste the `query`, and check each expected behaviour
in the code and in `bun test`. Run each with Haiku, Sonnet and Opus when the skill changes.

These are about the template; setup deletes `evals/` from a new app.
