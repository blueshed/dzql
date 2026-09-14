# CLAUDE.md

Bun only — never `node`, `npm`, or `yarn`. Run tests with `bun test --coverage`, aiming for 100%. Verify every bug fix by reverting it, confirming the new test fails, then restoring it.

## Architecture

- `migrations/*.sql` → `src/documents/*.ts` (SQL read/write; `patch()` is the only write path, computing each op's inverse) → `src/ledger.ts` (records every patch + inverse; `nextUndo` derives undo's cursor from it, no separate state) → `src/concepts/*.ts` (owns one domain's wire behavior: `render`/`resolveDoc`/`permit`/`write`; concepts talk to each other only through `src/concepts/bus.ts` events, never by importing each other's internals) → `src/server.ts` (generic `{doc, ops}` dispatcher; no per-feature branches) → `src/client/` (browser: `app.ts` forwards `data-write` gestures and morphs renders via `morph.ts`).

## Rules from the change request that shaped this

- HTML is the only vocabulary. No node/JSON tree on the wire or in the client.
- A write names a document and a JSON Pointer path — never a function name.
- No client-side domain state beyond the small op-log in `window.eta.docs()`.
- The client morphs (`morph.ts`) instead of replacing `innerHTML`; `[data-applet]` elements are a boundary the morph never descends into.
- No new dependencies without asking first.
