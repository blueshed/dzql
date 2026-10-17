import { afterAll, beforeAll, expect, test } from "bun:test";
import { createServer } from "dzql/rendering/server";
import { run } from "dzql/modelling/harness";
import { stories } from "./stories";
import { example } from "./index";

let server: ReturnType<typeof createServer>;
beforeAll(() => {
  server = createServer(example, 0);
});
afterAll(() => {
  server.stop(true);
});

test("the page is served, and drawn over the socket: where to begin", async () => {
  expect((await fetch(server.url)).status).toBe(200);
  const url = new URL("/ws", server.url);
  url.protocol = "ws:";
  const ws = new WebSocket(url);
  const page = await new Promise<string>((resolve) => ws.addEventListener("message", (event) => resolve(JSON.parse(String(event.data)).html)));
  expect(page).toContain("Tell the first story");
  ws.close();
});

test("nobody writes anything yet", () => {
  expect(example.active("anyone")).toBe(false);
});

test("every story passes", async () => {
  const report = await run(example, stories);
  expect(report.failed).toBe(0);
});
