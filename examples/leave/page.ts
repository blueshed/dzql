import { address, bento, choice, layers, parseAddress, prop, rows, type Crumb, type OpenOptions } from "../../src/bento";
import { esc, join, write } from "../../src/html";
import { part } from "../../src/parts";
import { refused } from "../../src/refusal";
import { alsoOff, clashes, colourOf, isWorkingDay, offOn, workingDaysOf, session as sessionOf, team as teamOf, type Person, type Request, type Status, type Team } from "./documents";
import { icon } from "./icons";

// leave's pages. Signed out, one: sign in. Signed in, a box of two compartments -- your leave, and
// the team's -- each growing into the window; a request's drawer holds what can be done with it
// (taken back by its asker, answered by a manager), and asking and taking back are modals.

const { tool, cell, boxPage, row, sheet, addModal, confirmModal, addTool } = bento({ icon, tray: "session", leave: { text: "Sign out", icon: "log-out", path: "/person_id" } });

const go = (page: string): string => write("session", "replace", "/page", page);

const WORD: Record<Status, string> = { asked: "waiting", approved: "approved", declined: "declined" };

/** Days as a person says them: "Mon 5 Oct", or "Mon 5 – Fri 9 Oct". */
export function days(r: Pick<Request, "starts" | "ends">): string {
  const say = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", ...o });
  const full = { weekday: "short", day: "numeric", month: "short" } as const;
  return r.starts === r.ends ? say(r.starts, full) : `${say(r.starts, { weekday: "short", day: "numeric" })} – ${say(r.ends, full)}`;
}

/** Signed out: the one thing to do, and why the last try did not work, if it did not. */
function signInPage(sessionId: string): string {
  return join(
    `<section class="door"><h1 class="cap">Leave</h1>`,
    `<form class="sign-in" method="post" action="/login">`,
    `<label class="modal-field"><span class="note">Email</span><input name="email" type="email" autocomplete="username" required autofocus></label>`,
    `<label class="modal-field"><span class="note">Password</span><input name="password" type="password" autocomplete="current-password" required></label>`,
    refused(sessionId, "session", "/login"),
    `<button type="submit" class="tool">Sign in</button>`,
    `</form></section>`,
  );
}

const nameOf = (t: Team, id: string | null): string => t.people.find((p) => p.id === id)?.name ?? "";

/** A request as a row: its days, its state at the right; ✎ its drawer. Whose it is is said once, above the run (`teamRows`). */
function requestRow(r: Request, path: string, open: string | undefined): string {
  return row({ id: `r-${r.id}`, tap: go(address(path, "request", r.id)), chosen: open === r.id, what: days(r), state: WORD[r.status], mark: "pencil" });
}

/** Everyone else's requests, a run per person in the order they first asked, each person's name said once at the head of their run. */
function teamRows(t: Team, others: Request[], open: string | undefined): string[] {
  const order = [...new Set(others.map((r) => r.person_id))];
  return order.flatMap((id) => [`<p class="cap run">${swatch(t, id)}${esc(nameOf(t, id))}</p>`, ...others.filter((r) => r.person_id === id).map((r) => requestRow(r, "team", open))]);
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * The calendar: three months from `from`, a week to a row, today marked. A request is a bar across the days it
 * covers in that week, in its person's colour with their name on it (yours without: the key says
 * which is you) -- waiting a tint, approved filled -- and bars that share a day stack, so a clash is
 * two bars over the same day, and its date is marked. A bar that goes on past the week, or the
 * month, is open at that end. Declined days are nobody's. A bar is its request: a tap opens its
 * drawer, and it is lit while the drawer is open.
 */
function calendar(t: Team, me: Person, off: Map<string, Request[]>, open: string | undefined, path: string, from: string, today: string): string {
  const months = [from, nextMonth(from), nextMonth(nextMonth(from))];
  const [first, last] = [`${months[0]}-01`, `${months[2]}-31`];
  const clashing = new Set(clashes(off));
  const requests = t.requests
    .filter((r) => r.status !== "declined" && r.ends >= first && r.starts <= last)
    .sort((a, b) => a.starts.localeCompare(b.starts) || b.ends.localeCompare(a.ends));
  const bar = (r: Request, week: (string | null)[]) => {
    // the bar covers the request's working days in this week; a weekend is nobody's leave
    const cols = week.map((d, i) => (d && d >= r.starts && d <= r.ends && isWorkingDay(d) ? i : -1)).filter((i) => i >= 0);
    if (!cols.length) return "";
    const [c0, c1] = [cols[0]!, cols.at(-1)!];
    const name = r.person_id === me.id ? "" : nameOf(t, r.person_id);
    const worked = workingDaysOf(r);
    const ends = `${worked[0]! < week[c0]! ? " open-start" : ""}${worked.at(-1)! > week[c1]! ? " open-end" : ""}`;
    const said = `${r.person_id === me.id ? "you" : name}, ${WORD[r.status]}, ${days(r)}`;
    return `<button type="button" class="bar ${r.status} who-${colourOf(t, r.person_id)}${ends}" style="grid-column: ${c0 + 1} / span ${c1 - c0 + 1}" aria-pressed="${open === r.id}"${go(address(path, "request", r.id))}><span aria-hidden="true">${esc(name)}</span><span class="sr-only">${esc(said)}</span></button>`;
  };
  const month = (m: string) => {
    const first = new Date(`${m}-01T00:00:00Z`);
    const lead = (first.getUTCDay() + 6) % 7; // Monday first
    const length = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    const cells: (string | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length }, (_, i) => `${m}-${String(i + 1).padStart(2, "0")}`)];
    while (cells.length % 7) cells.push(null);
    const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
    const week = (wk: (string | null)[]) =>
      `<div class="week">${wk.map((d, i) => `<span class="date${d && clashing.has(d) ? " clash" : ""}${d === today ? " today" : ""}${i > 4 ? " weekend" : ""}" style="grid-column: ${i + 1}"${d === today ? ' aria-current="date"' : ""}>${d ? Number(d.slice(8)) : ""}${d === today ? '<span class="sr-only">, today</span>' : ""}${d && clashing.has(d) ? '<span class="sr-only">, a clash</span>' : ""}</span>`).join("")}${requests.map((r) => bar(r, wk)).join("")}</div>`;
    const title = first.toLocaleDateString("en-GB", { timeZone: "UTC", month: "long", year: "numeric" });
    return `<section class="month" aria-label="${esc(title)}"><h3 class="cap">${esc(title)}</h3><div class="weekdays" aria-hidden="true">${WEEKDAYS.map((d) => `<span>${d}</span>`).join("")}</div>${weeks.map(week).join("")}</section>`;
  };
  const people = [...new Set(requests.map((r) => r.person_id))].sort((a, b) => colourOf(t, a) - colourOf(t, b)); // the team's order, the colours' own
  const key = people.length
    ? `<ul class="key" aria-label="Who is who">${people.map((id) => `<li>${swatch(t, id)}${esc(id === me.id ? "you" : nameOf(t, id))}</li>`).join("")}</ul>`
    : `<p class="note">Nobody is off in these months.</p>`;
  return part("calendar", `<div id="calendar">${key}<div class="calendar">${months.map(month).join("")}</div></div>`);
}

/** How many working days a request takes. */
const worked = (r: Request): string => {
  const n = workingDaysOf(r).length;
  return `${n} working ${n === 1 ? "day" : "days"}`;
};

/** A person's colour, as a dot beside their name. */
const swatch = (t: Team, personId: string): string => `<span class="swatch who-${colourOf(t, personId)}" aria-hidden="true"></span>`;

/** The month before `m` (YYYY-MM). */
const prevMonth = (m: string): string => {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
};

/** The month after `m` (YYYY-MM). */
const nextMonth = (m: string): string => {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
};

/** A request's drawer: its days and state, and what this person may do with it. */
function requestSheet(t: Team, me: Person, r: Request, path: string): string {
  const mine = r.person_id === me.id;
  const also = r.status === "declined" ? [] : alsoOff(t, r);
  const answer =
    !mine && me.role === "manager" && r.status === "asked"
      ? prop("Answer", choice("Answer", [
          { text: "Approve", on: false, write: write("team", "replace", `/requests/${r.id}/status`, "approved"), kind: "yes" },
          { text: "Decline", on: false, write: write("team", "replace", `/requests/${r.id}/status`, "declined"), kind: "no" },
        ]))
      : "";
  const body = join(
    `<div class="props">`,
    prop("Days", `<span>${esc(days(r))} · ${worked(r)}</span>`),
    prop("It is", `<span class="state-${r.status}">${WORD[r.status]}${r.answered_by ? ` by ${esc(nameOf(t, r.answered_by))}` : ""}</span>`),
    also.length > 0 && prop("Also off", also.map(({ request: o, days: n }) => `<span>${esc(o.person_id === me.id ? "You" : nameOf(t, o.person_id))}, ${WORD[o.status]}: ${n} ${n === 1 ? "day" : "days"} of these</span>`).join("")),
    answer,
    `</div>`,
    mine && r.status === "asked" && `<div class="sheet-foot">${tool("Take it back", { icon: "trash", kind: "danger", write: go(address(path, "confirm", r.id)) })}</div>`,
  );
  return sheet("request", mine ? "Your leave" : nameOf(t, r.person_id), body, go(path), "request-sheet");
}

/** The page for a session. */
export function render(sessionId: string): string {
  const { person: me, page } = sessionOf(sessionId);
  if (!me) return signInPage(sessionId);
  const t = teamOf();
  const { path, what, which } = parseAddress(page);
  const [area, month] = path.split("/");
  const today = new Date().toISOString().slice(0, 10);
  const from = month ?? today.slice(0, 7); // the calendar starts at the month its address names, or this one
  const open = what === "request" || what === "confirm" ? which : undefined;
  const mine = t.requests.filter((r) => r.person_id === me.id);
  const others = t.requests.filter((r) => r.person_id !== me.id);
  const waiting = me.role === "manager" ? others.filter((r) => r.status === "asked").length : 0;
  const off = offOn(t);
  const clash = clashes(off).length;
  const cells = [
    cell({ name: "your leave", key: "mine", mark: "calendar", count: mine.length, big: true, opens: go("mine"), summary: mine.length ? `${mine.filter((r) => r.status === "asked").length} waiting` : "nothing asked for yet" }),
    cell({ name: "the team", key: "team", mark: "users", count: others.length, span: 3, opens: go("team"), summary: waiting ? `${waiting} waiting for you` : `${others.length} asked by others` }),
    cell({ name: "the calendar", key: "calendar", mark: "month", count: clash || null, span: 3, opens: go("calendar"), summary: clash ? `${clash} ${clash === 1 ? "day" : "days"} with more than one off` : "no days with more than one off" }),
  ];
  const opened: OpenOptions | undefined =
    path === "mine"
      ? { key: "mine", tools: [addTool(go(address("mine", "new")), "Ask for leave")], body: rows(mine.map((r) => requestRow(r, path, open)), "Nothing asked for yet. The plus asks.", "mine-rows") }
      : path === "team"
        ? { key: "team", body: rows(teamRows(t, others, open), "Nobody else has asked.", "team-rows") }
        : area === "calendar"
          ? {
              key: "calendar",
              // moving through time: the three months before, back to today, the three after
              tools: [
                tool("Previous", { icon: "chevron-left", iconOnly: true, write: go(`calendar/${prevMonth(prevMonth(prevMonth(from)))}`) }),
                tool("Today", { icon: "today", iconOnly: true, pressed: from === today.slice(0, 7), write: go("calendar") }),
                tool("Next", { icon: "chevron-right", iconOnly: true, write: go(`calendar/${nextMonth(nextMonth(nextMonth(from)))}`) }),
              ],
              body: calendar(t, me, off, open, path, from, today),
            }
          : undefined;
  const LABEL: Record<string, string> = { mine: "your leave", team: "the team", calendar: "the calendar" };
  const trail: Crumb[] = [{ label: t.name, back: go("") }, ...(opened ? [{ label: LABEL[opened.key]! }] : [])];
  const r = open === undefined ? undefined : t.requests.find((x) => x.id === open);
  const drawer = what === "request" && r ? requestSheet(t, me, r, path) : "";
  const modal =
    what === "new"
      ? addModal("Ask for leave", [{ name: "starts", label: "First day", type: "date" }, { name: "ends", label: "Last day", type: "date" }], write("team", "add", "/requests/-"), go(path), "Ask", refused(sessionId, "team", "/requests/-"))
      : what === "confirm" && r && r.person_id === me.id
        ? confirmModal("Take it back", `Take back ${days(r)}?`, write("team", "remove", `/requests/${r.id}`), go(address(path, "request", r.id)), "Take it back")
        : "";
  return part(
    "site",
    `<div class="site${modal || drawer ? " locked" : ""}" data-page="${esc(page)}" data-page-write='${JSON.stringify({ doc: "session", op: "replace", path: "/page" })}'>${layers(boxPage(trail, [], cells, opened), drawer, modal)}</div>`,
  );
}
