# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
