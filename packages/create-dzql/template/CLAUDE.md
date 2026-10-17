# {{name}}

An app on dzql: stories first, then the documents a person needs in front of them to act, then
the page the server draws from them. The skills say how, and `bun install` puts them in
`.claude/skills` (`delta install-skills`):

- **modelling**: while someone tells you the stories, there to answer: the model's page
  (`bun run model`, `bun run cli:model <verb>`).
- **eta-app**: building or changing the app in `src/`: stories, documents, resources, the page.
- **delta-doc**: the documents themselves: schema, storage, the ledger. **railroad**: an island.

## The shape

An app is routes and resources on both sides of the socket, joined by documents; entities (the
collections of delta's `defineSchema`) are behind them, on the server. Here the server draws every
page, so the routes and resources are the server's: a resource (`Example.resources`) looks after
one document (who may write it, what a write becomes), and an island is the only client one. The
server is delta's one server, run by dzql's `start.ts`: never a `Bun.serve` of the app's own.

## Working here

- Start every feature with its story in `src/stories.ts`, watch `bun run stories` fail, build the
  least that makes it pass. A story with no body yet (`story(name)`) is unproven until it has one.
- The gate before a commit: `bun check`, `bun test`, `bun run stories`.
- Never edit dzql or delta in `node_modules`; move to a later one by bumping it in `package.json`.
