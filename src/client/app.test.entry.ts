// Test entry point for app.ts in a real browser, without any example: loads it exactly as a
// browser would (`client/main.ts` always imports this kernel entry last). app.ts connects a
// WebSocket on load; app.test.ts's fixture server accepts the upgrade and does nothing with it,
// then drives the client by replacing `window.eta.socket().send` and dispatching synthetic
// "message" events on that same socket -- app.ts itself needs no test-only seam for this.
import "./app";
