import { afterAll, beforeAll, expect, test } from "bun:test";
import { run } from "dzql/modelling/harness";
import { open, pageOf } from "dzql/rendering/test-socket";
import { links } from "./links";
import { stories } from "./stories";
import { app, startServer } from "./routes";
import { orderOf } from "./resources/kitchen/kitchen-api";

// What the stories cannot say: the door, the links and the codes on the tables, as a browser meets them.
let server: Awaited<ReturnType<typeof startServer>>;
beforeAll(async () => {
  server = await startServer({ port: 0 });
});
afterAll(() => {
  server.stop(true);
});

/** The page a cookie's session is drawn, over the socket. */
async function pageFor(cookie?: string): Promise<string> {
  const ws = await open(server, cookie);
  const page = pageOf(ws);
  ws.close();
  return page;
}
const cookieOf = (res: Response) => /=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1];
const form = (fields: Record<string, string>) => new URLSearchParams(fields);

test("the door: each of the staff's link, and each table's code", async () => {
  expect((await fetch(server.url)).status).toBe(200);
  const page = await pageFor();
  for (const way of links.ways()) expect(page).toContain(`href="${way.path}"`);
  expect(page).toContain("Mo, the manager");
  expect(page).toContain("Kit, the cook");
  expect(page).toContain('action="/scan"');
  expect(page).toContain("Table 4");
});

test("a member of staff's link signs them in, a fresh visit at their box; a link that is none signs nobody in", async () => {
  const res = await fetch(new URL(links.ways()[0]!.path, server.url), { redirect: "manual" });
  expect(res.status).toBe(303);
  expect(await pageFor(cookieOf(res))).toContain("The floor");
  const none = await fetch(new URL("/in/not-a-link", server.url), { redirect: "manual" });
  expect(none.headers.get("set-cookie")).toBeNull();
});

test("a table's code, scanned by a phone with no cookie yet, puts it at that table with a fresh visit", async () => {
  const res = await fetch(new URL("/scan?table=2", server.url), { redirect: "manual" });
  expect(res.status).toBe(303);
  const page = await pageFor(cookieOf(res));
  expect(page).toContain("waiting to be seated at Table 2");
  expect(page).toContain("Soup, Toast, Coffee");
});

test("a code for no table here is refused, and so is a scan posted from another site", async () => {
  const res = await fetch(new URL("/scan?table=99", server.url), { redirect: "manual" });
  expect(res.status).toBe(404);
  expect(await res.text()).toBe("There is no such table here.");
  const origin = new URL(server.url).origin;
  expect((await fetch(new URL("/scan", server.url), { method: "POST", body: form({}), headers: { origin }, redirect: "manual" })).status).toBe(404);
  expect((await fetch(new URL("/scan", server.url), { method: "POST", body: form({ table: "1" }), headers: { origin: "https://elsewhere.example" }, redirect: "manual" })).status).toBe(403);
});

test("every story passes", async () => {
  const report = await run(app, stories);
  expect(report.failed).toBe(0);
}, 60_000); // on Postgres in this process, the store put back after each story

test("an order shows its dish by the menu while the dish is on it, and by its own copy once it is taken off", () => {
  const order = { id: 1, invoices_id: 1, table_id: 1, dish_id: 1, dish_name: "Soup", dish_price: 5.5, status: "ordered" };
  expect(orderOf(order, [{ id: "1", name: "Soup of the day", price: 6 }])).toMatchObject({ dish: "1", item: "Soup of the day", price: 6 }); // the menu's, while it stands
  expect(orderOf(order, [{ id: "2", name: "Toast", price: 3 }])).toMatchObject({ dish: "1", item: "Soup", price: 5.5 }); // its surrogate, once it is gone
});
