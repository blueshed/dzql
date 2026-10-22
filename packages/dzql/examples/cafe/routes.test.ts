import { afterAll, beforeAll, expect, test } from "bun:test";
import { run } from "dzql/modelling/harness";
import { nextMessage, open, pageOf, write, type WireMessage } from "dzql/rendering/test-socket";
import { DEMO_DOOR } from "dzql/rendering/links";
import { links } from "./links";
import { stories } from "./stories";
import { app, startServer } from "./routes";
import { pool } from "./store";
import { orderOf } from "./resources/kitchen/kitchen-api";

/** The first message `ws` is sent that `is` picks, the ones before it passed by. */
async function until(ws: WebSocket, is: (m: WireMessage) => boolean): Promise<WireMessage> {
  for (;;) {
    const m = await nextMessage(ws);
    if (is(m)) return m;
  }
}

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

test("the door: each of the staff's link, and each table's code; a path that is no screen of the cafe's is 404", async () => {
  expect((await fetch(server.url)).status).toBe(200);
  expect((await fetch(new URL("/tables", server.url))).status).toBe(200);
  expect((await fetch(new URL("/no-such-screen", server.url))).status).toBe(404);
  const page = await pageFor();
  for (const way of links.ways()) expect(page).toContain(`href="${way.path}"`);
  expect(page).toContain("Mo, the manager");
  expect(page).toContain("Kit, the cook");
  expect(page).toContain('action="/scan"');
  expect(page).toContain("Table 4");
});

test("a member of staff's link asks, and its form signs them in, a fresh visit at their box, once; a link that is none signs nobody in", async () => {
  const link = new URL(links.ways()[0]!.path, server.url);
  const asked = await fetch(link, { redirect: "manual" });
  expect(asked.status).toBe(200);
  expect(await asked.text()).toContain("Sign in as Mo, the manager?");
  const signIn = () => fetch(link, { method: "POST", headers: { origin: link.origin }, redirect: "manual" });
  const res = await signIn();
  expect(res.status).toBe(303);
  expect(await pageFor(cookieOf(res))).toContain("The floor");
  expect((await signIn()).headers.get("set-cookie")).toBeNull(); // used
  const none = await fetch(new URL("/in/not-a-link", server.url), { method: "POST", headers: { origin: link.origin }, redirect: "manual" });
  expect(none.headers.get("set-cookie")).toBeNull();
});

test("in production the door lists none of the staff's links, and none is printed: a line says why", async () => {
  const env = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const page = await pageFor();
    expect(page).not.toContain("/in/");
    expect(page).toContain('action="/scan"'); // a customer still comes in by their table's code
    expect(links.say(server.url.origin)).toEqual([DEMO_DOOR]);
  } finally {
    process.env.NODE_ENV = env;
  }
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

// after the stories, which begin from the cafe as it was seeded: this one writes to it
test("a customer who has paid cannot take it back with Undo: paying is never undone, and the invoice stays paid", async () => {
  const mo = cookieOf(await fetch(new URL(links.ways()[0]!.path, server.url), { method: "POST", headers: { origin: new URL(server.url).origin }, redirect: "manual" }))!;
  const ann = cookieOf(await fetch(new URL("/scan?table=3", server.url), { redirect: "manual" }))!;
  const manager = await open(server, mo);
  write(manager, "visit", [{ op: "replace", path: "/page", value: "tables?table=3" }]); // the drawer reads the table's own document
  await until(manager, (m) => m.type === "render" && !!m.ops); // drawn there
  const seating = write(manager, "table:3", [{ op: "add", path: "/invoices/-", value: { paid: false } }]);
  expect((await until(manager, (m) => m.id === seating)).type).toBe("patch");
  const customer = await open(server, ann);
  const invoice = (await pool.query<{ id: string }>(`SELECT id::text FROM invoices WHERE tables_id = 3 AND NOT paid AND valid_to IS NULL`)).rows[0]!.id;
  const paying = write(customer, "table", [{ op: "replace", path: `/invoices/${invoice}/paid`, value: true }]);
  const paid = await until(customer, (m) => m.id === paying);
  expect([paid.type, paid.change]).toEqual(["patch", undefined]); // its echo names no change: there is none to undo
  const undoing = write(customer, "ledger", [{ op: "remove", path: "/latest" }]);
  expect((await until(customer, (m) => m.id === undoing)).type).toBe("refused");
  expect((await pool.query(`SELECT paid FROM invoices WHERE id = $1 AND valid_to IS NULL`, [invoice])).rows[0]).toEqual({ paid: true });
  manager.close();
  customer.close();
});
