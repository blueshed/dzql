import { afterAll, beforeAll, expect, test } from "bun:test";
import { run } from "dzql/modelling/harness";
import { activeDocuments, settled } from "dzql/rendering/documents";
import { open, pageOf } from "dzql/rendering/test-socket";
import { stories } from "../stories";
import { app, startServer } from "../src/routes";

let server: Awaited<ReturnType<typeof startServer>>;
beforeAll(async () => {
  server = await startServer({ port: 0 });
});
afterAll(() => {
  server.stop(true);
});

test("the page is served, and drawn over the socket: signing in", async () => {
  expect((await fetch(server.url)).status).toBe(200);
  const ws = await open(server); // and its first page drawn
  expect(pageOf(ws)).toContain('action="/login"');
  ws.close();
});

test("a visitor, signed in as nobody, writes nothing", async () => {
  // asked as the kernel asks it, the documents it reads loaded first
  expect(await settled(activeDocuments(), () => app.active("anyone"))).toBe(false);
});

test("every story passes", async () => {
  const report = await run(app, stories);
  expect(report.failed).toBe(0);
}, 60_000);
