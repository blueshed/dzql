# leave, its page kept on the session

The start of `dzql-app.json`'s scenario 2: dzql's `examples/leave` as it would be before a tab had
an address of its own. Where a person stands is a `page` column of their session, so every tab of
the session follows it, a tab opened at a URL stands wherever the session is, and the request a
write made is opened by a `serverWrite` of the session's page. `annOpensNovember` and `moFollowsLink` are not there.
Everything else is leave as it is.

The scenario copies `src/` over a new app's `src/`, and `tests/` and `stories.ts` over the
starter's, so the start passes `bun check`, `bun test` and `bun run stories`. dzql's `bun check`
type-checks it here; nothing runs its tests here.
