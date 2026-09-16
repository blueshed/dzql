// A standalone design mock-up, not an eta example: no documents, no compartments, no websocket --
// just index.html served so we can look at and click on the bento/zoom metaphor before it's worth
// wiring into anything real.

import index from "./index.html";

const port = process.env.PORT ?? 3003;

const server = Bun.serve({
  port,
  routes: { "/": index },
  development: process.env.NODE_ENV !== "production",
});

console.log(`Bento mock-up listening on ${server.url}`);
