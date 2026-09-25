import { address, bento, choice, layers, parseAddress, prop, rows, type Crumb, type OpenOptions } from "../../src/bento";
import { esc, join, write } from "../../src/html";
import { part } from "../../src/parts";
import { refused } from "../../src/refusal";
import { session as sessionOf, team as teamOf, type Person, type Request, type Status, type Team } from "./documents";
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
  return order.flatMap((id) => [`<p class="cap run">${esc(nameOf(t, id))}</p>`, ...others.filter((r) => r.person_id === id).map((r) => requestRow(r, "team", open))]);
}

/** A request's drawer: its days and state, and what this person may do with it. */
function requestSheet(t: Team, me: Person, r: Request, path: string): string {
  const mine = r.person_id === me.id;
  const answer =
    !mine && me.role === "manager" && r.status === "asked"
      ? prop("Answer", choice("Answer", [
          { text: "Approve", on: false, write: write("team", "replace", `/requests/${r.id}/status`, "approved"), kind: "yes" },
          { text: "Decline", on: false, write: write("team", "replace", `/requests/${r.id}/status`, "declined"), kind: "no" },
        ]))
      : "";
  const body = join(
    `<div class="props">`,
    prop("Days", `<span>${esc(days(r))}</span>`),
    prop("It is", `<span class="state-${r.status}">${WORD[r.status]}${r.answered_by ? ` by ${esc(nameOf(t, r.answered_by))}` : ""}</span>`),
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
  const open = what === "request" || what === "confirm" ? which : undefined;
  const mine = t.requests.filter((r) => r.person_id === me.id);
  const others = t.requests.filter((r) => r.person_id !== me.id);
  const waiting = me.role === "manager" ? others.filter((r) => r.status === "asked").length : 0;
  const cells = [
    cell({ name: "your leave", key: "mine", mark: "calendar", count: mine.length, big: true, opens: go("mine"), summary: mine.length ? `${mine.filter((r) => r.status === "asked").length} waiting` : "nothing asked for yet" }),
    cell({ name: "the team", key: "team", mark: "users", count: others.length, span: 3, opens: go("team"), summary: waiting ? `${waiting} waiting for you` : `${others.length} asked by others` }),
  ];
  const opened: OpenOptions | undefined =
    path === "mine"
      ? { key: "mine", tools: [addTool(go(address("mine", "new")), "Ask for leave")], body: rows(mine.map((r) => requestRow(r, path, open)), "Nothing asked for yet. The plus asks.", "mine-rows") }
      : path === "team"
        ? { key: "team", body: rows(teamRows(t, others, open), "Nobody else has asked.", "team-rows") }
        : undefined;
  const trail: Crumb[] = [{ label: t.name, back: go("") }, ...(opened ? [{ label: opened.key === "mine" ? "your leave" : "the team" }] : [])];
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
