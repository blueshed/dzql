import { expect, test } from "bun:test";
import { signInLinks } from "./links";
import type { Sessions } from "./sessions";

// A link per person, printed as the server starts; opened, it starts a fresh session as them.
const started: Record<string, unknown>[] = [];
const sessions: Sessions = { of: async () => "1", start: async (value = {}) => (started.push(value), { cookie: `cookie-${started.length}`, sessionId: String(started.length) }) };
const people = () => [{ name: "Mo", value: { role: "manager" } }, { name: "Kit", value: { role: "cook" } }];

const tokenOf = (line: string) => line.slice(line.lastIndexOf("/") + 1);
const opened = (route: (req: never) => Promise<Response>, token: string) => route({ params: { token } } as never);

test("each person's link, printed at the server's origin, under the app's path", () => {
  const { say } = signInLinks("test-say", sessions, people, "/model");
  const lines = say("http://localhost:3000");
  expect(lines.map((l) => l.replace(/[0-9a-f-]{36}$/, "<token>"))).toEqual(["Mo: http://localhost:3000/model/in/<token>", "Kit: http://localhost:3000/model/in/<token>"]);
  expect(say("http://localhost:3000")).toEqual(lines); // the same links each time, and across a reload (kept by key)
  expect(signInLinks("test-say", sessions, () => [], "/model").say("http://localhost:3000")).toEqual(lines);
});

test("opened, a link starts a fresh session as its person and sends the browser home; an unknown one only home", async () => {
  const { say, route } = signInLinks("test-route", sessions, people);
  const res = await opened(route, tokenOf(say("http://x")[1]!));
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe("/");
  expect(res.headers.get("set-cookie")).toContain(`session_id=cookie-${started.length}`);
  expect(started.at(-1)).toEqual({ role: "cook" });
  const unknown = await opened(route, "not-a-token");
  expect(unknown.headers.get("location")).toBe("/");
  expect(unknown.headers.get("set-cookie")).toBeNull();
});
