import { address, choice, prop } from "dzql/rendering/bento";
import { esc, join, write, appletWrites } from "dzql/rendering/html";
import { part } from "dzql/rendering/parts";
import { toldAt } from "dzql/rendering/refusal";
import { alsoOff, calendarHtml, days, listRows, rowHtml, stillMine, worked, WORD, type CalendarProps, type ListProps } from "../../calendar";
import { surfaces } from "../../surfaces";
import type { Person, Request, Span, Team } from "./team-api";

// The team's part of the page: its requests, on the calendar or as a list, and a request's drawer,
// where a manager answers, and where you change or take back your own.

const { tool, drawer, confirmModal, go } = surfaces;

const nameOf = (t: Team, id: string | null): string => t.people.find((p) => p.id === id)?.name ?? "";

/** Who else is off during a span: a line each, or nothing. */
export function also(t: Team, me: Person, span: Span, personId: string): string {
  const others = alsoOff(t.requests, span, personId);
  return others.length
    ? prop("Also off", others.map(({ request: o, days: n }) => `<span>${esc(o.person_id === me.id ? "You" : nameOf(t, o.person_id))}, ${WORD[o.status]}: ${n} ${n === 1 ? "day" : "days"} of these</span>`).join(""))
    : "";
}

/** A span's two days as fields, each writing its own path when it changes: the drawer's way to do what a drag does. */
export function dayFields(doc: string, base: string, s: Partial<Span>, sessionId: string): string {
  const field = (which: "starts" | "ends", label: string) =>
    `<label class="modal-field"><span class="note">${label}</span><input type="date" name="${which}"${write(doc, "replace", `${base}/${which}`)} value="${esc(s[which] ?? "")}"></label>${toldAt(sessionId, doc, `${base}/${which}`)}`;
  return `<form class="days" data-write-on="change">${field("starts", "First day")}${field("ends", "Last day")}</form>`;
}

/** A request's drawer: its days and state, who else is off, and what this person may do with it. */
export function requestSheet(t: Team, me: Person, r: Request, path: string, sessionId: string): string {
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

/** Taking a request back, asked first. */
export const takeBack = (r: Request, path: string): string =>
  confirmModal("Take it back", `Take back ${days(r)}?`, write("team", "remove", `/requests/${r.id}`), go(address(path, "request", r.id)), "Take it back");

/** The calendar applet's mount: drawn here first, so the page reads before a script runs, then kept by the applet, which adds the drags. It writes your draft, and moves your requests. */
export const calendarMount = (p: CalendarProps): string =>
  part("calendar", `<div id="calendar" class="calendar-view" data-applet="calendar"${appletWrites(["session", "replace", "/draft"], ["team", "replace", "/requests/*/starts"], ["team", "replace", "/requests/*/ends"])} data-props="${esc(JSON.stringify(p))}">${calendarHtml(p)}</div>`);

/** The list applet's mount: every request, drawn as it scrolls into view. */
export const listMount = (p: ListProps): string => {
  const rows = listRows(p);
  return part("list", `<div id="list" class="list-view" data-applet="leave-list" data-props="${esc(JSON.stringify(p))}"><div role="list" aria-label="Every request">${rows.map((row) => rowHtml(row, p.open)).join("")}</div>${rows.length ? "" : `<p class="note">Nobody has asked for leave.</p>`}</div>`);
};
