---
name: evolve
description: "Adds a resource to this app or changes one: HTTP routes, a WebSocket push so every page follows, a table in SQLite, files in S3, then a delta document several people edit live, and beyond to eta. Use when the user asks for a new resource or route, for live updates, for sharing data between people, or for storage beyond a JSON file."
---

# Evolving a resource

A resource is a folder `src/resources/<name>/` of three files: `<name>-api.ts` (the type and the server handlers), `<name>.ts` (the client store) and `<name>-view.tsx` (the view). Its routes are written out in `src/server.ts`, and its view goes in a route in `src/app.tsx`. As it evolves, the client route and the view keep their names; only what is under them changes.

| Step | A resource is | Use it when | In this app |
|---|---|---|---|
| 1. HTTP routes | handlers and a fetching store | one person, or changes need not be seen live | `status` |
| 2. A WebSocket push | step 1, with each write published to every page | pages must follow the server, and a write is one whole value | `message` |
| 3. A delta document | a document every window holds and every write patches | several people write parts of the same data | — |
| 4. eta | a document drawn on the server, with who may write what stated as stories | several people at once, and who sees what matters | — |

A realtime shared tree with formulas (shinko) is meant to become a resource the same way, perhaps as a flavour of delta. It is work in progress and not yet a step.

Storage is a separate choice, made at any step: a JSON file (`message`), a table in SQLite, or files in an S3 bucket. A delta document has its own storage, which goes JSON file → SQLite → Postgres with no change to the browser code.

## Workflow

```
- [ ] Pick the lowest step that does what the user asked
- [ ] Copy the closest example from references.md, or from status/message
- [ ] Add a test for every route and method (400s included) and for what a person sees and clicks, a failure included
- [ ] bun test (100% coverage) and bun run typecheck
- [ ] A CHANGELOG.md entry under [Unreleased], and in todo.jsonl the item it settles marked fixed (or a new one for what is left open)
```

## References

[references.md](references.md) has one section per task, each with code and tests; read the one the step needs:

- **Add a resource**: HTTP routes, a store and a view, and the rules for handlers
- **Push changes over the WebSocket**: step 2
- **Store in SQLite**: `bun:sqlite`
- **Store in S3**: `Bun.s3`, with a stand-in bucket for tests
- **Make it a delta document**: step 3
- **Beyond: eta**: step 4
- **Build for production**: optional; the app runs from source

Step 4 starts from eta's own `first-app.md` and its `eta-app` skill.
