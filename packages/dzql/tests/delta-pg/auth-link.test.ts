/**
 * Link sign-in's store on Postgres (`dzql/auth-link`): delta's cases (`linkStoreCases`), on Postgres in
 * the process and on the Postgres server, where two taps of one link at once are two connections.
 */
import { afterAll, expect, test } from "bun:test";
import { linkStoreCases } from "@blueshed/delta/testing";
import { openPglite } from "../../src/postgres/pglite";
import { postgresLinkStore } from "../../src/postgres/auth-link";
import { newPool } from "./setup";

const lite = await openPglite();
const server = await newPool();
afterAll(async () => {
  await lite.end();
  await server.end();
});

linkStoreCases("pglite", () => postgresLinkStore(lite));
linkStoreCases("postgres", () => postgresLinkStore(server));

// person::int overflowed past 2^31: a person's id is a BIGINT, read whole
test.each([["pglite", () => lite], ["postgres", () => server]] as const)("%s: a person numbered past 2^31 keeps their number", async (_, db) => {
  const store = await postgresLinkStore(db() as any);
  const person = 2 ** 31 + 7, later = new Date(Date.now() + 60_000).toISOString();
  await store.addLink("big-link", { person, opens: null, expires: later });
  expect((await store.link("big-link"))?.person).toBe(person);
  expect((await store.useLink("big-link", new Date().toISOString()))?.person).toBe(person);
  await store.addSession("big-session", { person, expires: later });
  expect((await store.session("big-session"))?.person).toBe(person);
});

test("dzql link prints the first person's link, made in the app's Postgres", async () => {
  const { hashToken } = await import("@blueshed/delta/auth-link");
  const { PG_URL } = await import("./setup");
  const proc = Bun.spawn(["bun", `${import.meta.dir}/../../src/cli/index.ts`, "link", PG_URL, "1", "--origin", "https://my.app", "--opens", "/posts", "--json"], { stdout: "pipe", stderr: "pipe" });
  const [code, out] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
  expect(code).toBe(0);
  const { url } = JSON.parse(out);
  expect(url).toMatch(/^https:\/\/my\.app\/#\/in\/[\w-]{43}$/);
  expect(await (await postgresLinkStore(server)).link(hashToken(url.split("#/in/")[1]))).toMatchObject({ person: 1, opens: "/posts", used: null });
});
