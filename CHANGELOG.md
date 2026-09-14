# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
