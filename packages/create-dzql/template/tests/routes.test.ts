import { afterAll, beforeAll, expect, test } from "bun:test";
import { run } from "dzql/modelling/harness";
import { activeDocuments, settled } from "dzql/rendering/documents";
import { open, pageOf } from "dzql/rendering/test-socket";
import { stories } from "../stories";
import { app, startServer } from "../src/routes";

let server: Awaited<ReturnType<typeof startServer>>;
// PGlite starts in the process: past bun's 5 s on a slower machine, so the start has 30
beforeAll(async () => {
  server = await startServer({ port: 0 });
}, 30_000);
afterAll(() => {
  server.stop(true);
});

test("the page is served, and drawn over the socket: where to begin", async () => {
  expect((await fetch(server.url)).status).toBe(200);
  const ws = await open(server); // and its first page drawn
  expect(pageOf(ws)).toContain("Tell the first story");
  ws.close();
});

test("nobody writes anything yet", async () => {
  // asked as the kernel asks it, the documents it reads loaded first: so it still holds once `active` reads the session
  expect(await settled(activeDocuments(), () => app.active("anyone"))).toBe(false);
});

test("every story passes", async () => {
  const report = await run(app, stories);
  expect(report.failed).toBe(0);
});
