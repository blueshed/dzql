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
