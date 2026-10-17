import { address, bento, choice, layers, parseAddress, prop } from "dzql/rendering/bento";
import { esc, join, write, appletWrites } from "dzql/rendering/html";
import { part } from "dzql/rendering/parts";
import { toldAt } from "dzql/rendering/refusal";
import { alsoOff, calendarHtml, clashes, days, listRows, nextMonth, offOn, prevMonth, rowHtml, stillMine, worked, workingDaysOf, WORD, type CalendarProps, type ListProps } from "./calendar";
import { session as sessionOf, team as teamOf, type Person, type Request, type Span, type Team } from "./documents";
import { icon } from "./icons";

// leave's page. Signed out: sign in. Signed in: one calendar -- or the same requests as a list --
// and one drawer. You drag across days for a draft, and its drawer says what it would mean before
// you ask: how many working days, who else is off. Your own waiting requests you drag to move. A
// request's drawer is where a manager answers, and where you change or take back your own. The
// drawers' fields do everything a drag does, for a keyboard.

const { tool, collectionPage, drawer, confirmModal, addTool, go, site, readingSwitch } = bento({ icon, session: "session", leave: { text: "Sign out", icon: "log-out", path: "/person_id" } });

/** Signed out: the one thing to do, and why the last try did not work, if it did not. */
function signInPage(sessionId: string): string {
  return join(
    `<section class="door"><h1 class="cap">Leave</h1>`,
    `<form class="sign-in" method="post" action="/login">`,
    `<label class="modal-field"><span class="note">Email</span><input name="email" type="email" autocomplete="username" required autofocus></label>`,
    `<label class="modal-field"><span class="note">Password</span><input name="password" type="password" autocomplete="current-password" required></label>`,
    toldAt(sessionId, "session", "/login"),
    `<button type="submit" class="tool">Sign in</button>`,
    `</form></section>`,
  );
}

const nameOf = (t: Team, id: string | null): string => t.people.find((p) => p.id === id)?.name ?? "";

/** Who else is off during a span: a line each, or nothing. */
function also(t: Team, me: Person, span: Span, personId: string): string {
  const others = alsoOff(t.requests, span, personId);
  return others.length
    ? prop("Also off", others.map(({ request: o, days: n }) => `<span>${esc(o.person_id === me.id ? "You" : nameOf(t, o.person_id))}, ${WORD[o.status]}: ${n} ${n === 1 ? "day" : "days"} of these</span>`).join(""))
    : "";
}

/** A span's two days as fields, each writing its own path when it changes: the drawer's way to do what a drag does. */
function dayFields(doc: string, base: string, s: Partial<Span>, sessionId: string): string {
  const field = (which: "starts" | "ends", label: string) =>
    `<label class="modal-field"><span class="note">${label}</span><input type="date" name="${which}"${write(doc, "replace", `${base}/${which}`)} value="${esc(s[which] ?? "")}"></label>${toldAt(sessionId, doc, `${base}/${which}`)}`;
  return `<form class="days" data-write-on="change">${field("starts", "First day")}${field("ends", "Last day")}</form>`;
}

/** A request's drawer: its days and state, who else is off, and what this person may do with it. */
function requestSheet(t: Team, me: Person, r: Request, path: string, sessionId: string): string {
  const mine = r.person_id === me.id;
  const open = stillMine(me, r); // yours to move or take back
  const answer =
    !mine && me.role === "manager" && r.status === "asked"
      ? prop("Answer", choice("Answer", [
          { text: "Approve", on: false, write: write("team", "replace", `/requests/${r.id}/status`, "approved"), kind: "yes" },
          { text: "Decline", on: false, write: write("team", "replace", `/requests/${r.id}/status`, "declined"), kind: "no" },
        ]))
      : "";
  const body = join(
    open && dayFields("team", `/requests/${r.id}`, r, sessionId),
    `<div class="props">`,
    prop("Days", `<span>${esc(days(r))} · ${worked(r)}</span>`),
    prop("It is", `<span class="state-${r.status}">${WORD[r.status]}${r.answered_by ? ` by ${esc(nameOf(t, r.answered_by))}` : ""}</span>`),
    r.status !== "declined" && also(t, me, r, r.person_id),
    answer,
    `</div>`,
    open && `<div class="drawer-foot">${tool("Take it back", { icon: "trash", kind: "danger", write: go(address(path, "confirm", r.id)) })}</div>`,
  );
  return drawer("request", mine ? "Your leave" : nameOf(t, r.person_id), body, go(path), "request-drawer");
}

/** Your draft's drawer: its days, what it would mean -- working days, who else is off, the clashes -- and asking for it, or not. */
function draftSheet(t: Team, me: Person, draft: Span | null, path: string, sessionId: string): string {
  const clashing = draft ? clashes(offOn([...t.requests, { id: "draft", person_id: me.id, ...draft, status: "asked", answered_by: null }])).filter((d) => workingDaysOf(draft).includes(d)).length : 0;
  const body = join(
    dayFields("session", "/draft", draft ?? {}, sessionId),
    draft && `<div class="props">${prop("Days", `<span>${esc(days(draft))} · ${worked(draft)}</span>`)}${me.role === "manager" ? prop("Asked for", `<span>approved at once, by you: you manage the team</span>`) : ""}${also(t, me, draft, me.id)}${prop("Clashes", `<span class="${clashing ? "state-declined" : ""}">${clashing ? `${clashing} ${clashing === 1 ? "day" : "days"} with someone else off` : "none"}</span>`)}</div>`,
    toldAt(sessionId, "team", "/requests/-"),
    `<div class="drawer-foot">${tool("Ask", { icon: "plus", kind: "add", write: write("team", "add", "/requests/-"), disabled: !draft })}${tool("Cancel", { kind: "quiet", write: draft ? write("session", "remove", "/draft") : go(path) })}</div>`,
  );
  return drawer("draft", draft ? "Your draft" : "Ask for leave", body, go(path), "draft-drawer");
}

/** The page for a session. */
export function render(sessionId: string): string {
  const { person: me, page, draft } = sessionOf(sessionId);
  if (!me) return layers(signInPage(sessionId), "", ""); // the bento's frame, so the door is drawn with its controls
  const t = teamOf();
  const { path, what, which } = parseAddress(page);
  const today = new Date().toISOString().slice(0, 10);
  const list = path === "list";
  const from = list || path === "" ? today.slice(0, 7) : path; // the calendar starts at the month its address names, or this one
  const open = what === "request" || what === "confirm" ? which! : null;

  // the reading: the calendar or the list, the same requests; from the list, the calendar is today's
  const readings: [text: string, mark: "month" | "list", on: boolean, w: string][] = [
    ["Calendar", "month", !list, go(list ? "" : path)],
    ["List", "list", list, go("list")],
  ];
  const reading = readingSwitch(readings);
  const ask = addTool(go(address(path, "draft")), "Ask for leave");
  const tools = list
    ? [ask]
    : [
        // a month at a time, each by its own name, so every month is somewhere a person can get to,
        // whatever today is; the page alone is today, wherever that is
        tool("Previous", { icon: "chevron-left", iconOnly: true, write: go(prevMonth(from)) }),
        tool("Today", { icon: "today", iconOnly: true, pressed: from === today.slice(0, 7), write: go("") }),
        tool("Next", { icon: "chevron-right", iconOnly: true, write: go(nextMonth(from)) }),
        ask,
      ];
  const body = list ? listMount({ me: me.id, team: t, open }) : calendarMount({ from, today, me: me.id, team: t, draft, open, place: path });
  const r = open === null ? undefined : t.requests.find((x) => x.id === open);
  const drawer = what === "request" && r ? requestSheet(t, me, r, path, sessionId) : what === "draft" ? draftSheet(t, me, draft, path, sessionId) : "";
  const modal = what === "confirm" && r && stillMine(me, r) ? confirmModal("Take it back", `Take back ${days(r)}?`, write("team", "remove", `/requests/${r.id}`), go(address(path, "request", r.id)), "Take it back") : "";
  return site(page, layers(collectionPage([{ label: t.name }], { key: "leave", reading, tools, body }), drawer, modal));
}

/** The calendar applet's mount: drawn here first, so the page reads before a script runs, then kept by the applet, which adds the drags. It writes your draft, and moves your requests. */
const calendarMount = (p: CalendarProps): string =>
  part("calendar", `<div id="calendar" class="calendar-view" data-applet="calendar"${appletWrites(["session", "replace", "/draft"], ["team", "replace", "/requests/*/starts"], ["team", "replace", "/requests/*/ends"])} data-props="${esc(JSON.stringify(p))}">${calendarHtml(p)}</div>`);

/** The list applet's mount: every request, drawn as it scrolls into view. */
const listMount = (p: ListProps): string => {
  const rows = listRows(p);
  return part("list", `<div id="list" class="list-view" data-applet="leave-list" data-props="${esc(JSON.stringify(p))}"><div role="list" aria-label="Every request">${rows.map((row) => rowHtml(row, p.open)).join("")}</div>${rows.length ? "" : `<p class="note">Nobody has asked for leave.</p>`}</div>`);
};
