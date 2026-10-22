/**
 * An app's health and idle, as delta's serve asks them (`App.health`, `App.idle`): `appOf` gives its
 * store's `healthy`, and `compose` asks every app it holds, so `/health` answers 503 when any store
 * fails, and a stop waits for every app's work in flight.
 */
import { describe, expect, test } from "bun:test";
import { serve } from "@blueshed/delta/serve";
import { createLocal } from "@blueshed/delta/local";
import { appOf, compose } from "../../src/rendering/server";
import type { Example } from "../../src/rendering/example";

const shell = (name: string): Example => ({
  name,
  at: `/${name}`,
  resources: [],
  render: () => "<p>hi</p>",
  active: () => true,
  index: new Response("<!doctype html><title>t</title>") as never,
  delta: createLocal(),
});

const storeSaying = (said: () => boolean) => ({
  begin: async () => {},
  end: async () => {},
  last: async () => 0,
  since: async () => [],
  healthy: async () => said(),
});

describe("health", () => {
  test("appOf gives its store's healthy as the app's health; no store, no health", async () => {
    let ok = true;
    const app = await appOf({ ...shell("kept"), store: storeSaying(() => ok) as never });
    expect(await app.health!()).toBe(true);
    ok = false;
    expect(await app.health!()).toBe(false);
    expect((await appOf(shell("none"))).health).toBeUndefined();
    for (const close of app.close) await close();
  });

  test("compose is healthy when every app it holds is, and /health says so: 503 once a store fails", async () => {
    let ok = true;
    const a = await appOf({ ...shell("a"), store: storeSaying(() => ok) as never });
    const b = await appOf(shell("b"));
    const { server } = serve<string>(compose(a, b) as never, { port: 0 });
    try {
      expect((await fetch(new URL("/health", server.url))).status).toBe(200);
      ok = false;
      expect((await fetch(new URL("/health", server.url))).status).toBe(503);
    } finally {
      await server.stop(true);
      for (const close of [...a.close, ...b.close]) await close();
    }
  });

  test("compose's idle waits for every app's", async () => {
    const order: string[] = [];
    const slow = { routes: {}, idle: async () => { await Bun.sleep(20); order.push("slow"); } };
    const quick = { routes: {}, idle: async () => { order.push("quick"); } };
    await compose(slow as never, quick as never).idle!();
    expect(order.sort()).toEqual(["quick", "slow"]);
  });
});

test("the app's own /api/health answers from the same check", async () => {
  let ok = true;
  const app = await appOf({ ...shell("api"), store: storeSaying(() => ok) as never });
  const { server } = serve<string>(app as never, { port: 0 });
  try {
    expect(await (await fetch(new URL("/api/api/health", server.url))).json()).toEqual({ ok: true });
    ok = false;
    const res = await fetch(new URL("/api/api/health", server.url));
    expect([res.status, await res.json()]).toEqual([503, { ok: false }]);
  } finally {
    await server.stop(true);
    for (const close of app.close) await close();
  }
});
