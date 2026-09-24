# chat on delta: findings

*24 September 2026. The question: can eta be the thing that ties it together — eta's page, an
applet (railroad here; React would do), and a delta document underneath?*

## What was done

- `chat-delta` is chat with its rooms moved into a delta document (`room:<name>`, root `rooms`,
  collection `messages`), read and written through delta's SQLite backend in-process. The session
  (eta's tray), presence, the page, the ledger and undo stay eta's.
- delta gained four things on the branch `experiment/eta-engine` (all additive; delta's own CI,
  Postgres included, 396 pass):
  1. **Savepoints.** A write is `db.transaction(...)`, not a bare `BEGIN`, so it nests inside a
     caller's transaction. eta's `patch()` is one transaction and its harness rolls every story back.
  2. **The inverse.** `{action: "delta", ..., inverse: true}` answers with the ops applied and their
     inverse (`inverseOf`), read from the document as it was. eta's ledger records it as it stands.
  3. **`createLocal()`** (`@blueshed/delta/local`): delta with no socket. A backend registers on it as
     on `createWs()`; the caller runs `open`/`delta` as function calls.
  4. **Implied documents.** `defineDoc(..., { implied: true })` opens empty when the root row is
     missing; the first write makes the row. A chat room is there before anyone speaks in it.
- The conversation is a railroad applet (`applets/transcript-applet.tsx`) fed by delta's ops
  straight off eta's echo, laid on with delta's own `applyOps`.

## Results

- **All ten of chat's stories pass, sentences unchanged.** Two paths changed (`/transcript/-` →
  `/messages/-`). Sabotaged (inverse recorded as `[]`), "Ada says hello" fails with *undo did not
  restore*. chat, the wedding and the ticker are unaffected (10, 46, 16); `bun test` 324, 100%.
- **In a browser**, Ada in a tab and Bob from eta's CLI: a message reaches the room as one patch of
  ~265 B and nothing else; an undo is one 121 B `remove`; a redo brings the same row back under the
  same id. Presence was a patch and a whole page (~3.5 KB, the transcript's props included); since
  it became its own document (below) it is a patch and the `#people` strip (~350 B).
- The adapter (`delta.ts`) is ~45 lines. The room document (`documents/room.ts`) went from 98
  lines of hand-written SQL, inverses and index arithmetic to 34.

## Findings

1. **One channel, one source.** The browser found what the stories could not: eta echoed its own
   presence ops (`/people/-`) on the room's channel, which is delta's document. The applet's
   `applyOps` met a path it does not hold and threw. The rule is that a channel carries one
   document's ops, so presence is now a document of its own, `here:<room>`
   (`compartments/here.ts`): eta's, live, never on the ledger, written by nobody over the wire.
   The room compartment lost all its presence code and answers `fragments` with `[]`; the applet
   lost its filter. Sabotaged (`here` telling nobody), both arrival stories fail.
   `here` has no ledger, so `inspect` always reports it at v0; its version is a count kept in memory.
2. **The harness cannot see into an applet.** Canon 2 leaves out a `data-doc` applet's props,
   trusting that the patches carry it. With applets on delta ops the harness could check it: lay
   each member's received ops onto the props they last had (delta's `applyOps`) and compare with
   fresh props. That is epsilon's law, and it would make the kernel import `@blueshed/delta/core`.
3. **Two histories.** delta's temporal tables and eta's ledger both remember. This run turned
   temporal off. The ledger is the one with sessions and undo; if the inverse is now delta's, the
   cursor could be too.
4. **delta's cache assumes it is the only writer and that commits stick.** eta reads through and
   evicts after every call. Fine for chat; a document read on every render wants the cache kept
   and evicted on rollback instead.
5. **An implied document's row outlives its undo.** Undo the first message and the room's row
   stays, empty — the same as an unmade room to every reader, but not the same rows.
6. **Railroad's function child is text.** A function child returning an element renders
   `[object HTMLSpanElement]`; `when()` is the answer. Documented, and warned on the console, and
   still the first thing wrong.
7. **Progressive, but not no-JS.** eta's first paint arrives over the socket, so the ladder is not
   HTML → JS. It is who draws: the server's HTML by default, an applet where a region needs state of
   its own, and one wire, delta's ops, under both.
