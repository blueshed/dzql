---
name: evolve
description: "Grows this app: a new shared document, two documents on one page, keeping documents in SQLite (rows shared between documents, undo and history) or Postgres, HTTP routes for what isn't communication (health, status, files in S3), and a production build. Use when the user asks for something people share, see or act on, for storage beyond a JSON file, for undo or history, for files, or for a build."
---

# Growing the app

**Documents are how people communicate.** A document is what you need in front of you to take an action. To place an order you need the catalogue and your order: two documents on one page. The kitchen needs every open order, another document over the same rows.

A document is never a poster on the wall. It's a conversation. Open it and you're subscribed: every change anyone makes reaches you as it happens, with nothing to poll, fetch or refresh. Change it yourself with add, replace or remove on a path, and everyone holding it sees it at once. The verbs exist because documents change, and everyone holding a document always shares the same state.

**Think in documents, not entities.** Ask "what does someone need in front of them to do this?" rather than "what are the tables?" The tables follow from the documents.

**What grows is where they're kept.** A shared JSON document does a lot on its own. SQLite earns its place when documents share the same rows, or when you want undo and history. Postgres comes in when servers share the data, or people should see only their own. The page and its documents stay the same as the storage grows.

Anything people share is a document from the start, as `message` is. HTTP routes serve what isn't communication: the health check, files, the server's status (`status`).

A resource is a folder `src/resources/<name>/` of three files: `<name>-api.ts` (the server side, and the type both sides share), `<name>.ts` (the client: the document it opens, or what it fetches) and `<name>-view.tsx` (the view). The server side is wired in `src/server.ts`, and the view goes in a route in `src/app.tsx`.

## Workflow

```
- [ ] Ask what someone needs in front of them to do what the user asked: those are the documents
- [ ] Copy the closest section of references.md, or message / status
- [ ] Test what a person sees and clicks (a refused change included), and every route and method
- [ ] bun test (100% coverage) and bun run typecheck
- [ ] A CHANGELOG.md entry under [Unreleased], and in todo.jsonl the item it settles marked fixed (or a new one for what is left open)
```

## References

[references.md](references.md) has a section per task, each with its code and its tests:

- [A new document](references.md#a-new-document): a shared JSON document, made the way `message` is
- [Two documents on one page](references.md#two-documents-on-one-page): the catalogue and an order
- [Store documents in SQLite](references.md#store-documents-in-sqlite): rows shared between documents, and undo
- [Store in Postgres](references.md#store-in-postgres): PGlite in this process, then a Postgres server
- [Serve what isn't communication](references.md#serve-what-isnt-communication): HTTP routes, and files in S3
- [Build for production](references.md#build-for-production): optional

The `delta-doc` skill is delta's own manual, and `railroad` is the page's.
