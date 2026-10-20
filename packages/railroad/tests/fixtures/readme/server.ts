import home from "./index.html";

const server = Bun.serve({
  port: process.env.PORT || 3000,
  routes: { "/": home },
  development: process.env.NODE_ENV !== "production" && { hmr: true, console: true },
});

console.log(`Listening on ${server.url}`);
