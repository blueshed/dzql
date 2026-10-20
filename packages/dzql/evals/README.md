# Skill evaluations

Three scenarios per shipped skill (`modelling.json`, `dzql-app.json`), each aimed at a trap the
skill exists to prevent. They are not run by `bun test` and do not ship to npm. Their domains (a
bakery's pre-orders, a front desk, a team's leave, dog walks) are not the held-out Shed's
(paintbrush's `evals/shed/`), so a run of the Shed still measures what the skills lead to,
unprompted.

Every scenario, each a fresh session with nobody there: `bun scripts/evals.ts --only
dzql/<skill>` from the repository's root, which makes each project from the checkout and keeps
what each session did. Each run is graded, line by line, and recorded in `runs/<date>-<skill>.md`;
a change to the skill is measured against the last.

To run one by hand: make a project with `bun create dzql` in a fresh folder (its skills install
with it), start a new Claude Code session in it, give it the `query` word for word, then check
what it does and writes against each line of `expected_behavior`. Every line should hold. Run
each scenario with and without the skill to see what the skill adds. A query that is a teller's
words wants someone there to answer; for a run with nobody there, the skill says to take the
most natural reading and go on.
