// leave's time, as pure functions: its types, working days, who is off when and the clashes, each
// person's colour, and the calendar and the list as HTML. No server and no DOM, so the page (the
// server) and the applets (the browser) draw from the same code, and it is tested on its own.

import { esc, write } from "../../src/html";

export type Role = "member" | "manager";
export type Person = { id: string; name: string; role: Role };
export type Status = "asked" | "approved" | "declined";
export type Request = { id: string; person_id: string; starts: string; ends: string; status: Status; answered_by: string | null };
/** The team: its people and their requests. */
export type Team = { name: string; people: Person[]; requests: Request[] };
/** A range of days, first and last (YYYY-MM-DD). */
export type Span = { starts: string; ends: string };

// ───────────────────────────── days ─────────────────────────────

const DAY_MS = 86_400_000;

/** `day` moved by `n` days (YYYY-MM-DD). */
export const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

export const nextDay = (day: string): string => addDays(day, 1);

/** Every day of a span, first to last. */
export function daysOf(r: Span): string[] {
  const out: string[] = [];
  for (let d = r.starts; d <= r.ends; d = nextDay(d)) out.push(d);
  return out;
}

/** Monday to Friday: the days leave is taken from. */
export const isWorkingDay = (day: string): boolean => {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6;
};

/** The working days a span covers: what it takes, and all anyone is off. */
export const workingDaysOf = (r: Span): string[] => daysOf(r).filter(isWorkingDay);

/** The month after `m` (YYYY-MM). */
export const nextMonth = (m: string): string => {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
};

/** The month before `m` (YYYY-MM). */
export const prevMonth = (m: string): string => {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
};

/** The Monday on or before `day`. */
export const mondayOf = (day: string): string => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));

/** A span as a person says it: "Mon 5 Oct", or "Mon 5 – Fri 9 Oct". */
export function days(r: Span): string {
  const say = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", ...o });
  const full = { weekday: "short", day: "numeric", month: "short" } as const;
  return r.starts === r.ends ? say(r.starts, full) : `${say(r.starts, { weekday: "short", day: "numeric" })} – ${say(r.ends, full)}`;
}

/** How many working days, said: "3 working days". */
export const worked = (r: Span): string => {
  const n = workingDaysOf(r).length;
  return `${n} working ${n === 1 ? "day" : "days"}`;
};

/**
 * Is this request still its asker's to move or take back? While it waits -- and a manager's own,
 * which they approved themselves, stays theirs: nobody else answers it.
 */
export const stillMine = (me: Person, r: Request): boolean =>
  r.person_id === me.id && (r.status === "asked" || (me.role === "manager" && r.status === "approved" && r.answered_by === me.id));

// ───────────────────────────── who is off when ─────────────────────────────

/** Who is off on each working day: every request not declined, by the working days it covers. */
export function offOn(requests: Request[]): Map<string, Request[]> {
  const off = new Map<string, Request[]>();
  for (const r of requests) if (r.status !== "declined") for (const d of workingDaysOf(r)) off.set(d, [...(off.get(d) ?? []), r]);
  return off;
}

/** The days on which more than one person is off. */
export const clashes = (off: Map<string, Request[]>): string[] => [...off].filter(([, rs]) => new Set(rs.map((r) => r.person_id)).size > 1).map(([d]) => d);

/** Who else is off during a span, and on how many of its working days: what a manager weighs before answering, and what an asker sees before asking. */
export function alsoOff(requests: Request[], span: Span, personId: string): { request: Request; days: number }[] {
  const mine = new Set(workingDaysOf(span));
  return requests
    .filter((o) => o.person_id !== personId && o.status !== "declined")
    .map((o) => ({ request: o, days: workingDaysOf(o).filter((d) => mine.has(d)).length }))
    .filter((o) => o.days > 0);
}

// ───────────────────────────── who is who ─────────────────────────────

/** How many colours tell people apart (client/styles.css: `who-0` to `who-8`). */
export const COLOURS = 9;

/** A person's colour: their place in the team, by id, so it is the same on every page and every day. */
export function colourOf(people: Person[], personId: string): number {
  const ids = people.map((p) => p.id).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  return Math.max(0, ids.indexOf(personId)) % COLOURS;
}

// ───────────────────────────── the calendar ─────────────────────────────

const go = (page: string): string => write("session", "replace", "/page", page);

/** A request's status, as it is said. */
export const WORD: Record<Status, string> ={ asked: "waiting", approved: "approved", declined: "declined" };
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** What the calendar is drawn from: three months from `from`, today, who is looking, the team, their draft, the request whose drawer is open, and where a tap opens a drawer. */
export type CalendarProps = { from: string; today: string; me: string; team: Team; draft: Span | null; open: string | null; place: string };

/** What a drag is showing before it is let go: a new range, or one of your own requests moved or stretched. */
export type Preview = { id: string | null; starts: string; ends: string };

/**
 * The calendar: three months, a week to a row, today marked. A request is a bar across the
 * working days it covers in that week -- in its person's colour with their name on it (yours
 * without: the key says which is you), waiting a tint, approved filled -- and bars that share a day
 * stack, so a clash is two bars over the same day, and its date is marked. A bar that goes on past
 * the week, or the month, is open at that end. Your draft is a dashed bar; your waiting requests
 * can be dragged or stretched. A bar is its request: a tap opens its drawer.
 */
export function calendarHtml(p: CalendarProps, preview: Preview | null = null): string {
  const months = [p.from, nextMonth(p.from), nextMonth(nextMonth(p.from))];
  const [first, last] = [`${months[0]}-01`, `${months[2]}-31`];
  const shown = p.team.requests.map((r) => (preview?.id === r.id ? { ...r, starts: preview.starts, ends: preview.ends } : r));
  const draft = preview && preview.id === null ? { starts: preview.starts, ends: preview.ends } : p.draft;
  // your draft counts, so a clash it would make shows before you ask
  const drafted: Request[] = draft ? [{ id: "draft", person_id: p.me, ...draft, status: "asked", answered_by: null }] : [];
  const clashing = new Set(clashes(offOn([...shown, ...drafted])));
  const requests = shown
    .filter((r) => r.status !== "declined" && r.ends >= first && r.starts <= last)
    .sort((a, b) => a.starts.localeCompare(b.starts) || b.ends.localeCompare(a.ends));
  const nameOf = (id: string) => p.team.people.find((x) => x.id === id)?.name ?? "";
  const self = p.team.people.find((x) => x.id === p.me);

  const bar = (span: Span, week: (string | null)[], o: { id: string | null; person: string; status: Status | "draft" }) => {
    const workDays = workingDaysOf(span);
    const cols = week.map((d, i) => (d && workDays.includes(d) ? i : -1)).filter((i) => i >= 0);
    if (!cols.length) return "";
    const [c0, c1] = [cols[0]!, cols.at(-1)!];
    const mine = o.person === p.me;
    // on the bar: whose it is, or for yours -- your colour says whose -- what it is
    const shown = o.status === "draft" ? "draft" : mine ? WORD[o.status] : nameOf(o.person);
    const ends = `${workDays[0]! < week[c0]! ? " open-start" : ""}${workDays.at(-1)! > week[c1]! ? " open-end" : ""}`;
    const request = o.id === null ? undefined : p.team.requests.find((x) => x.id === o.id);
    const movable = !!request && !!self && stillMine(self, request);
    const label = o.status === "draft" ? `your draft, ${days(span)}` : `${mine ? "you" : nameOf(o.person)}, ${WORD[o.status]}, ${days(span)}`;
    const whole = `${o.status === "draft" ? "Your draft" : mine ? "Yours" : nameOf(o.person)} · ${o.status === "draft" ? "not asked for yet" : WORD[o.status]} · ${days(span)} · ${worked(span)}`;
    const opens = go(o.id === null ? `${p.place}?draft` : `${p.place}?request=${o.id}`);
    const expanded = o.id === null ? "" : ` aria-expanded="${p.open === o.id}"`; // its drawer, open or not
    const grips = movable ? `<span class="grip start" aria-hidden="true"></span><span class="grip end" aria-hidden="true"></span>` : "";
    return `<button type="button" class="bar ${o.status} who-${colourOf(p.team.people, o.person)}${ends}${movable ? " movable" : ""}" style="grid-column: ${c0 + 1} / span ${c1 - c0 + 1}" title="${esc(whole)}"${o.id ? ` data-request="${esc(o.id)}"` : ""}${expanded}${opens}>${grips}<span aria-hidden="true">${esc(shown)}</span><span class="sr-only">${esc(label)}</span></button>`;
  };

  const month = (m: string) => {
    const firstDay = `${m}-01`;
    const monday = mondayOf(firstDay);
    const cells: (string | null)[] = [];
    for (let d = monday; ; d = nextDay(d)) {
      if (d.slice(0, 7) > m && cells.length % 7 === 0) break;
      cells.push(d.slice(0, 7) === m ? d : null);
    }
    const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
    const week = (wk: (string | null)[], w: number) => {
      const dates = wk.map((d, i) => {
        const cls = `date${d && clashing.has(d) ? " clash" : ""}${d === p.today ? " today" : ""}${i > 4 ? " weekend" : ""}`;
        const said = `${d === p.today ? '<span class="sr-only">, today</span>' : ""}${d && clashing.has(d) ? '<span class="sr-only">, a clash</span>' : ""}`;
        return `<span class="${cls}" style="grid-column: ${i + 1}"${d === p.today ? ' aria-current="date"' : ""}>${d ? Number(d.slice(8)) : ""}${said}</span>`;
      });
      const bars = requests.map((r) => bar(r, wk, { id: r.id, person: r.person_id, status: r.status }));
      const drafted = draft ? bar(draft, wk, { id: null, person: p.me, status: "draft" }) : "";
      return `<div class="week" data-monday="${addDays(monday, w * 7)}" data-month="${m}">${dates.join("")}${bars.join("")}${drafted}</div>`;
    };
    const title = new Date(`${firstDay}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", month: "long", year: "numeric" });
    return `<section class="month" aria-label="${esc(title)}"><h3 class="cap">${esc(title)}</h3><div class="weekdays" aria-hidden="true">${WEEKDAYS.map((d) => `<span>${d}</span>`).join("")}</div>${weeks.map(week).join("")}</section>`;
  };

  // the whole team in its colours, off in these months or not; you as you
  const everyone = p.team.people.map((x) => x.id).sort((a, b) => colourOf(p.team.people, a) - colourOf(p.team.people, b));
  const key = `<ul class="key" aria-label="Who is who">${everyone.map((id) => `<li><span class="swatch who-${colourOf(p.team.people, id)}" aria-hidden="true"></span>${esc(id === p.me ? "you" : nameOf(id))}</li>`).join("")}</ul>`;
  const none = requests.length || draft ? "" : `<p class="note">Nobody is off in these months. Drag across days to ask for some.</p>`;
  return `${key}${none}<div class="calendar">${months.map(month).join("")}</div>`;
}

// ───────────────────────────── the list ─────────────────────────────

/** What the list is drawn from: every request, newest days last, and the one whose drawer is open. */
export type ListProps = { me: string; team: Team; open: string | null };

/** One row of the list, drawn by the list applet as it scrolls into view. */
export type Row = { id: string; who: string; colour: number; days: string; worked: string; state: string; mine: boolean };

/** The list's rows: every request, by its first day. */
export function listRows(p: ListProps): Row[] {
  return [...p.team.requests]
    .sort((a, b) => a.starts.localeCompare(b.starts) || a.id.localeCompare(b.id))
    .map((r) => ({
      id: r.id,
      who: r.person_id === p.me ? "" : (p.team.people.find((x) => x.id === r.person_id)?.name ?? ""), // yours by your colour, not your name
      colour: colourOf(p.team.people, r.person_id),
      days: days(r),
      worked: worked(r),
      state: WORD[r.status],
      mine: r.person_id === p.me,
    }));
}

/** A row as the list applet draws it: a button that opens the request's drawer, saying where it stands in the whole list (a window of it is drawn at a time). */
export const rowHtml = (row: Row, open: string | null, at?: number, of?: number): string =>
  `<button type="button" class="vrow" role="listitem"${at ? ` aria-posinset="${at}" aria-setsize="${of}"` : ""} aria-expanded="${open === row.id}"${go(`list?request=${row.id}`)}><span class="swatch who-${row.colour}" aria-hidden="true"></span><span class="who">${esc(row.who)}</span>${row.mine ? '<span class="sr-only">yours</span>' : ""}<span class="when">${esc(row.days)}<span class="note"> · ${esc(row.worked)}</span></span><span class="state">${esc(row.state)}</span></button>`;
