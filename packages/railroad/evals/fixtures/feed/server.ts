// The page at "/", and the jobs over a WebSocket at "/ws": on connect { jobs }, every job, then
// { job } each time one changes, the whole job. One changes every half second.
import index from "./index.html";

type Status = "queued" | "running" | "failed" | "done";
type Job = { id: number; name: string; status: Status; updated: number };

const STATUSES: Status[] = ["queued", "running", "failed", "done"];
const NAMES = ["build api", "build web", "test unit", "test e2e", "lint", "deploy docs"];
const COUNT = 2000;

const jobs: Job[] = Array.from({ length: COUNT }, (_, i) => ({
  id: i + 1,
  name: `${NAMES[i % NAMES.length]} #${i + 1}`,
  status: STATUSES[i % STATUSES.length]!,
  updated: Date.now() - (COUNT - i) * 1000,
}));

const server = Bun.serve({
  port: process.env.PORT || 3000,
  routes: { "/": index },
  fetch(req, server) {
    if (new URL(req.url).pathname === "/ws" && server.upgrade(req)) return;
    return new Response("Not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      ws.subscribe("jobs");
      ws.send(JSON.stringify({ jobs }));
    },
    message() {},
  },
  development: process.env.NODE_ENV !== "production" && { hmr: true, console: true },
});

setInterval(() => {
  const job = jobs[Math.floor(Math.random() * jobs.length)]!;
  job.status = STATUSES[(STATUSES.indexOf(job.status) + 1) % STATUSES.length]!;
  job.updated = Date.now();
  server.publish("jobs", JSON.stringify({ job }));
}, 500);

console.log(`Listening on ${server.url}`);
