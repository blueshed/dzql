// A document as the page reads it, held by a test: dzql's `documentsOf`, here over delta's socket
// (the page's `/ws`). Beside browser.ts, which tests the page itself: the two are what both clients
// share, so when the page moves to the server (the evolve skill's thin-client step) a test of a
// document stays as it is, and only this file changes.
import { documentsOf } from "dzql/rendering/test-socket";

/** A test's client of the app's documents, on `server`: `open` one, send to it, `undo`, `close`. */
export const documents = (server: { url: URL }) => documentsOf(server);
