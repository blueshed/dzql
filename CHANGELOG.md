# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
