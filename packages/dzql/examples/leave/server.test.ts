import { afterAll, afterEach, beforeAll, describe, expect, setSystemTime, test } from "bun:test";
import type { PatchOp } from "dzql/rendering/json-patch";
import { createServer } from "dzql/rendering/server";
import { hear, type Heard } from "dzql/modelling/harness";
import { may, placed, shape, shapeSession, type Person, type Team } from "./documents";
import { alsoOff, calendarHtml, clashes, colourOf, days, daysOf, isWorkingDay, listRows, mondayOf, nextDay, nextMonth, offOn, prevMonth, rowHtml, workingDaysOf, type CalendarProps } from "./calendar";
import { app as example } from "./routes";
import { session } from "./resources";
import { db } from "./delta";
import { connectCli, runCommand } from "dzql/rendering/cli/commands";

let server: ReturnType<typeof createServer>;

beforeAll(() => {
  server = createServer(example, 0);
});

afterAll(() => {
  server.stop(true);
});

/** Posts the sign-in form, as a browser does: the answer, and the cookie it sets. */
async function signIn(email: string, password: string, headers: Record<string, string> = {}): Promise<{ res: Response; cookie?: string }> {
  const res = await fetch(new URL("/login", server.url), { method: "POST", body: new URLSearchParams({ email, password }), redirect: "manual", headers });
  return { res, cookie: /session_id=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] };
}

/** The hash a session's row keeps of its cookie (dzql/rendering/sessions). */
const hashOf = (cookie: string): string => new Bun.CryptoHasher("sha256").update(cookie).digest("hex");

type Tab = { ws: WebSocket; page: string; inbox: Heard[]; answered: (() => void)[] };

/** A tab on the session a cookie names: its page as the client keeps it, and everything it was sent. `headers`: what else its request carries (a proxy's). */
async function open(cookie: string, headers: Record<string, string> = {}): Promise<Tab> {
  const url = new URL("/ws", server.url);
  url.protocol = "ws:";
  // @ts-expect-error Bun's runtime-only `headers` option on WebSocket
  const ws: WebSocket = new WebSocket(url, { headers: { Cookie: `session_id=${cookie}`, ...headers } });
  const tab: Tab = { ws, page: "", inbox: [], answered: [] };
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as Heard;
    if (message.type === "inspect") return tab.answered.shift()?.();
    tab.inbox.push(message);
    tab.page = hear(tab.page, message);
  });
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  await settle(tab);
  return tab;
}

/** Everything sent before now has arrived: an inspect is answered after all of it. */
const settle = (tab: Tab): Promise<void> =>
  new Promise((resolve) => {
    tab.answered.push(resolve);
    tab.ws.send(JSON.stringify({ type: "inspect" }));
  });

async function send(tab: Tab, doc: string, ops: PatchOp[]): Promise<string> {
  tab.ws.send(JSON.stringify({ doc, ops }));
  await settle(tab);
  return tab.page;
}

const go = (tab: Tab, page: string) => send(tab, "session", [{ op: "replace", path: "/page", value: page }]);

describe("signing in", () => {
  test("signed in, a session may go to a page, draft, and sign out; never remove its page, nor say who it is", async () => {
    const { cookie } = await signIn("ann@leave.example", "ann-password");
    const tab = await open(cookie!);
    const sessionId = await example.session!(cookie!);
    const may = (op: PatchOp) => session.permit!({ data: { sessionId } } as never, op, sessionId);
    expect(may({ op: "replace", path: "/page", value: "list" })).toBe(true);
    expect(may({ op: "remove", path: "/page" })).toBe(false);
    expect(may({ op: "remove", path: "/person_id" })).toBe(true);
    expect(may({ op: "replace", path: "/person_id", value: "3" })).toBe(false);
    expect(may({ op: "replace", path: "/draft", value: {} })).toBe(true);
    expect(may({ op: "replace", path: "/draft/ends", value: "2026-10-01" })).toBe(true);
    expect(may({ op: "replace", path: "/draft/other", value: "x" })).toBe(false);
    expect(may({ op: "remove", path: "/draft" })).toBe(true);
    expect(may({ op: "remove", path: "/draft/starts" })).toBe(false);
    expect(may({ op: "replace", path: "/draft/starts/x", value: "x" })).toBe(false);
    tab.ws.close();
  });

  test("a good email and password start a fresh session, named by a new cookie, never the visit's own", async () => {
    const { res, cookie } = await signIn("ann@leave.example", "ann-password", { Cookie: "session_id=a-visit-someone-planted" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
    expect(cookie).toBeDefined();
    expect(cookie).not.toBe("a-visit-someone-planted");
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
    const tab = await open(cookie!);
    expect(tab.page).toContain('data-applet="calendar"');
    expect(tab.page).toContain("Sign out");
    tab.ws.close();
  });

  test("a wrong password, or an unknown email, is told on the page it came from, and signs nobody in", async () => {
    const visit = crypto.randomUUID();
    const tab = await open(visit);
    expect(tab.page).toContain('action="/login"');
    for (const [email, password] of [["ann@leave.example", "not-it"], ["nobody@leave.example", "ann-password"]] as const) {
      const { res, cookie } = await signIn(email, password, { Cookie: `session_id=${visit}` });
      expect(res.status).toBe(303);
      expect(cookie).toBeUndefined();
    }
    await settle(tab);
    expect(tab.page).toContain('<p class="refused" role="alert">That email and password do not match.</p>');
    expect((await signIn("ann@leave.example", "not-it")).cookie).toBeUndefined(); // no visit to tell: nothing said, nothing kept
    tab.ws.close();
  });

  test("the page signs in, so a GET goes home; a form posted from another site is refused", async () => {
    const get = await fetch(new URL("/login", server.url), { redirect: "manual" });
    expect(get.status).toBe(303);
    const { res, cookie } = await signIn("ann@leave.example", "ann-password", { Origin: "https://elsewhere.example" });
    expect(res.status).toBe(403);
    expect(cookie).toBeUndefined();
  });

  test("a visitor sees only the sign-in page, and a socket from another site is refused", async () => {
    const tab = await open(crypto.randomUUID());
    expect(tab.page).toContain('action="/login"');
    expect(tab.page).not.toContain('data-applet="calendar"');
    tab.ws.close();
    const refused = await fetch(new URL("/ws", server.url), { headers: { Origin: "https://elsewhere.example", Upgrade: "websocket", Connection: "Upgrade" } });
    expect(refused.status).toBe(403);
  });
});

describe("who you are, before the socket opens", () => {
  const SECRET = "what-the-proxy-sends";
  /** What the trusted proxy adds to a request: who it signed in, and the secret that says it is the proxy. */
  const proxy = (email: string, secret = SECRET) => ({ "X-Forwarded-Email": email, "X-Proxy-Secret": secret });
  /** The sessions signed in as a person, by the hash of the cookie that names each. */
  const sessionsOf = (personId: number) => db.query<{ cookie: string }, [number]>("SELECT cookie FROM leave_sessions WHERE person_id = ?").all(personId).map((r) => r.cookie);
  const wsUrl = () => Object.assign(new URL("/ws", server.url), { protocol: "ws:" }).href;
  beforeAll(() => void (process.env.LEAVE_PROXY_SECRET = SECRET));
  afterAll(() => void delete process.env.LEAVE_PROXY_SECRET);
  afterEach(() => void setSystemTime());

  test("A request from the trusted proxy naming Ann opens on Ann's calendar, with no sign-in", async () => {
    const before = sessionsOf(1);
    const planted = crypto.randomUUID();
    const tab = await open(planted, proxy("ann@leave.example"));
    expect(tab.page).toContain('data-applet="calendar"');
    expect(tab.page).toContain("Sign out");
    expect(sessionsOf(1).length).toBe(before.length + 1); // a fresh session, Ann's
    expect(sessionsOf(1)).not.toContain(hashOf(planted)); // never the visit's own
    tab.ws.close();
  });

  test("Ann's own session is kept when the proxy names her again; anyone else's is not hers", async () => {
    const ann = (await signIn("ann@leave.example", "ann-password")).cookie!;
    const first = await open(ann);
    await go(first, "list");
    const kept = sessionsOf(1).length;
    const again = await open(ann, proxy("ann@leave.example"));
    expect(sessionsOf(1).length).toBe(kept); // the same session: no fresh one
    expect(again.page).toContain('data-page=""'); // a tab of its own, at the page alone: where her other tab went is that tab's
    const bo = (await signIn("bo@leave.example", "bo-password")).cookie!;
    const before = sessionsOf(1).length;
    const named = await open(bo, proxy("ann@leave.example"));
    expect(sessionsOf(1).length).toBe(before + 1);
    expect(sessionsOf(2)).toContain(hashOf(bo)); // Bo's is still Bo's
    for (const tab of [first, again, named]) tab.ws.close();
  });

  test("the proxy is believed only with its secret, and refused for someone not on the team", async () => {
    const forged = await open(crypto.randomUUID(), proxy("ann@leave.example", "a-guess"));
    expect(forged.page).toContain('action="/login"'); // a visit, as though the header were not there
    forged.ws.close();
    delete process.env.LEAVE_PROXY_SECRET;
    const unset = await open(crypto.randomUUID(), proxy("ann@leave.example"));
    expect(unset.page).toContain('action="/login"'); // no proxy is trusted until one is set
    unset.ws.close();
    process.env.LEAVE_PROXY_SECRET = SECRET;
    const stranger = await fetch(new URL("/ws", server.url), { headers: proxy("cy@leave.example") });
    expect(stranger.status).toBe(403);
  });

  test("The CLI signs in as Ann with a token and reads her calendar", async () => {
    const ws = await connectCli(wsUrl(), `session_id=${crypto.randomUUID()}`, "ann-token");
    const { docs } = await runCommand(ws, { kind: "inspect" });
    expect(docs.map((d) => d.doc)).toContain("team:1"); // only someone signed in holds the team
    ws.close();
    await expect(connectCli(wsUrl(), `session_id=${crypto.randomUUID()}`, "not-a-token")).rejects.toThrow("could not connect");
  });

  test("Someone who keeps guessing Ann's password is slowed down", async () => {
    setSystemTime(new Date("2030-01-07T09:00:00Z")); // past every guess the tests before made
    const visit = crypto.randomUUID();
    const tab = await open(visit);
    const from = { Cookie: `session_id=${visit}` };
    for (let i = 0; i < 5; i++) await signIn("ann@leave.example", `guess-${i}`, from);
    expect((await signIn("ann@leave.example", "ann-password", from)).cookie).toBeUndefined(); // even the right one, for now
    await settle(tab);
    expect(tab.page).toContain("Too many tries: wait a minute, then try again.");
    expect((await signIn("bo@leave.example", "bo-password")).cookie).toBeDefined(); // Bo is not slowed by guesses at Ann
    setSystemTime(new Date("2030-01-07T09:01:01Z"));
    expect((await signIn("ann@leave.example", "ann-password")).cookie).toBeDefined(); // a minute on, she may try again
    tab.ws.close();
  });
});

const withAnn =async () => open((await signIn("ann@leave.example", "ann-password")).cookie!);
const withMo = async () => open((await signIn("mo@leave.example", "mo-password")).cookie!);
const undo = (tab: Tab) => send(tab, "ledger", [{ op: "remove", path: "/latest" }]);

describe("the page", () => {
  afterEach(() => void setSystemTime()); // a test that pins the clock gives it back, pass or fail
  test("one calendar: three months from the one it names, today marked, Previous, Today and Next a month at a time; the list is the same requests", async () => {
    // today is a month the test names no other way: on a day in October 2026, "2026-10" would be today's
    setSystemTime(new Date("2026-09-15T12:00:00Z"));
    const mo = await withMo();
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const here = await go(mo, "");
    expect(here).toContain(now.toLocaleDateString("en-GB", { timeZone: "UTC", month: "long", year: "numeric" }));
    expect(here).toContain(`aria-current="date">${Number(today.slice(8))}<span class="sr-only">, today</span>`);
    expect(here).toMatch(/aria-label="Today" aria-pressed="true"/);
    const oct = await go(mo, "2026-10");
    expect(oct).toContain("October 2026");
    expect(oct).toContain("December 2026");
    // a month at a time, each by its own name whatever today is, so every month is one a person can get to
    expect(oct).toMatch(/aria-label="Previous" data-write='[^']*' data-value='"2026-09"'/);
    expect(oct).toMatch(/aria-label="Next" data-write='[^']*' data-value='"2026-11"'/);
    expect(oct).toMatch(/aria-label="Today" aria-pressed="false" data-write='[^']*' data-value='""'/);
    expect(oct).not.toContain('aria-current="date"');
    expect(await go(mo, "2026-13")).toContain('data-page="2026-10"'); // no such month: he stays where he was
    expect(await go(mo, "2026-10?nowhere")).toContain('data-page="2026-10"');
    const list = await go(mo, "list");
    expect(list).toContain('data-applet="leave-list"');
    expect(list).toContain('role="radio" aria-checked="true" aria-label="List"'); // the reading switch: a radio, checked, never pressed (a toggle's)
    expect(list).not.toMatch(/role="radio"[^>]*aria-pressed/);
    expect(list).toContain(`data-value='"list?request=1"'`); // a row opens its request
    mo.ws.close();
  });

  test("a draft: dragged (or typed) days, what they would mean before asking, told to nobody else; asked for, and one Undo gives the draft back", async () => {
    const ann = await withAnn();
    const mo = await withMo();
    await go(mo, "2026-10");
    mo.inbox.length = 0; // what Mo is told from here
    try {
      const empty = await go(ann, "2026-10?draft");
      expect(empty).toContain("Ask for leave");
      expect(empty).toMatch(/aria-label="Ask"[^>]*disabled|<button[^>]*disabled[^>]*>.*Ask/s); // nothing to ask for yet
      await send(ann, "session", [{ op: "replace", path: "/draft/starts", value: "2026-10-07" }]); // a day typed: a one-day draft
      const one = ann.page;
      expect(one).toContain("Wed 7 Oct · 1 working day");
      await send(ann, "session", [{ op: "replace", path: "/draft", value: { starts: "2026-10-07", ends: "2026-10-12" } }]); // a drag
      const drafted = await go(ann, "2026-10?draft");
      expect(drafted).toContain("Your draft");
      expect(drafted).toContain("Wed 7 – Mon 12 Oct · 4 working days");
      expect(drafted).toContain("Bo, waiting: 3 days of these");
      expect(drafted).toContain("3 days with someone else off");
      expect(drafted).toContain('<span class="sr-only">your draft, Wed 7 – Mon 12 Oct</span>');
      expect(drafted.match(/class="date clash"/g)).toHaveLength(3); // the clashes it would make, before it is asked for
      await settle(mo);
      expect(mo.inbox.length).toBe(0); // Ann's alone until she asks: Mo is told nothing of it
      await send(ann, "session", [{ op: "replace", path: "/draft/ends", value: "2026-10-01" }]);
      expect(ann.page).toContain('<p class="refused" role="alert">The last day is before the first.</p>');
      await send(ann, "team", [{ op: "add", path: "/requests/-" }]); // Ask
      expect(ann.page).not.toContain("your draft");
      expect(ann.page).toContain("you, waiting, Wed 7 – Mon 12 Oct");
      await settle(mo);
      expect(mo.page).toContain("Ann, waiting, Wed 7 – Mon 12 Oct"); // asked: now Mo is told
      await undo(ann);
      expect(await go(ann, "2026-10")).toContain('<span class="sr-only">your draft, Wed 7 – Mon 12 Oct</span>'); // the ask taken back: the draft, as it was
      await send(ann, "ledger", [{ op: "add", path: "/latest" }]); // Redo: asked again, and the draft goes again
      expect(ann.page).not.toContain("your draft");
      expect(ann.page).toContain("you, waiting, Wed 7 – Mon 12 Oct");
      await undo(ann);
      await send(ann, "session", [{ op: "remove", path: "/draft" }]); // Cancel
      expect(ann.page).not.toContain("your draft");
      await send(ann, "session", [{ op: "remove", path: "/draft" }]); // nothing left to cancel: nothing happens
    } finally {
      ann.ws.close();
      mo.ws.close();
    }
  });

  test("a draft dropped can be drawn again", async () => {
    const ann = await withAnn();
    try {
      await send(ann, "session", [{ op: "replace", path: "/draft", value: { starts: "2026-10-07", ends: "2026-10-08" } }]);
      await send(ann, "session", [{ op: "remove", path: "/draft" }]); // Cancel
      await send(ann, "session", [{ op: "replace", path: "/draft", value: { starts: "2026-10-14", ends: "2026-10-15" } }]);
      expect(await go(ann, "2026-10")).toContain('<span class="sr-only">your draft, Wed 14 – Thu 15 Oct</span>');
    } finally {
      ann.ws.close();
    }
  });

  test("your own waiting request: its dates to change, taking it back; answered, it stays as it is; a manager answers others'", async () => {
    const ann = await withAnn();
    const mo = await withMo();
    try {
      const mine = await go(ann, "2026-11?request=2");
      expect(mine).toContain("Your leave");
      expect(mine).toContain("Fri 13 Nov · 1 working day");
      expect(mine).toContain(`data-write='{"doc":"team","op":"replace","path":"/requests/2/starts"}'`);
      expect(mine).toContain("Take it back");
      expect(mine).not.toContain("Approve"); // nobody answers their own
      expect(await go(ann, "2026-11?confirm=2")).toContain("Take back Fri 13 Nov?");
      await go(ann, "2026-11?request=2"); // back in its drawer, where its dates are
      await send(ann, "team", [{ op: "replace", path: "/requests/2/ends", value: "2026-11-12" }]);
      expect(ann.page).toContain("The last day is before the first.");
      await send(ann, "team", [{ op: "replace", path: "/requests/2/starts", value: "2026-11-14" }, { op: "replace", path: "/requests/2/ends", value: "2026-11-15" }]);
      expect(ann.page).toContain("There are no working days in those."); // moved onto a weekend: refused, and why
      const approved = await go(ann, "2026-12?request=3");
      expect(approved).toContain("approved by Mo");
      expect(approved).not.toContain("Take it back"); // answered: nothing to move or take back
      expect(approved).not.toContain('"path":"/requests/3/starts"');
      expect(await go(ann, "2026-10?request=1")).not.toContain("Approve"); // a member does not answer
      expect(await go(ann, "2026-10?confirm=1")).not.toContain("Take back"); // nor take back someone else's
      const answering = await go(mo, "2026-11?request=2");
      expect(answering).toContain("Approve");
      await send(mo, "team", [{ op: "replace", path: "/requests/2/status", value: "declined" }]);
      expect(await go(ann, "2026-11?request=2")).toContain("declined by Mo");
      expect(ann.page).not.toContain("Also off");
    } finally {
      await undo(mo);
      ann.ws.close();
      mo.ws.close();
    }
  });

  test("a manager's own leave is approved at once, by them, for all to see; theirs to move or take back, and nobody else's", async () => {
    const mo = await withMo();
    const ann = await withAnn();
    try {
      const drafting = await go(mo, "2026-11?draft");
      expect(drafting).toContain("Ask for leave");
      await send(mo, "session", [{ op: "replace", path: "/draft", value: { starts: "2026-11-05", ends: "2026-11-05" } }]);
      expect(mo.page).toContain("approved at once, by you: you manage the team");
      await send(mo, "team", [{ op: "add", path: "/requests/-" }]);
      expect(mo.page).toContain('<span class="sr-only">you, approved, Thu 5 Nov</span>');
      await settle(ann);
      expect(await go(ann, "2026-11")).toContain('<span class="sr-only">Mo, approved, Thu 5 Nov</span>'); // the staff are warned
      const his = await go(mo, "2026-10?request=4");
      expect(his).toContain("approved by Mo");
      expect(his).toContain("Take it back"); // he approved it: it is still his
      expect(his).toContain('"path":"/requests/4/starts"');
      expect(await go(ann, "2026-10?request=4")).not.toContain("Take it back");
      expect(await go(mo, "2026-12?request=3")).not.toContain("Take it back"); // Ann's, which he approved: not his to move
      expect(await go(ann, "2026-10")).toMatch(/<li><span class="swatch who-2" aria-hidden="true"><\/span>Mo<\/li>/); // everyone in the key
    } finally {
      await undo(mo); // the ask
      mo.ws.close();
      ann.ws.close();
    }
  });

  test("a draft asked for: the drawer that asked shows the request it became, by the id delta gave it, waiting, to be taken back", async () => {
    const ann = await withAnn();
    try {
      await go(ann, "2027-01");
      await send(ann, "session", [{ op: "replace", path: "/draft", value: { starts: "2027-01-04", ends: "2027-01-05" } }]);
      const asked = await send(ann, "team", [{ op: "add", path: "/requests/-" }]);
      const id = /data-page="2027-01\?request=([^"]+)"/.exec(asked)?.[1];
      expect(id).toBeDefined();
      expect(asked).toContain("Your leave");
      expect(asked).toContain("Mon 4 – Tue 5 Jan");
      expect(asked).toContain("Take it back");
      await go(ann, `2027-01?confirm=${id}`);
      expect(await send(ann, "team", [{ op: "remove", path: `/requests/${id}` }])).not.toContain("Mon 4 – Tue 5 Jan");
    } finally {
      await undo(ann); // the take-back
      await undo(ann); // the ask
      ann.ws.close();
    }
  });
});

describe("the rules, on their own", () => {
  const ann: Person = { id: "1", name: "Ann", role: "member" };
  const mo: Person = { id: "3", name: "Mo", role: "manager" };
  const t: Team = {
    name: "The studio",
    people: [ann, mo],
    requests: [
      { id: "1", person_id: "1", starts: "2026-10-05", ends: "2026-10-09", status: "asked", answered_by: null },
      { id: "2", person_id: "1", starts: "2026-11-13", ends: "2026-11-13", status: "approved", answered_by: "3" },
    ],
  };

  test("an address: this month or a month, or the list; over it a drawer, the asking-first, or the draft -- or nowhere", () => {
    expect(placed("")).toBe("");
    expect(placed("2026-10")).toBe("2026-10");
    expect(placed("list?request=2")).toBe("list?request=2");
    expect(placed("2026-10?draft")).toBe("2026-10?draft");
    expect(placed("2026-10?confirm=0199a1b2-c3d4")).toBe("2026-10?confirm=0199a1b2-c3d4"); // an id delta named
    expect(placed("2026-10?confirm=a b")).toBeUndefined();
    expect(placed("2026-10?wander")).toBeUndefined();
    expect(placed("2026-13")).toBeUndefined();
    expect(placed("attic")).toBeUndefined();
    expect(placed(undefined)).toBe("");
  });

  test("a session moves about and signs out; nothing else", () => {
    const at = { person: ann, page: "2026-10", draft: null };
    expect(shapeSession(at, [{ op: "replace", path: "/page", value: "list" }])).toEqual([{ op: "replace", path: "/page", value: "list" }]);
    expect(shapeSession(at, [{ op: "replace", path: "/page", value: "2026-10" }])).toEqual([]); // already there
    expect(shapeSession(at, [{ op: "remove", path: "/page" }])).toEqual([{ op: "replace", path: "/page", value: "" }]);
    expect(shapeSession(at, [{ op: "remove", path: "/person_id" }])).toEqual([{ op: "replace", path: "/person_id", value: null }, { op: "replace", path: "/page", value: null }]);
  });

  test("your draft is your session's; asking is anyone's; moving or taking back is the asker's while it waits; answering is a manager's, for someone else, while it waits", () => {
    expect(may(ann, { op: "replace", path: "/draft", value: {} }, t)).toBe(false); // not the team's: nobody else is told of it
    expect(may(ann, { op: "add", path: "/requests/-" }, t)).toBe(true);
    expect(may(ann, { op: "add", path: "/requests/-/x" }, t)).toBe(false);
    expect(may(ann, { op: "remove", path: "/requests/1" }, t)).toBe(true);
    expect(may(ann, { op: "remove", path: "/requests/2" }, t)).toBe(false); // answered
    expect(may(ann, { op: "remove", path: "/requests/9" }, t)).toBe(false); // nobody's
    expect(may(ann, { op: "replace", path: "/requests/1/starts", value: "2026-10-12" }, t)).toBe(true);
    expect(may(ann, { op: "replace", path: "/requests/1/starts", value: "soon" }, t)).toBe(false);
    expect(may(mo, { op: "replace", path: "/requests/1/starts", value: "2026-10-12" }, t)).toBe(false); // not his
    expect(may(mo, { op: "remove", path: "/requests/1" }, t)).toBe(false);
    expect(may(mo, { op: "replace", path: "/requests/1/status", value: "approved" }, t)).toBe(true);
    expect(may(mo, { op: "replace", path: "/requests/1/status", value: "maybe" }, t)).toBe(false);
    expect(may(ann, { op: "replace", path: "/requests/1/status", value: "approved" }, t)).toBe(false);
    expect(may(ann, { op: "replace", path: "/people/1/role", value: "manager" }, t)).toBe(false);
    const own: Team = { ...t, requests: [...t.requests, { id: "4", person_id: "3", starts: "2026-10-19", ends: "2026-10-23", status: "approved", answered_by: "3" }] };
    expect(may(mo, { op: "remove", path: "/requests/4" }, own)).toBe(true); // his own, approved by him
    expect(may(mo, { op: "replace", path: "/requests/4/ends", value: "2026-10-22" }, own)).toBe(true);
    expect(may(mo, { op: "remove", path: "/requests/2" }, own)).toBe(false); // Ann's, approved by him: hers, and answered
    expect(may(mo, { op: "replace", path: "/requests/4/status", value: "declined" }, own)).toBe(false); // answered already
  });

  test("a draft is your session's, set, changed a day at a time, dropped; setting it opens its drawer, dropping it closes it", () => {
    const at = { person: ann, page: "2026-12", draft: null };
    const drawn = { starts: "2026-12-01", ends: "2026-12-04" };
    const drafted = { person: ann, page: "2026-12?draft", draft: drawn };
    expect(shapeSession(at, [{ op: "replace", path: "/draft", value: drawn }])).toEqual([{ op: "replace", path: "/draft", value: drawn }, { op: "replace", path: "/page", value: "2026-12?draft" }]);
    expect(shapeSession(at, [{ op: "replace", path: "/draft/starts", value: "2026-12-01" }, { op: "replace", path: "/draft/ends", value: "2026-12-03" }])).toEqual([
      { op: "replace", path: "/draft", value: { starts: "2026-12-01", ends: "2026-12-03" } }, // two days set together: one draft
      { op: "replace", path: "/page", value: "2026-12?draft" },
    ]);
    expect(shapeSession(drafted, [{ op: "replace", path: "/draft/ends", value: "2026-12-02" }])).toEqual([{ op: "replace", path: "/draft", value: { starts: "2026-12-01", ends: "2026-12-02" } }]);
    expect(shapeSession(drafted, [{ op: "replace", path: "/draft/starts", value: "soon" }])).toEqual([]);
    expect(shapeSession(at, [{ op: "replace", path: "/draft" }])).toEqual([]);
    expect(() => shapeSession(drafted, [{ op: "replace", path: "/draft/ends", value: "2026-11-30" }])).toThrow("The last day is before the first.");
    expect(shapeSession(drafted, [{ op: "remove", path: "/draft" }])).toEqual([{ op: "replace", path: "/draft", value: null }, { op: "replace", path: "/page", value: "2026-12" }]);
    expect(shapeSession(at, [{ op: "remove", path: "/draft" }])).toEqual([]); // nothing to drop
  });

  test("an ask is your draft, or days said on the wire; a move and an answer as the team takes them", () => {
    const drawn = { starts: "2026-12-01", ends: "2026-12-04" };
    expect(shape(ann, [{ op: "add", path: "/requests/-" }], t, drawn)).toEqual([
      { op: "add", path: "/requests/-", value: { person_id: 1, starts: "2026-12-01", ends: "2026-12-04", status: "asked", answered_by: null } },
    ]);
    expect(shape(ann, [{ op: "add", path: "/requests/-" }], t, null)).toEqual([]); // no draft: nothing to ask for
    expect(shape(ann, [{ op: "add", path: "/requests/-", value: { starts: "2026-12-07", ends: "2026-12-07" } }], t, drawn)).toEqual([
      { op: "add", path: "/requests/-", value: { person_id: 1, starts: "2026-12-07", ends: "2026-12-07", status: "asked", answered_by: null } }, // days said on the wire
    ]);
    expect(() => shape(ann, [{ op: "add", path: "/requests/-", value: { starts: "2026-12-05", ends: "2026-12-06" } }], t, null)).toThrow("There are no working days in those.");
    expect(() => shape(ann, [{ op: "replace", path: "/requests/1/ends", value: "2026-10-01" }], t, null)).toThrow("The last day is before the first.");
    expect(shape(ann, [{ op: "replace", path: "/requests/1/starts", value: "2026-10-06" }], t, null)).toEqual([{ op: "replace", path: "/requests/1/starts", value: "2026-10-06" }]);
    expect(shape(mo, [{ op: "replace", path: "/requests/1/status", value: "approved" }], t, null)).toEqual([
      { op: "replace", path: "/requests/1/status", value: "approved" },
      { op: "replace", path: "/requests/1/answered_by", value: 3 },
    ]);
    expect(shape(ann, [{ op: "remove", path: "/requests/1" }], t, null)).toEqual([{ op: "remove", path: "/requests/1" }]);
    expect(shape(mo, [{ op: "add", path: "/requests/-", value: { starts: "2026-11-05", ends: "2026-11-05" } }], t, null)).toEqual([
      { op: "add", path: "/requests/-", value: { person_id: 3, starts: "2026-11-05", ends: "2026-11-05", status: "approved", answered_by: 3 } }, // a manager's own: approved, by them
    ]);
  });
});

describe("time, on its own (./calendar.ts)", () => {
  const people = [{ id: "1", name: "Ann", role: "member" as const }, { id: "2", name: "Bo", role: "member" as const }];
  const props = (o: Partial<CalendarProps> = {}): CalendarProps => ({
    from: "2026-10",
    today: "2026-10-07",
    me: "1",
    team: {
      name: "The studio",
      people,
      requests: [
        { id: "1", person_id: "2", starts: "2026-10-05", ends: "2026-10-09", status: "asked", answered_by: null },
        { id: "2", person_id: "1", starts: "2026-10-08", ends: "2026-10-12", status: "asked", answered_by: null },
        { id: "3", person_id: "2", starts: "2026-10-26", ends: "2026-10-30", status: "declined", answered_by: "3" },
      ],
    },
    draft: null,
    open: null,
    place: "2026-10",
    ...o,
  });

  test("days, working days, months and Mondays", () => {
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
    expect(daysOf({ starts: "2026-10-30", ends: "2026-11-02" })).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(isWorkingDay("2026-10-09")).toBe(true);
    expect(isWorkingDay("2026-10-10")).toBe(false);
    expect(workingDaysOf({ starts: "2026-10-09", ends: "2026-10-12" })).toEqual(["2026-10-09", "2026-10-12"]);
    expect(nextMonth("2026-12")).toBe("2027-01");
    expect(prevMonth("2027-01")).toBe("2026-12");
    expect(prevMonth("2026-10")).toBe("2026-09");
    expect(mondayOf("2026-10-11")).toBe("2026-10-05");
    expect(mondayOf("2026-10-05")).toBe("2026-10-05");
    expect(days({ starts: "2026-10-05", ends: "2026-10-09" })).toBe("Mon 5 – Fri 9 Oct");
    expect(days({ starts: "2026-11-13", ends: "2026-11-13" })).toBe("Fri 13 Nov");
  });

  test("who is off when: working days only, declined ones not at all; a clash is two people, not one person twice", () => {
    const rs = props().team.requests;
    const off = offOn(rs);
    expect(off.has("2026-10-10")).toBe(false); // a Saturday
    expect(off.has("2026-10-26")).toBe(false); // declined
    expect(clashes(off).sort()).toEqual(["2026-10-08", "2026-10-09"]);
    expect(alsoOff(rs, rs[1]!, "1").map((o) => [o.request.id, o.days])).toEqual([["1", 2]]);
    expect(clashes(offOn([rs[0]!, { ...rs[0]!, id: "9" }]))).toEqual([]); // one person twice
    expect(colourOf(people, "1")).toBe(0);
    expect(colourOf(people, "nobody")).toBe(0);
    const many = Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1), name: `P${i + 1}`, role: "member" as const }));
    expect(colourOf(many, "10")).toBe(0); // 10 sorts after 9: the tenth comes round again
  });

  test("the calendar: a bar across working days, open where it goes on, named unless yours, movable if yours and waiting; the clashes marked; your draft dashed", () => {
    const html = calendarHtml(props());
    expect(html).toContain("October 2026");
    expect(html).toContain("December 2026");
    expect(html).toContain('<span class="bar asked who-1" style="grid-column: 1 / span 5"'.replace('<span class="bar', '<button type="button" class="bar'));
    expect(html).toContain('class="bar asked who-0 open-end movable" style="grid-column: 4 / span 2"'); // hers, Thu and Fri, going on after the weekend
    expect(html).toContain('class="bar asked who-0 open-start movable" style="grid-column: 1 / span 1"'); // her Monday
    expect(html).toContain('<span class="grip start" aria-hidden="true"></span>');
    expect(html).toContain('title="Yours · waiting · Thu 8 – Mon 12 Oct · 3 working days"'); // the whole of it, on hover
    expect(html).toContain('title="Bo · waiting · Mon 5 – Fri 9 Oct · 5 working days"');
    expect(html).toMatch(/<span aria-hidden="true">waiting<\/span><span class="sr-only">you, waiting/); // yours says what it is, your colour whose
    expect(html.match(/class="date clash"/g)).toHaveLength(2);
    expect(html).toContain('class="date today" style="grid-column: 3" aria-current="date"');
    expect(html).toContain('<li><span class="swatch who-0" aria-hidden="true"></span>you</li>');
    expect(html).not.toContain("Oct 26"); // declined: nobody's
    const drafted = calendarHtml(props({ draft: { starts: "2026-10-19", ends: "2026-10-20" } }));
    expect(drafted).toContain('class="bar draft who-0" style="grid-column: 1 / span 2"');
    expect(drafted).toContain(`data-value='"2026-10?draft"'`);
    expect(drafted).toContain('title="Your draft · not asked for yet · Mon 19 – Tue 20 Oct · 2 working days"');
    const moving = calendarHtml(props(), { id: "2", starts: "2026-10-13", ends: "2026-10-14" });
    expect(moving).toContain("you, waiting, Tue 13 – Wed 14 Oct"); // where a drag would put it
    expect(moving.match(/class="date clash"/g)).toBeNull(); // and what that would mean
    const selecting = calendarHtml(props(), { id: null, starts: "2026-10-06", ends: "2026-10-06" });
    expect(selecting).toContain("your draft, Tue 6 Oct");
    expect(calendarHtml(props({ open: "1" }))).toContain('aria-expanded="true"'); // a bar whose drawer is open
    const quiet = calendarHtml(props({ from: "2027-03" }));
    expect(quiet).toContain("Nobody is off in these months.");
    expect(quiet).toContain('<li><span class="swatch who-1" aria-hidden="true"></span>Bo</li>'); // the key is the whole team, off or not
  });

  test("the list: every request by its first day, yours by colour, a row that opens its drawer, saying where it stands", () => {
    const rows = listRows({ me: "1", team: props().team, open: "2" });
    expect(rows.map((r) => [r.id, r.who, r.state])).toEqual([["1", "Bo", "waiting"], ["2", "", "waiting"], ["3", "Bo", "declined"]]);
    expect(rowHtml(rows[1]!, "2", 2, 3)).toContain('aria-posinset="2" aria-setsize="3" aria-expanded="true"');
    expect(rowHtml(rows[1]!, "2")).toContain('<span class="sr-only">yours</span>');
    expect(rowHtml(rows[0]!, null)).toContain(`data-value='"list?request=1"'`);
  });
});
