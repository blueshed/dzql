# Skill evaluations

A few scenarios per shipped skill (`railroad.json` four, `bun-route.json` three), each aimed at a trap
the skill exists to prevent. They are not run by `bun test` and do not ship to npm.

Every scenario, each a fresh session with nobody there: `bun scripts/evals.ts --only
railroad/<skill>` from the repository's root, which makes each project from the checkout and keeps
what each session did. Each run is graded, line by line, and recorded in `runs/<date>-<skill>.md`;
a change to the skill is measured against the last.

To run one by hand: in a fresh, empty folder, start a new Claude Code session with the
skills in `skills` loaded (copy `.claude/skills/` in), give it the `query` word for word (where
the query describes an existing project, let it create those files first), then check the
code it writes against each line of `expected_behavior`. Every line should hold. Run each
scenario with and without the skill to see what the skill adds.
