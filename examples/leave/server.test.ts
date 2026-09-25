import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PatchOp } from "../../src/json-patch";
import { createServer } from "../../src/server";
import { hear, type Heard } from "../../src/harness";
import { may, placed, shape, shapeSession, type Person, type Team } from "./documents";
import { alsoOff, calendarHtml, clashes, colourOf, days, daysOf, isWorkingDay, listRows, mondayOf, nextDay, nextMonth, offOn, prevMonth, rowHtml, workingDaysOf, type CalendarProps } from "./calendar";
import { example } from "./index";

let server: ReturnType<typeof createServer>;

beforeAll(() => {
  server = createServer(example, 0);
});

afterAll(() => {
  server.stop(true);
});

/** Posts the sign-in form, as a browser does: the answer, and the session its cookie names. */
async function signIn(email: string, password: string, headers: Record<string, string> = {}): Promise<{ res: Response; sessionId?: string }> {
  const res = await fetch(new URL("/login", server.url), { method: "POST", body: new URLSearchParams({ email, password }), redirect: "manual", headers });
  return { res, sessionId: /session_id=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] };
}

type Tab = { ws: WebSocket; page: string; inbox: Heard[]; answered: (() => void)[] };

/** A tab on a session: its page as the client keeps it, and everything it was sent. */
async function open(sessionId: string): Promise<Tab> {
  const url = new URL("/ws", server.url);
  url.protocol = "ws:";
  // @ts-expect-error Bun's runtime-only `headers` option on WebSocket
  const ws: WebSocket = new WebSocket(url, { headers: { Cookie: `session_id=${sessionId}` } });
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
  test("a good email and password start a fresh session, named by a new cookie, never the visit's own", async () => {
    const { res, sessionId } = await signIn("ann@leave.example", "ann-password", { Cookie: "session_id=a-visit-someone-planted" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
    expect(sessionId).toBeDefined();
    expect(sessionId).not.toBe("a-visit-someone-planted");
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
    const tab = await open(sessionId!);
    expect(tab.page).toContain('data-applet="calendar"');
    expect(tab.page).toContain("Sign out");
    tab.ws.close();
  });

  test("a wrong password, or an unknown email, is told on the page it came from, and signs nobody in", async () => {
    const visit = crypto.randomUUID();
    const tab = await open(visit);
    expect(tab.page).toContain('action="/login"');
    for (const [email, password] of [["ann@leave.example", "not-it"], ["nobody@leave.example", "ann-password"]] as const) {
      const { res, sessionId } = await signIn(email, password, { Cookie: `session_id=${visit}` });
      expect(res.status).toBe(303);
      expect(sessionId).toBeUndefined();
    }
    await settle(tab);
    expect(tab.page).toContain('<p class="refused" role="alert">That email and password do not match.</p>');
    expect((await signIn("ann@leave.example", "not-it")).sessionId).toBeUndefined(); // no visit to tell: nothing said, nothing kept
    tab.ws.close();
  });

  test("the page signs in, so a GET goes home; a form posted from another site is refused", async () => {
    const get = await fetch(new URL("/login", server.url), { redirect: "manual" });
    expect(get.status).toBe(303);
    const { res, sessionId } = await signIn("ann@leave.example", "ann-password", { Origin: "https://elsewhere.example" });
    expect(res.status).toBe(403);
    expect(sessionId).toBeUndefined();
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

const withAnn = async () => open((await signIn("ann@leave.example", "ann-password")).sessionId!);
const withMo = async () => open((await signIn("mo@leave.example", "mo-password")).sessionId!);
const undo = (tab: Tab) => send(tab, "ledger", [{ op: "remove", path: "/latest" }]);

describe("the page", () => {
  test("one calendar: three months from the one it names, today marked, Previous, Today and Next; the list is the same requests", async () => {
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
    expect(oct).toContain('data-value="2026-07"'); // previous: the three before
    expect(oct).toContain('data-value="2027-01"'); // next: the three after
    expect(oct).toMatch(/aria-label="Today" aria-pressed="false" data-write='[^']*' data-value=""/);
    expect(oct).not.toContain('aria-current="date"');
    expect(await go(mo, "2026-13")).toContain('data-page="2026-10"'); // no such month: he stays where he was
    expect(await go(mo, "2026-10?nowhere")).toContain('data-page="2026-10"');
    const list = await go(mo, "list");
    expect(list).toContain('data-applet="leave-list"');
    expect(list).toContain('role="radio" aria-checked="true" aria-pressed="true" aria-label="List"'); // the reading switch
    expect(list).toContain('data-value="list?request=1"'); // a row opens its request
    mo.ws.close();
  });

  test("a draft: dragged (or typed) days, what they would mean before asking, asked for, and one Undo gives the draft back", async () => {
    const ann = await withAnn();
    try {
      const empty = await go(ann, "2026-10?draft");
      expect(empty).toContain("Ask for leave");
      expect(empty).toMatch(/aria-label="Ask"[^>]*disabled|<button[^>]*disabled[^>]*>.*Ask/s); // nothing to ask for yet
      await send(ann, "team", [{ op: "replace", path: "/draft/starts", value: "2026-10-07" }]); // a day typed: a one-day draft
      const one = ann.page;
      expect(one).toContain("Wed 7 Oct · 1 working day");
      await send(ann, "team", [{ op: "replace", path: "/draft", value: { starts: "2026-10-07", ends: "2026-10-12" } }]); // a drag
      const drafted = await go(ann, "2026-10?draft");
      expect(drafted).toContain("Your draft");
      expect(drafted).toContain("Wed 7 – Mon 12 Oct · 4 working days");
      expect(drafted).toContain("Bo, waiting: 3 days of these");
      expect(drafted).toContain("3 days with someone else off");
      expect(drafted).toContain('<span class="sr-only">your draft, Wed 7 – Mon 12 Oct</span>');
      expect(drafted.match(/class="date clash"/g)).toHaveLength(3); // the clashes it would make, before it is asked for
      await send(ann, "team", [{ op: "replace", path: "/draft/ends", value: "2026-10-01" }]);
      expect(ann.page).toContain('<p class="refused" role="alert">The last day is before the first.</p>');
      await send(ann, "team", [{ op: "add", path: "/requests/-" }]); // Ask
      expect(ann.page).not.toContain("your draft");
      expect(ann.page).toContain("you, waiting, Wed 7 – Mon 12 Oct");
      await undo(ann);
      expect(await go(ann, "2026-10")).toContain('<span class="sr-only">your draft, Wed 7 – Mon 12 Oct</span>'); // the ask taken back: the draft, as it was
      await send(ann, "team", [{ op: "remove", path: "/draft" }]); // Cancel
      expect(ann.page).not.toContain("your draft");
      await send(ann, "team", [{ op: "remove", path: "/draft" }]); // nothing left to cancel: nothing happens
    } finally {
      await undo(ann); // the cancel
      await undo(ann); // the drag
      await undo(ann); // the typed day
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

  test("a request just asked for opens its drawer by the id delta gave it, and can be taken back", async () => {
    const ann = await withAnn();
    try {
      await send(ann, "team", [{ op: "replace", path: "/draft", value: { starts: "2027-01-04", ends: "2027-01-05" } }]);
      await send(ann, "team", [{ op: "add", path: "/requests/-" }]);
      const at = /data-value="(2027-01\?request=[^"]+)"/.exec(await go(ann, "2027-01"))?.[1];
      expect(at).toBeDefined();
      expect(await go(ann, at!)).toContain("Mon 4 – Tue 5 Jan");
      await go(ann, at!.replace("request", "confirm"));
      expect(await send(ann, "team", [{ op: "remove", path: `/requests/${at!.split("=")[1]}` }])).not.toContain("Mon 4 – Tue 5 Jan");
    } finally {
      await undo(ann); // the take-back
      await undo(ann); // the ask
      await undo(ann); // the draft
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
    drafts: {},
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
    const at = { person: ann, page: "2026-10" };
    expect(shapeSession(at, [{ op: "replace", path: "/page", value: "list" }])).toEqual([{ op: "replace", path: "/page", value: "list" }]);
    expect(shapeSession(at, [{ op: "replace", path: "/page", value: "2026-10" }])).toEqual([]); // already there
    expect(shapeSession(at, [{ op: "remove", path: "/page" }])).toEqual([{ op: "replace", path: "/page", value: "" }]);
    expect(shapeSession(at, [{ op: "remove", path: "/person_id" }])).toEqual([{ op: "replace", path: "/person_id", value: null }, { op: "replace", path: "/page", value: null }]);
  });

  test("your draft is yours; asking is anyone's; moving or taking back is the asker's while it waits; answering is a manager's, for someone else, while it waits", () => {
    expect(may(ann, { op: "replace", path: "/draft", value: {} }, t)).toBe(true);
    expect(may(ann, { op: "replace", path: "/draft/ends", value: "2026-10-01" }, t)).toBe(true);
    expect(may(ann, { op: "replace", path: "/draft/other", value: "x" }, t)).toBe(false);
    expect(may(ann, { op: "remove", path: "/draft" }, t)).toBe(true);
    expect(may(ann, { op: "remove", path: "/draft/starts" }, t)).toBe(false);
    expect(may(ann, { op: "replace", path: "/draft/starts/x", value: "x" }, t)).toBe(false);
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
  });

  test("a draft is your row, set, changed a day at a time, dropped; asking for it drops it in the same change; a move and an answer as the team takes them", () => {
    expect(shape(ann, [{ op: "replace", path: "/draft", value: { starts: "2026-12-01", ends: "2026-12-04" } }], t)).toEqual([{ op: "add", path: "/drafts/1", value: { starts: "2026-12-01", ends: "2026-12-04" } }]);
    const drafted: Team = { ...t, drafts: { "1": { starts: "2026-12-01", ends: "2026-12-04" } } };
    expect(shape(ann, [{ op: "replace", path: "/draft/ends", value: "2026-12-02" }], drafted)).toEqual([{ op: "replace", path: "/drafts/1", value: { starts: "2026-12-01", ends: "2026-12-02" } }]);
    expect(shape(ann, [{ op: "replace", path: "/draft/starts", value: "soon" }], drafted)).toEqual([]);
    expect(shape(ann, [{ op: "replace", path: "/draft" }], t)).toEqual([]);
    expect(() => shape(ann, [{ op: "replace", path: "/draft/ends", value: "2026-11-30" }], drafted)).toThrow("The last day is before the first.");
    expect(shape(ann, [{ op: "remove", path: "/draft" }], drafted)).toEqual([{ op: "remove", path: "/drafts/1" }]);
    expect(shape(ann, [{ op: "remove", path: "/draft" }], t)).toEqual([]); // nothing to drop
    expect(shape(ann, [{ op: "add", path: "/requests/-" }], drafted)).toEqual([
      { op: "add", path: "/requests/-", value: { person_id: "1", starts: "2026-12-01", ends: "2026-12-04", status: "asked", answered_by: null } },
      { op: "remove", path: "/drafts/1" },
    ]);
    expect(shape(ann, [{ op: "add", path: "/requests/-" }], t)).toEqual([]); // no draft: nothing to ask for
    expect(shape(ann, [{ op: "add", path: "/requests/-", value: { starts: "2026-12-07", ends: "2026-12-07" } }], drafted)).toEqual([
      { op: "add", path: "/requests/-", value: { person_id: "1", starts: "2026-12-07", ends: "2026-12-07", status: "asked", answered_by: null } }, // days said on the wire: the draft stays
    ]);
    expect(() => shape(ann, [{ op: "add", path: "/requests/-", value: { starts: "2026-12-05", ends: "2026-12-06" } }], t)).toThrow("There are no working days in those.");
    expect(() => shape(ann, [{ op: "replace", path: "/requests/1/ends", value: "2026-10-01" }], t)).toThrow("The last day is before the first.");
    expect(shape(ann, [{ op: "replace", path: "/requests/1/starts", value: "2026-10-06" }], t)).toEqual([{ op: "replace", path: "/requests/1/starts", value: "2026-10-06" }]);
    expect(shape(mo, [{ op: "replace", path: "/requests/1/status", value: "approved" }], t)).toEqual([
      { op: "replace", path: "/requests/1/status", value: "approved" },
      { op: "replace", path: "/requests/1/answered_by", value: "3" },
    ]);
    expect(shape(ann, [{ op: "remove", path: "/requests/1" }], t)).toEqual([{ op: "remove", path: "/requests/1" }]);
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
      drafts: {},
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
    expect(drafted).toContain('data-value="2026-10?draft"');
    expect(drafted).toContain('title="Your draft · not asked for yet · Mon 19 – Tue 20 Oct · 2 working days"');
    const moving = calendarHtml(props(), { id: "2", starts: "2026-10-13", ends: "2026-10-14" });
    expect(moving).toContain("you, waiting, Tue 13 – Wed 14 Oct"); // where a drag would put it
    expect(moving.match(/class="date clash"/g)).toBeNull(); // and what that would mean
    const selecting = calendarHtml(props(), { id: null, starts: "2026-10-06", ends: "2026-10-06" });
    expect(selecting).toContain("your draft, Tue 6 Oct");
    expect(calendarHtml(props({ open: "1" }))).toContain('aria-pressed="true"');
    expect(calendarHtml(props({ from: "2027-03" }))).toContain("Nobody is off in these months.");
  });

  test("the list: every request by its first day, yours by colour, a row that opens its drawer, saying where it stands", () => {
    const rows = listRows({ me: "1", team: props().team, open: "2" });
    expect(rows.map((r) => [r.id, r.who, r.state])).toEqual([["1", "Bo", "waiting"], ["2", "", "waiting"], ["3", "Bo", "declined"]]);
    expect(rowHtml(rows[1]!, "2", 2, 3)).toContain('aria-posinset="2" aria-setsize="3" aria-pressed="true"');
    expect(rowHtml(rows[1]!, "2")).toContain('<span class="sr-only">yours</span>');
    expect(rowHtml(rows[0]!, null)).toContain('data-value="list?request=1"');
  });
});
