import { afterEach, expect, test } from "bun:test";
import { DEMO_DOOR, signInLinks } from "../../src/rendering/links";
import type { Sessions } from "../../src/rendering/sessions";

// A demo door: a link per person, said as the server starts and listed for a demo's home page, in
// development only. Each is used once, runs out, and is kept as its hash; opened, it asks first, and
// the form it posts, from the site's own page, starts a fresh session as its person.
const started: Record<string, unknown>[] = [];
const sessions: Sessions = { of: async () => "1", start: async (value = {}) => (started.push(value), { cookie: `cookie-${started.length}`, sessionId: String(started.length) }) };
const people = () => [{ name: "Mo", value: { role: "manager" } }, { name: "Kit <the cook>", value: { role: "cook" } }];

const tokenOf = (line: string) => line.slice(line.lastIndexOf("/") + 1);
const SITE = "http://x.example";
/** A link opened (GET, a tap) or its form posted (POST, from `origin`: the site's own unless said). */
const opened = (route: (req: never) => Promise<Response>, token: string, method = "GET", origin = SITE) =>
  route(Object.assign(new Request(`${SITE}/in/${token}`, { method, headers: method === "POST" ? { origin } : {} }), { params: { token } }) as never);

const env = process.env.NODE_ENV;
afterEach(() => {
  process.env.NODE_ENV = env;
});

test("each person's link, said at the server's origin under the app's path: the same until it is used or runs out, and across a reload (kept by key)", () => {
  const { say } = signInLinks("test-say", sessions, people, "/model");
  const lines = say("http://localhost:3000");
  expect(lines.map((l) => l.replace(/[0-9a-f-]{36}$/, "<token>"))).toEqual(["Mo: http://localhost:3000/model/in/<token>", "Kit <the cook>: http://localhost:3000/model/in/<token>"]);
  expect(say("http://localhost:3000")).toEqual(lines);
  expect(signInLinks("test-say", sessions, people, "/model").say("http://localhost:3000")).toEqual(lines);
});

test("each person's way in, for a demo's page: their name and the link's path", () => {
  const { ways, say } = signInLinks("test-ways", sessions, people, "/model");
  expect(ways().map((w) => w.name)).toEqual(["Mo", "Kit <the cook>"]);
  expect(ways().map((w) => `${w.name}: ${w.path}`)).toEqual(say(""));
});

test("opened, a link asks first: a page whose form posts it, so a link opened from another site, or by a preview, signs nobody in", async () => {
  const { say, route } = signInLinks("test-ask", sessions, people);
  const token = tokenOf(say(SITE)[1]!);
  const asked = await opened(route, token);
  expect(asked.status).toBe(200);
  expect(asked.headers.get("set-cookie")).toBeNull();
  expect(asked.headers.get("cache-control")).toBe("no-store");
  expect(asked.headers.get("referrer-policy")).toBe("no-referrer");
  expect(asked.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
  const page = await asked.text();
  expect(page).toContain('<form method="post">');
  expect(page).toContain("Kit &lt;the cook&gt;");
  expect(tokenOf(say(SITE)[1]!)).toBe(token); // asking used nothing
});

test("posted, a link starts a fresh session as its person and sends the browser home; once only", async () => {
  const { say, route } = signInLinks("test-route", sessions, people);
  const token = tokenOf(say(SITE)[1]!);
  const res = await opened(route, token, "POST");
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe("/");
  expect(res.headers.get("set-cookie")).toContain(`session_id=cookie-${started.length}`);
  expect(started.at(-1)).toEqual({ role: "cook" });
  const again = await opened(route, token, "POST");
  expect([again.status, again.headers.get("location"), again.headers.get("set-cookie")]).toEqual([303, "/", null]); // used: home, signed out
  expect(tokenOf(say(SITE)[1]!)).not.toBe(token); // the person's next link
  const unknown = await opened(route, "not-a-token");
  expect([unknown.status, unknown.headers.get("set-cookie")]).toEqual([303, null]);
});

test("a link's form posted from another site is refused, and the link is still there to use", async () => {
  const { say, route } = signInLinks("test-origin", sessions, people);
  const token = tokenOf(say(SITE)[0]!);
  expect((await opened(route, token, "POST", "https://elsewhere.example")).status).toBe(403);
  expect((await opened(route, token, "POST")).headers.get("set-cookie")).toContain("session_id=");
});

test("a link runs out: past its time it signs nobody in, and the person has a fresh one", async () => {
  const { say, route } = signInLinks("test-expiry", sessions, people, "", { ttl: 30 });
  const token = tokenOf(say(SITE)[0]!);
  await Bun.sleep(40);
  expect((await opened(route, token)).status).toBe(303); // home, not asked
  expect((await opened(route, token, "POST")).headers.get("set-cookie")).toBeNull();
  expect(tokenOf(say(SITE)[0]!)).not.toBe(token);
});

test("in production the door is shut: no link said or listed, a line saying so in their place, and none opens", async () => {
  const { say, ways, route } = signInLinks("test-production", sessions, people);
  const token = tokenOf(say(SITE)[0]!); // one made in development
  process.env.NODE_ENV = "production";
  expect(say(SITE)).toEqual([DEMO_DOOR]);
  expect(ways()).toEqual([]);
  expect((await opened(route, token, "POST")).headers.get("set-cookie")).toBeNull();
});
