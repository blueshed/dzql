# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.16.0] - 2026-09-14

### Added

- A CLI (`bun run cli`): `name`, `room`, `leave`, `logout`, `send`, `undo`, `inspect`, and `watch`, talking the same `{doc, ops}`/`{type:"inspect"}` protocol the browser does. It never touches rendered HTML — only ops and `inspect`, proving the document/ledger layer stands on its own without a browser. Identity persists across invocations via a local `.eta-session` file, the same role a browser cookie plays. `src/cli.ts` is a thin, untested entry point (argv, process I/O) in the same spirit as `start.ts`; the actual command logic lives in `src/cli/commands.ts` and is tested against a real server, same discipline as everywhere else.

## [0.15.0] - 2026-09-14

### Changed

- Reordered the migrations: ledger first, then sessions, then rooms. The ledger is generic infrastructure with no dependency on either document (`session_id` is a plain column, not a foreign key); rooms is the demo-specific concept and already depended on sessions existing (it adds the `room` column to it), so it has to come last. Renumbered `0003_ledger.sql` → `0001_ledger.sql`, `0001_sessions.sql` → `0002_sessions.sql`, `0002_rooms.sql` → `0003_rooms.sql`. Verified against a fresh file-backed database.

## [0.14.0] - 2026-09-14

### Changed

- Merged migration `0004_ledger_undo.sql` into `0003_ledger.sql`: still in development, with no deployed database whose upgrade path needs preserving, so the ledger's `undoes` column belongs in its `CREATE TABLE` rather than a follow-up `ALTER TABLE`.
- DRY pass over the code the change request grew: the `<docType>:<docId>` ledger key convention was a string template repeated in three files and hand-parsed in a fourth — centralized as `prefixDoc`/`splitDoc` in `ledger.ts`. `concepts/room.ts`'s repeated "echo the ops, then ask the room to re-render" sequence (a direct write, and undo landing on the room doc) is now one `echoAndNotify` helper; `concepts/session.ts`'s three near-identical echo-and-return branches in `write()` collapsed into the same pattern. `client/morph.ts` no longer reads an applet's `data-props` attribute three times to compare it against itself. No behavior changed; full suite still green at 100% coverage, plus a live two-browser smoke test.

- Rewrote `README.md` (a human-facing description of what eta is and how to run it) and `CLAUDE.md` (a concise map of the architecture and the change request's constraints, for whichever agent picks this up next).

### Removed

- `CHANGEREQUEST.md`: all six requests are implemented; kept out of git throughout per the working agreement with the session that wrote it.

## [0.13.0] - 2026-09-14

### Added

- Legibility (request 6, the last of the change request): a `{"type":"inspect"}` wire request answers with this connection's session, the documents it currently sees with their versions, and the latest ledger entry behind each one (`concepts/index.ts::inspectFor`). `window.eta.inspect()` answers the same question from the client's side: the docs it holds, plus the last write it sent and whether the server echoed it back. Both exist so a person can answer "what happened" without adding a log line; documented in the new README, each with its own test.

## [0.12.0] - 2026-09-14

### Changed

- Morph, don't replace (request 5): the client reconciles the existing DOM against a render's HTML instead of overwriting it with `innerHTML`. Same tag in the same place is reused, a different tag is replaced, and children are matched by `id` first, then by position (`src/client/morph.ts`, hand-rolled, no dependency). An element a person is focused on, typing into, or has scrolled survives a render that doesn't concern it, because it's the same element afterward.
- `[data-applet]` is a boundary the morph never descends into: it reconciles the element's own attributes, and calls the applet's new optional `update(el, props)` if `data-props` changed, but leaves the applet's hand-managed children alone. A mounted applet whose element disappears gets its cleanup run before removal; a newly-appeared one mounts after the morph, as before. `room-picker`'s `update()` refreshes its suggestions against new props without resetting the typed filter.
- Full renders are cheap now that they morph instead of replace, so the granular wire vocabulary for "someone joined," "a message arrived," or undo's transcript change is gone: everyone affected by a room change just gets asked to re-render (`renderRequested`, in `concepts/render.ts`). The `append` message type and the `selector` field on `render` are removed; a render is always the whole `#app`.
- A form resets on the **echo** of its own write, not on submit, so a refused or lost write hands the person's text back instead of silently discarding it.
- Removed the `[autofocus]` refocus behavior: a focused element now keeps focus by virtue of surviving the morph, so re-applying it after every render is no longer necessary. `data-autoscroll` stays, but only pins to the bottom when the element it's on actually gained content in that render -- an unrelated update (someone else's presence, an undo elsewhere) no longer yanks the scroll position.

## [0.11.0] - 2026-09-14

### Added

- Undo (request 4): a session's last write, walked back. `undo(sessionId)` finds the newest not-yet-undone entry this session wrote in the ledger, to any document, and applies its `inverse` as a new patch — so the undo is itself in the ledger and echoed. It's a cursor, not a toggle: `nextUndo`'s query excludes both entries already undone and undo-entries themselves, so pressing it repeatedly walks further back instead of toggling the same write on and off. One "Undo" button in the user bar, wired as `{"doc":"session","op":"add","path":"/undo"}` — undo is a per-session cursor, not a real field on the session document, but it's triggered through it since a session only ever has one.
- `documents/room.ts::patch()` now applies `remove /transcript/<index>` ops (previously only `add .../-` was implemented), needed so undo can actually walk back a sent message. Only reachable via undo: the room concept's `permit()` still never allows a bare "remove" write from the wire.

### Fixed

- Two of `documents/session.ts`'s computed inverses could restore a field to `null` via `{ op: "replace", value: null }` — but `patch()` treats a blank/null value as invalid and ignores it, so undoing a session's very first name-set or room-join would silently do nothing instead of logging out or leaving the room. Restoring "no value" is now expressed as `remove`, not `replace` with `null`.

## [0.10.7] - 2026-09-14

### Changed

- The dark green terminal theme was hardcoded (`color-scheme: dark`) regardless of the desktop's actual appearance setting. Colors are now CSS custom properties with a light default and a `prefers-color-scheme: dark` override, and `color-scheme: light dark` lets native form controls follow suit — the app now matches daylight/dark desktop settings instead of always looking like a terminal at night.

## [0.10.6] - 2026-09-14

### Changed

- Moved `index.html`, `styles.css`, and `app.ts` (with its test) into `src/client/`, separating the browser-delivered client from the server-side documents/concepts/ledger code that shares the `src/` root with it.

## [0.10.5] - 2026-09-14

### Fixed

- `renderFor`'s fallback throw (no concept produced a view) was unreachable in normal operation, since session and room together cover every state, leaving `concepts/index.ts` short of the project's 100% coverage standard. `renderFor` now takes an optional concepts list, defaulting to the real one, so a test can pass an empty list to exercise the throw without changing production behavior.

## [0.10.4] - 2026-09-14

### Fixed

- The client's reconnect backoff never reset after a successful reconnect: a client that had scaled up to the 10s maximum during a period of network turbulence would still wait 10s on its very next drop, hours later, instead of retrying promptly. `connect()`'s backoff is now shared module state that resets to the initial delay on the socket's `open` event.

### Added

- `window.eta.socket()` exposes the live WebSocket and `window.eta.reconnectDelay()` its current backoff — a person at the console can now see connection state directly, in the same spirit as `window.eta.docs()`.

## [0.10.3] - 2026-09-14

### Fixed

- A session open in two tabs in the same room showed up twice in the people list, once per socket. `peopleIn` now dedupes by name. Closing one of the two tabs correctly leaves the other's presence intact, since presence is recomputed from the live socket set on every broadcast rather than tracked incrementally.

## [0.10.2] - 2026-09-14

### Fixed

- Logging out while in a room now records an inverse that restores both `/name` and `/room`. Logout clears both columns in one statement, but the computed inverse only ever restored `/name` — an undo (coming in request 4) would have logged the person back in while leaving them orphaned from the room they were in.

## [0.10.1] - 2026-09-14

### Fixed

- Migrations now apply each file's statements and its `_migrations` bookkeeping row in one transaction. Previously a migration that failed partway (bad SQL, a constraint violation) could leave the schema half-applied with no record of the attempt, so the next run would neither retry nor recognize the mismatch. A failure now rolls back cleanly, leaving nothing behind to apply or to explain.

## [0.10.0] - 2026-09-14

### Changed

- Gestures are writes (request 3): the named wire events (`set-name`, `join-room`, `leave-room`, `logout`, `send-message`) are gone. An element now says what it writes: `<form data-write='{"doc":"session","op":"replace","path":"/name"}'>` (a form's field is the value), `<button data-write='{"doc":"session","op":"remove","path":"/room"}'>` (no value), `<li data-write='...' data-value="general">` (a `data-value` is the value). The client sends one shape up, always: `{doc, ops}`, where `doc` is a bare type name ("session" | "room") — never a concrete id, since a connection only ever sees its own session and the room it's currently in.
- The server resolves `doc` for the connection (a concept's `resolveDoc`), checks the concept's `permit` for each op, applies through the document's `patch()`, and echoes — one generic pipeline in `server.ts`, no per-event dispatch table. `Concept` shrank from an `events` map to `render`, `resolveDoc`, `permit`, `write` (`write` covers apply + side effects + echo, since only the owning concept knows its own document's audience and side effects).
- "Joining"/"leaving" a room is now a *consequence* of a session document write, not an event of its own: `session` emits `sessionPatched` after any successful write to its own document, and `room` subscribes to react to `/room` changes (and `/name` removal, for logout) — the same event-bus pattern already used for ending a session, generalized.
- The patch echo's `doc` field is now the bare type too (`"session"`/`"room"`), not the internally-prefixed ledger id — a connection only ever holds one document of each type, so `window.eta.docs()` is keyed the same way.

### Fixed

- Refactoring `join-room`'s guard into `permit()` initially dropped the check that a session must be logged in before it can write `/room` — reintroducing the exact stale-tab session leak fixed earlier. Caught before committing by re-deriving the message sequence from the spec and checking it against the existing regression test; `permit` now requires an active session for `/room` writes, same as before.

## [0.9.0] - 2026-09-14

### Added

- Echo the write (request 2 of the change request): when a document is patched, every connection that can see it now receives `{type: "patch", doc, version, ops}` *before* the HTML that follows. A session document's echo goes only to its own connection (direct send); a room document's echo broadcasts to every connection currently in that room, same audience as the existing `.people`/`.messages` broadcasts. `documents/session.ts::patch()` and `documents/room.ts::patch()` now return `{version, applied, ...}` — `applied` is only the ops that actually took effect, so the echo (and, later, the ledger) never claims a rejected write happened.
- The client keeps what it's seen, per document: the latest version and the last 5 ops, in memory, exposed as `window.eta.docs()` — a person at the console can read the session back without a log line for it.

### Fixed

- `server.test.ts`'s message helper created a fresh `{once: true}` listener per call, which had a latent race: two messages sent back-to-back by the server (now routine, with the patch echo landing immediately before its render) could both arrive before test code re-subscribed after awaiting the first, silently dropping one. Replaced with a persistent per-socket FIFO queue — messages are never lost regardless of when a test asks for them.

## [0.8.0] - 2026-09-14

### Added

- A ledger (`migrations/0003_ledger.sql`, `src/ledger.ts`): every patch a document applies is recorded as `(doc, version, ops, inverse, session_id, at)`, one shared table for every document type. `patch()` now returns the new version, and computes each op's inverse from the state *before* applying it — a `replace`/`remove` inverts to a `replace` back to the old value; an array `add` (only used for `/transcript/-` today) inverts to a `remove` at the index the item actually landed at in the full, unpaginated history, so it stays correct regardless of `read()`'s display limit. A patch where nothing actually applied (blank name, unrecognized path) doesn't record an entry or bump the version.
- Documents own the recording, not concepts — `documents/session.ts` and `documents/room.ts` call `ledger.record()` internally as part of `patch()`. This is the first of a sequence of changes (see the project's change request) building toward the write itself, not just its picture, being the source of truth.

## [0.7.5] - 2026-09-14

### Fixed

- A stale second tab (or any client) sharing a `session_id` cookie with a session that just logged out could still send `join-room` and have it silently succeed: `join-room` never checked that the session actually had a name before writing to it. The write was invisible through `read()` (filtered by `revoked_at`), but the socket was still added to the room's live broadcast set forever (nothing would ever remove it), and the stale room value could resurface if that session later set a name again. `join-room` now requires a name first, like `send-message` already did.
- Any targeted update — most commonly a presence-only `.people` render — was stealing focus back to the chat input and force-scrolling `.messages` to the bottom, because `app.ts`'s post-update behaviors (`[autofocus]`, `[data-autoscroll]`, applet mounting) scanned the whole page unconditionally instead of the region that actually changed. Scoped to the actual render/append target (handling the case where the target itself carries the matching attribute, not just a descendant).
- Both found via a multi-agent code review (`/code-review high`) with an independent verification pass per finding; both reproduced and fixed with regression tests, and manually confirmed by reverting each fix and watching its test fail.

## [0.7.4] - 2026-09-14

### Changed

- Renamed `src/session.ts`'s `SessionData` to `ConnectionData` (file renamed to `src/connection.ts`). It's the shape of `Bun.serve`'s per-connection data (`{ sessionId: string }`, an opaque connection identifier) — foundational plumbing used by `server.ts` and the generic `Concept` contract, not something owned by the session concept. The old name made it read as if it belonged there, which is what raised the question of folding it into `concepts/session.ts` in the first place (it can't be: `server.ts` and `concepts/concept.ts` both depend on it and must stay agnostic of any specific concept).

## [0.7.3] - 2026-09-14

### Changed

- Folded `src/rooms.ts` (the live socket registry) into `concepts/room.ts` as a private implementation detail. It was standalone only because `documents/session.ts` and `documents/room.ts` used to reach into it too; now that live connection state is exclusively a `concepts/room.ts` concern, its own module was no longer earning its keep.

## [0.7.2] - 2026-09-14

### Changed

- Removed the last direct cross-concept import: `concepts/session.ts`'s `logout` handler used to call `concepts/room.ts`'s `broadcastPeople`/`leaveRoom` directly. Added a minimal typed pub/sub (`src/concepts/bus.ts`); `session` now just emits `sessionEnded` without knowing or caring who's listening, and `room` subscribes to it and reacts on its own (leaving the room, broadcasting presence). `session.ts` no longer imports anything from `room.ts` at all.

## [0.7.1] - 2026-09-14

### Changed

- `documents/session.ts` and `documents/room.ts` no longer import `rooms.ts` (the live socket registry). Live connection state isn't persisted data, so it has no business being touched from the document layer: `patch()` on both documents is now pure SQL, and `documents/room.ts`'s `RoomDocument` drops `people` entirely (it only returns `transcript`, its one real query result).
- Presence (`people`) is now assembled in `concepts/room.ts` — combining the live socket registry with a session-document lookup per socket — and the `join-room`/`leave-room`/`logout` event handlers now own the `joinRoom`/`leaveRoom` calls directly, since they're the ones with a `ws` to act on. `documents/session.ts::patch()` dropped its `ws` parameter entirely as a result.
- Net effect: `documents/*` is SQL only; `concepts/*` is the only layer that touches live connection state, matching the concept/document split more precisely than before.

## [0.7.0] - 2026-09-14

### Changed

- `server.ts` and `views.ts` (now deleted) knew about "session" and "room" as specific concepts — hardcoded event names, direct document imports, an explicit name-then-room render order. Introduced `src/concepts/`: each domain idea is a self-contained `Concept` module owning its own wire events, rendering, and open/close lifecycle (`src/concepts/session.ts`, `src/concepts/room.ts`). `server.ts` now only knows the generic `Concept` shape — it merges every concept's `events` into one dispatch map and asks each concept in turn to render, with zero references to "session" or "room" as concepts (the remaining `sessionId` is just the opaque per-connection identifier, not the session concept).
- Wire protocol and rendered output are unchanged — this was a pure internal reorganization, verified by the full existing test suite passing untouched plus a live two-browser smoke test.



### Fixed

- Room presence (`people`) now broadcasts live to everyone already in a room when someone joins or leaves, instead of only being reflected on that member's own next render. Reuses the existing selector-aware `render` message (`{type: "render", selector: ".people", html}`) rather than a full-page re-render or new wire protocol.

## [0.6.0] - 2026-09-14

### Added

- Versioned SQL migrations (`migrations/0001_sessions.sql`, `migrations/0002_rooms.sql`), applied in order and tracked in a `_migrations` table (`src/migrate.ts`), replacing the `CREATE TABLE IF NOT EXISTS` calls that used to live in `db.ts`.
- Documents: `src/documents/session.ts` and `src/documents/room.ts` replace `db.ts`'s per-entity CRUD functions. A document's `read()` is a single query — SQLite's `json_object`/`json_group_array` build the JSON directly in SQL, so the query result *is* the document, not a row `read()` has to assemble. Writes go through `patch(id, ops)`, RFC 6902 JSON Patch operations resolved via RFC 6901 JSON Pointer paths (`src/json-pointer.ts`, `src/json-patch.ts`); each document type owns what a patch to its fields means, including side effects (e.g. patching a session's `/room` leaves the old room's live socket set and joins the new one).
- `db.ts` is now just the SQLite connection plus migration bootstrap — no business-logic-shaped exports.
- Room presence: the room document now includes `people` (names of currently-connected sessions in that room), derived from the live socket registry (`rooms.ts`) plus a session-document lookup per socket. Surfaced in the chat view as a simple list. Note: presence isn't broadcast live to other members on join/leave (unlike chat messages) — a room member only sees an updated people list on their own next render, not the instant someone else joins.

### Fixed

- Patching a session's `/room` used to assume a `sessions` row already existed (created via `/name`); calling it in isolation was a silent no-op against a nonexistent row. `sessions.name` is now nullable and joining a room upserts the row, so a document's patch API doesn't have a hidden required call order.

## [0.5.0] - 2026-09-14

### Added

- Applets: a minimal plugin mechanism for client-side components with their own lifecycle, layered on top of the existing render/append transport. A server-rendered `<div data-applet="name" data-props="...">` gets mounted by a registered `{ mount(el, ctx) }` handler (`ctx` gives `props` and the same `send()` the rest of the client uses); `app.ts` stays domain-agnostic — it only knows the generic mount contract, not what any applet does.
- First applet: `room-picker` (`src/applets/room-picker.ts`) replaces the room selector's static button-list-plus-form with a single input that filters the room list client-side as you type — no round trip per keystroke. It reuses the existing generic `data-event` delegation for both paths (a `<form data-event="join-room">` for creating/submitting by Enter, `<li data-event="join-room" data-room="...">` suggestions for clicking an existing room), so it needed no new wire protocol and no changes to `server.ts`'s event handling.
- `render` now accepts an optional target selector (defaulting to `#app`), so a future applet's own subtree can be replaced without a full-page re-render.

### Fixed

- `tsconfig.json` was missing the `DOM.Iterable` lib, which is where `FormData`'s (and `NodeList`'s, `URLSearchParams`'s, etc.) iterator/`entries()` live — some tools tolerated the gap, others (e.g. Zed's TS language server) correctly flagged `Object.fromEntries(new FormData(form))` as a type error.

## [0.4.1] - 2026-09-14

### Changed

- New chat messages no longer trigger a full-view re-render; the server sends a generic `{type: "append", selector, html}` event and the client inserts it at that selector. Payload size for a new message no longer scales with room history (measured ~263 bytes full render vs ~82 bytes append for a 20-message room, and the gap widens with history size).
- `app.ts` stays domain-agnostic: it only knows `render` (replace `#app`) and `append` (insert HTML at a server-given selector), plus the existing generic `data-event` delegation. Scroll-to-bottom is now a declarative `data-autoscroll` attribute the server can put on any element (mirroring the existing `autofocus` convention), not a hardcoded `.messages` special case in the client.
- Forms now call `.reset()` right after sending, since `append` no longer implicitly clears the sender's input the way a full re-render used to.

## [0.4.0] - 2026-09-14

### Added

- Room selector: after entering a name, a session picks an existing room (listed as buttons) or types a new one to create it; a "Change room" button in the chat view returns to the selector. Current room is tracked in `sessions.room`.

### Changed

- Chat is now persisted in SQLite instead of in-memory: new `rooms` (known room names) and `messages` (room, name, text, sent_at) tables. `src/rooms.ts` now only tracks currently-connected sockets per room (for broadcasting); message history and the room list survive a server restart.
- Logging out now also clears the session's current room, in addition to the name.
- `app.ts`'s click handler forwards any extra `data-*` attributes (e.g. `data-room`) as the event payload, so a single `join-room` event serves both the room-list buttons and the "create a room" form.

### Note

- No schema migration: a `db.sqlite` created before this change is missing the `sessions.room` column and will error on startup. Delete the local `db.sqlite` file (gitignored, dev-only) and it'll be recreated with the new schema.

## [0.3.0] - 2026-09-14

### Added

- Group chat: once a session has a name, it joins a shared room (`src/rooms.ts`) and sees a live message list plus a `send-message` form; messages broadcast to every connected room member in real time.
- `DEFAULT_ROOM` is a single hardcoded room for now (`"general"`), but the room registry (`Map<roomId, { sockets, messages }>`) is already keyed by room id, so multiple rooms are a matter of adding room selection later, not restructuring storage.
- In-memory message history capped at the last 50 messages per room (not persisted to SQLite — restarting the server clears chat history; sessions/names still persist).
- `app.ts` now restores focus to the `[autofocus]` element and scrolls `.messages` to the bottom after every re-render, since a full HTML replace otherwise drops both.

## [0.2.1] - 2026-09-14

### Changed

- Split `src/server.ts` down to just `Bun.serve` wiring: pid file handling moved to `src/pid.ts`, HTML rendering to `src/views.ts`.
- `sessions` table gained `created_at`/`revoked_at` timestamps; logout now soft-deletes (`revoked_at` set) instead of `DELETE`-ing the row, so a session id can be reactivated later and history isn't lost. `getSessionName` only considers rows where `revoked_at IS NULL`.
- Session cookie handling now uses Bun's built-in `request.cookies` (`CookieMap`) instead of a hand-rolled parser, which also fixes a crash on malformed `Cookie` headers and adds the `Secure` attribute in production.

### Fixed

- The `/ws` message handler could crash the entire server process on a malformed or incomplete client message (bad JSON, or valid JSON missing `payload`). Both are now handled without dropping the connection.

## [0.2.0] - 2026-09-14

### Changed

- Reworked the app as a server-rendered "thin client": the server owns all state and pushes rendered HTML fragments over `/ws`; `src/app.ts` only swaps `#app`'s HTML and forwards `submit`/`click` events (via `data-event` attributes) back over the socket as JSON. Replaced the old title/broadcast demo.

### Added

- `src/db.ts` — session storage via `bun:sqlite`, path configurable with the `DB_PATH` env var (added to `.env.example`).
- Cookie-based session id (`session_id`, set on `/ws` upgrade) ties a browser session to its SQLite row.
- Name-entry form → user label + logout button flow; logout clears the session row and re-renders the form.
- Browser-driven tests via `Bun.WebView` covering the full flow, including session persistence across a reload.

## [0.1.0] - 2026-09-14

### Added

- Bun HTTP server (`src/server.ts`) serving `src/index.html` via `Bun.serve` routes.
- `src/styles.css` and `src/app.ts` linked from `index.html`.
- `tsconfig.json` with `@types/bun`.
- `PORT` environment variable support with `.env.example`.
- Self-managed pid file (`server.pid`) written and cleaned up by the server itself.
- `start`/`stop` package.json scripts (`bun run start`/`bun run stop`) using `bun --watch` and the pid file.
- WebSocket `/ws` route (upgrade via the route handler, not `fetch`) with pub/sub broadcast, and a reconnecting client in `src/app.ts`.
