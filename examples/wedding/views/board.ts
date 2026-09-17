// The couple's pages: their home -- the welcome as a thing with ✎, then households, courses,
// gifts, events and where to stay as compartments, each growing into the window; a family's box
// as the couple read it -- their guests, their asks, their code; and the drawers where the four
// lists they keep are edited, a row each.

import type { BoardDocument } from "../documents/board";
import type { HouseholdDocument } from "../documents/household";
import type { SessionDocument } from "../documents/session";
import { addModal, addTool, boxPage, cell, choice, confirmModal, findControl, prop, readingSwitch, row, rows, sheet, tool, type Crumb, type OpenOptions } from "./bento";
import { esc, join, nav, write } from "./html";
import { icon } from "./icons";
import { familiesPhoto, familyEntries, photoMount, type Family, type PhotoEntry } from "./photo";
import {
  answerOf,
  answerSays,
  answerWord,
  choicesLine,
  coupleName,
  coursesSummary,
  eventsSummary,
  faceMark,
  firstNameOf,
  formatDay,
  frame,
  inertWhile,
  isComing,
  matches,
  picture,
  placeRows,
  placesSummary,
  plural,
  specOf,
  timetableRows,
} from "./shared";
import { inPhoto } from "../documents/wedding";

export type BoardView = { session: SessionDocument; b: BoardDocument };

type KeepTable = "courses" | "gifts" | "events" | "places";
const KEEP: Record<KeepTable, { label: string; noun: string }> = {
  courses: { label: "Courses", noun: "course" },
  gifts: { label: "Gifts", noun: "gift" },
  events: { label: "Events", noun: "event" },
  places: { label: "Where to stay", noun: "place" },
};
const isKeepTable = (s: string): s is KeepTable => s in KEEP;

/** Which compartment of the home the page names, grown into the window (rule 7). */
function openFor(v: BoardView, head: string): { open?: OpenOptions; crumbs: Crumb[] } {
  if (head === "households") return { open: householdsOpen(v), crumbs: [{ label: "Households" }] };
  if (isKeepTable(head)) return { open: keepOpen(v, head), crumbs: [{ label: KEEP[head].label }] };
  return { crumbs: [] };
}

export function boardPages(v: BoardView): string {
  const { b } = v;
  const ui = v.session.ui;
  const trail: Crumb[] = [{ label: coupleName(b), back: nav("") }];
  const [head, hid, third] = (ui.page ?? "").split("/");
  const h = head === "households" && hid ? b.households.find((x) => String(x.id) === hid) : undefined;
  let page: string;
  if (h) {
    const familyTrail: Crumb[] = [...trail, { label: "Households", back: nav("households") }, { label: h.code, back: nav(`households/${h.id}`) }];
    page = familyBox(v, h, familyTrail, third);
  } else {
    const { open, crumbs } = openFor(v, head);
    page = boxPage(open ? [...trail, ...crumbs] : trail, [welcomePreview(b, !!ui.answering)], boxCells(v), open);
  }
  const newTable = isKeepTable(ui.new ?? "") ? (ui.new as KeepTable) : undefined;
  const modalOpen = !!ui.new || !!ui.confirm;
  const locked = modalOpen || !!ui.keep || !!ui.answering;
  const modal = join(
    newTable && addModal(`Add a ${KEEP[newTable].noun}`, [{ name: "name", label: `The ${KEEP[newTable].noun}'s name` }], write("board", "add", `/${newTable}/-`)),
    ui.new === "households" &&
      addModal(
        "Invite a household",
        [
          { name: "email", label: "Their email", type: "email" },
          { name: "names", label: "Names on the invitation", placeholder: "comma-separated", required: false },
          { name: "plus_ones", label: "Plus-ones they may name", type: "number", value: "0", required: false },
        ],
        write("board", "add", "/households/-"),
        "Invite",
      ),
    confirmRemove(v),
  );
  const body = join(inertWhile(modalOpen, join(page, keepSheet(v), codeSheet(v, h), welcomeSheet(v))), modal);
  return frame(false, body, ui.page ?? "", locked);
}

/** The modal asking to confirm a removal -- a modal is new or delete and nothing else (rule 14). */
function confirmRemove(v: BoardView): string {
  const [table, idText] = (v.session.ui.confirm ?? "").split("/");
  if (!table || !isKeepTable(table)) return "";
  const id = Number(idText);
  const list = v.b[table] as { id: number; name: string }[];
  const found = list.find((r) => r.id === id);
  if (!found) return "";
  const { noun } = KEEP[table];
  return confirmModal(`Remove this ${noun}`, `Remove "${found.name}" from the list?`, write("board", "remove", `/${table}/${id}`));
}

// ───────────────────────────── the home ─────────────────────────────

/** A field edited where it is: its own path, written when it loses focus (see the enclosing `data-write-on="blur"` form). */
function field(path: string, name: string, value: string, label: string, placeholder = "", type = "text"): string {
  return `<input class="field"${write("board", "replace", path)} name="${esc(name)}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" aria-label="${esc(label)}" autocomplete="off">`;
}

/** A picture for the welcome, a gift or a place: the one applet, since choosing a file and sending it is the browser's job. */
export const pictureField = (path: string, current: string | null): string =>
  `<div data-applet="picture-field" data-props="${esc(JSON.stringify({ doc: "board", path, current }))}"></div>`;

/** The welcome as the couple's own thing (rule 15): the names, the day, the deadline, carrying ✎;
 * a tap opens the drawer where the whole of it is edited, and it is lit while that drawer is open. */
function welcomePreview(b: BoardDocument, open: boolean): string {
  return join(
    `<div class="bubble couple thing" role="button" tabindex="0" aria-pressed="${open}"${write("session", "replace", "/answering", "1")}>`,
    `<div class="bubble-words"><span class="welcome-names">${esc(coupleName(b))}</span>`,
    `<span class="note">${esc(formatDay(b.day))}${b.venue ? ` · ${esc(b.venue)}` : ""}${b.deadline ? ` · answers by ${esc(formatDay(b.deadline))}` : ""}</span></div>`,
    `<span class="pencil" aria-hidden="true">${icon("pencil", 16)}</span>`,
    "</div>",
  );
}

/** The welcome's drawer: every property it carries, each its own path, written on blur. */
function welcomeSheet(v: BoardView): string {
  if (!v.session.ui.answering) return "";
  const { b } = v;
  const body = join(
    `<form data-write-on="blur"><div class="props">`,
    prop("Names", `<div class="pair">${field("/name1", "name1", b.name1, "The first name", "one name")}<span class="amp">&amp;</span>${field("/name2", "name2", b.name2, "The second name", "the other")}</div>`),
    prop("The day", field("/day", "day", b.day, "The day", "2027-04-02")),
    prop("The place", field("/venue", "venue", b.venue ?? "", "The place", "where")),
    prop("Answers by", field("/deadline", "deadline", b.deadline ?? "", "Answers by", "2027-02-01")),
    prop("Your words", `<textarea name="message"${write("board", "replace", "/message")} rows="3" placeholder="Your words on the welcome" aria-label="Your words on the welcome">${esc(b.message ?? "")}</textarea>`),
    `</div></form>`,
    `<div class="props">${prop("Picture", join(b.picture_key && `<div class="sheet-pic">${picture(b.picture_key, "")}</div>`, pictureField("/picture_key", b.picture_key)))}</div>`,
  );
  return sheet("welcome-sheet", "Our welcome", body, write("session", "remove", "/answering"), "welcome-sheet");
}

/** The home's compartments, all five, whether shown whole or one of them is grown into the window. */
function boxCells(v: BoardView) {
  const { b } = v;
  const claimed = b.gifts.filter((g) => g.taken > 0).length;
  const shared = b.gifts.filter((g) => g.shared).length;
  const t = b.totals;
  return [
    cell({ name: "households", mark: "home", count: t.households, big: true, summary: `${t.answered} answered · ${t.coming} coming${t.asksWaiting ? ` · ${plural(t.asksWaiting, "ask", "asks")} waiting` : ""}`, opens: nav("households"), body: boardFamilies(b.households).length ? `<div class="mini photo">${boardMini(b)}</div>` : undefined }),
    cell({ name: "courses", mark: "utensils", count: b.courses.length, summary: coursesSummary(b.courses), opens: nav("courses") }),
    cell({ name: "gifts", mark: "gift", count: b.gifts.length, summary: b.gifts.length ? `${claimed} claimed${shared ? ` · ${shared} shared` : ""}` : "none yet", opens: nav("gifts") }),
    cell({ name: "events", mark: "calendar", count: b.events.length, summary: eventsSummary(b.events), opens: nav("events") }),
    cell({ name: "where to stay", mark: "bed", count: b.places.length, summary: placesSummary(b.places), opens: nav("places"), key: "places" }),
  ];
}

// ───────────────────────────── the households ─────────────────────────────

export const reading = (v: BoardView, key: string): string => v.session.ui.reading?.[key] ?? "photo";

const chaseLink = (h: HouseholdDocument): string =>
  `<a class="tool quiet" href="mailto:${esc(h.email)}?subject=${encodeURIComponent("Just checking in")}">${icon("mail")}Chase them</a>`;

/** Every household as a family: its guests as members, the code on the family figure's chest, the
 * answer at its feet. Find's word (rule 17) hushes a whole family at once, by its code and names. */
function boardFamilies(households: HouseholdDocument[], word?: string): Family[] {
  const families: Family[] = [];
  for (const h of [...households].sort((a, b) => a.code.localeCompare(b.code))) {
    const mark = answerOf(h);
    const tap: PhotoEntry["tap"] = { doc: "session", op: { op: "replace", path: "/page", value: `households/${h.id}` } };
    const hush = word !== undefined && !matches(`${h.code} ${h.guests.map((g) => g.name).join(" ")}`, word);
    const members: PhotoEntry[] = h.guests.map((g) => {
      const state = inPhoto({ coming: g.coming, answer: h.answer });
      return { key: String(g.id), spec: specOf(g.minifigure, g.name), ghost: state === "ghost", out: state === null, mark, tap, hushed: hush };
    });
    if (!members.length) continue;
    families.push({ key: String(h.id), members, label: h.code, mark, ghost: mark === "maybe", out: mark === "no" || mark === "none", tap, hushed: hush });
  }
  return families;
}

/** The photo of families as the home's small reading: still, no taps. Replaced alone when a look changes. */
export const boardMini = (b: BoardDocument): string =>
  photoMount("board-mini", familiesPhoto(boardFamilies(b.households), null).entries.map((e) => ({ ...e, tap: undefined })), "the families");

/** The board's photo of families: its mount, replaced alone when a look changes. */
export function boardPhoto(v: BoardView): string {
  const { entries, label } = familiesPhoto(boardFamilies(v.b.households, v.session.ui.filter?.households), null);
  return photoMount("board-photo", entries, label);
}

/** A family's photo as the couple read it, no taps. Replaced alone when a look changes. */
export const familyPhoto = (h: HouseholdDocument, id = "family-photo"): string => photoMount(id, familyEntries(h, false), `${h.code}, as minifigures`);

/** A family's guest as a row: name, choices, whether coming. Replaced alone when a choice changes. */
export const familyGuestRow = (v: BoardView, g: HouseholdDocument["guests"][number]): string =>
  row({
    id: `guest-${g.id}`,
    what: g.name,
    note: choicesLine(g, v.b.courses),
    state: answerWord(g.coming === null ? "none" : isComing(g) ? "yes" : "no", g.coming === null ? "not said" : isComing(g) ? "coming" : "not coming"),
  });

/** The households grown into the window: the photo of families or the list (rule 16), find, and the plus that invites. */
function householdsOpen(v: BoardView): OpenOptions {
  const { b } = v;
  const word = v.session.ui.filter?.households;
  const hide = v.session.ui.hide?.households;
  const hits = (h: HouseholdDocument) => word === undefined || matches(`${h.code} ${h.guests.map((g) => g.name).join(" ")}`, word);
  const find = findControl("households", { word, hide, shown: b.households.filter(hits).length, total: b.households.length });
  const photo = reading(v, "households") === "photo";
  let body: string;
  if (photo) {
    body = boardFamilies(b.households).length ? `<div class="reading photo">${boardPhoto(v)}</div>` : `<p class="note">Nobody invited yet.</p>`;
  } else {
    const rank: Record<string, number> = { none: 0, maybe: 1, yes: 2, no: 3 };
    const sorted = [...b.households].sort((x, y) => rank[answerOf(x)]! - rank[answerOf(y)]! || x.code.localeCompare(y.code));
    body = rows(
      sorted.map((h) => {
        const names = h.guests.map((g) => firstNameOf(g.name) + (g.coming === null || isComing(g) ? "" : " (not coming)")).join(", ");
        const waiting = h.asks.filter((a) => a.reply === null).length;
        return row({
          id: `household-${h.id}`,
          tap: nav(`households/${h.id}`),
          hushed: !hits(h),
          hidden: !hits(h) && hide,
          what: h.code,
          note: [names || "nobody named yet", waiting ? `${plural(waiting, "ask", "asks")} waiting` : ""].filter(Boolean).join(" · "),
          state: answerWord(answerOf(h)),
          mark: "chevron",
        });
      }),
      "Nobody invited yet.",
    );
  }
  return {
    key: "households",
    reading: readingSwitch("households", reading(v, "households"), [["photo", "camera"], ["list", "list"]]),
    tools: [b.households.length ? find.tool : "", addTool("households", "Invite a household")].filter(Boolean),
    filter: find.filter,
    body,
    note: photo && word === undefined ? "Tap a family to see them. At their feet, their answer." : null,
  };
}

/** A family's bubble as the couple read it: the same display as the household's own, not theirs to touch. */
function familyBubble(h: HouseholdDocument): string {
  const words = h.message ?? "";
  return `<div class="bubble theirs${h.answer ? " answered" : ""}">${faceMark(h.answer)}<div class="bubble-words${words ? "" : " empty"}">${esc(words || (h.answer ? `${answerSays(h.answer)}.` : "No answer yet."))}</div></div>`;
}

/** The yes or no the couple give an ask, on its row: the one decision the row is for. */
const replyChoice = (h: HouseholdDocument, askId: number): string =>
  choice(`${h.code}'s ask`, [
    { text: "Yes", on: false, write: write("board", "replace", `/households/${h.id}/asks/${askId}/reply`, "yes"), kind: "yes" },
    { text: "No", on: false, write: write("board", "replace", `/households/${h.id}/asks/${askId}/reply`, "no"), kind: "no" },
  ]);

/** A family's own asks, grown into their own box's window (rule 7: the same "asks" cell, its own key). */
function familyAsksOpen(h: HouseholdDocument): OpenOptions {
  const body = rows(
    h.asks.map((a) =>
      row({
        id: `ask-${a.id}`,
        what: a.name,
        note: a.reply === "yes" ? "yes — a guest now" : a.reply === "no" ? "no" : "waiting for your answer",
        state: a.reply === null ? replyChoice(h, a.id) : answerWord(a.reply),
      }),
    ),
    "They have not asked for anyone.",
  );
  return { key: "asks", body };
}

/** A family's guests, grown into the window: the photo or the list, as the couple read them. */
function familyGuestsOpen(v: BoardView, h: HouseholdDocument): OpenOptions {
  const key = `family-${h.id}`;
  const photo = reading(v, key) === "photo";
  return {
    key: "guests",
    reading: h.guests.length ? readingSwitch(key, reading(v, key), [["photo", "camera"], ["list", "list"]]) : undefined,
    body: photo
      ? h.guests.length ? `<div class="reading photo">${familyPhoto(h)}</div>` : `<p class="note">Nobody named yet.</p>`
      : rows(h.guests.map((g) => familyGuestRow(v, g)), "Nobody named yet."),
  };
}

/** A family's own box, as the couple read it: their guests, their asks, and the code -- a thing
 * (rule 15) whose drawer holds the email, the plus-ones and the way to chase them. */
function familyBox(v: BoardView, h: HouseholdDocument, trail: Crumb[], third: string | undefined): string {
  const waiting = h.asks.filter((a) => a.reply === null).length;
  const cells = [
    cell({ name: "guests", mark: "users", count: h.guests.length, big: true, opens: nav(`households/${h.id}/guests`), key: "guests", summary: `${h.guests.filter(isComing).length} coming`, body: h.guests.length ? `<div class="mini photo">${familyPhoto(h, "family-mini")}</div>` : undefined }),
    cell({ name: "asks", mark: "question", count: h.asks.length, summary: waiting ? `${waiting} waiting for your answer` : h.asks.length ? "all answered" : "none", opens: nav(`households/${h.id}/asks`), key: "asks" }),
    cell({ name: "the code", mark: "mail", summary: `${h.code} · ${h.email}`, thing: { open: write("session", "replace", "/keep", `households/${h.id}`), chosen: v.session.ui.keep === `households/${h.id}` } }),
  ];
  const open = third === "asks" ? familyAsksOpen(h) : third === "guests" ? familyGuestsOpen(v, h) : undefined;
  const crumbs: Crumb[] = third === "asks" ? [{ label: "Asks" }] : third === "guests" ? [{ label: "Guests" }] : [];
  return boxPage([...trail, ...crumbs], [familyBubble(h)], cells, open);
}

/** The code's drawer: the family's email, how many plus-ones they may name, and the way to chase them. */
function codeSheet(v: BoardView, h: HouseholdDocument | undefined): string {
  if (!h || v.session.ui.keep !== `households/${h.id}`) return "";
  const body = join(
    `<form data-write-on="blur"><div class="props">`,
    prop("Code", `<span class="code">${esc(h.code)}</span>`),
    prop("Email", `<span>${esc(h.email)}</span>`),
    prop("Plus-ones", field(`/households/${h.id}/plus_ones`, "plus_ones", String(h.plus_ones), "Plus-ones they may name", "0", "number")),
    `</div></form>`,
    `<div class="sheet-foot">${chaseLink(h)}</div>`,
  );
  return sheet("code-sheet", "The code", body, write("session", "remove", "/keep"), "code-sheet");
}

// ───────────────────────────── keeping ─────────────────────────────

const openKeep = (table: KeepTable) => (id: number) => write("session", "replace", "/keep", `${table}/${id}`);

/** The row the couple have open in a keep table, if it is this one's. */
function keptIn(v: BoardView, table: KeepTable): number | undefined {
  const [t, id] = (v.session.ui.keep ?? "").split("/");
  return t === table ? Number(id) : undefined;
}

/** The couple's collections -- courses, gifts, events, where to stay: a row each, ✎ its drawer, the plus on the rail. */
function keepOpen(v: BoardView, table: KeepTable): OpenOptions {
  const { b } = v;
  const { noun } = KEEP[table];
  const chosen = keptIn(v, table);
  const open = openKeep(table);
  const tools: string[] = [];
  let body: string;
  let filter: string | undefined;
  if (table === "events") body = timetableRows(b.events, { open, chosen });
  else if (table === "places") body = placeRows(b.places, { open, chosen });
  else if (table === "courses") {
    body = rows(
      b.courses.map((c) => row({ id: `course-${c.id}`, tap: open(c.id), chosen: chosen === c.id, what: c.name, note: `${plural(c.dishes.length, "dish", "dishes")} · ${plural(c.drinks.length, "drink", "drinks")}`, mark: "pencil" })),
      "No courses yet.",
    );
  } else {
    // find (rule 17) is on the gifts, the one list long enough to need it
    const word = v.session.ui.filter?.gifts;
    const hide = v.session.ui.hide?.gifts;
    const hits = (g: BoardDocument["gifts"][number]) => word === undefined || matches(g.name, word);
    const find = findControl("gifts", { word, hide, shown: b.gifts.filter(hits).length, total: b.gifts.length });
    if (b.gifts.length) tools.push(find.tool);
    filter = find.filter;
    body = rows(
      b.gifts.map((g) =>
        row({
          id: `gift-${g.id}`,
          tap: open(g.id),
          chosen: chosen === g.id,
          hushed: !hits(g),
          hidden: !hits(g) && hide,
          lead: g.picture_key ? picture(g.picture_key, g.name) : undefined,
          what: g.name,
          note: g.description,
          state: `<span>${g.shared ? "shared · " : ""}${g.claimants.length ? `claimed by ${esc(g.claimants.join(", "))}` : "unclaimed"}</span>`,
          mark: "pencil",
        }),
      ),
      "No gifts yet.",
    );
  }
  tools.push(addTool(table, `Add a ${noun}`));
  return { key: table, tools, filter, body };
}

/** The row's drawer: its properties, each a field; a course's dishes and drinks; its place in the order; Remove at the foot. */
function keepSheet(v: BoardView): string {
  const [table, idText] = (v.session.ui.keep ?? "").split("/");
  if (!table || !isKeepTable(table)) return "";
  const id = Number(idText);
  const list = v.b[table] as { id: number; name: string; seq: number }[];
  const found = list.find((r) => r.id === id);
  if (!found) return "";
  const at = `/${table}/${id}`;
  const { noun } = KEEP[table];
  const position = list.indexOf(found) + 1;
  const order = prop(
    "Order",
    join(
      `<div class="pair">`,
      tool("Move up", { icon: "up", iconOnly: true, write: write("board", "replace", `${at}/seq`, position - 1), disabled: position === 1 }),
      tool("Move down", { icon: "down", iconOnly: true, write: write("board", "replace", `${at}/seq`, position + 1), disabled: position === list.length }),
      `<span class="note">${position} of ${list.length}</span></div>`,
    ),
  );
  const props: string[] = [prop("Name", field(`${at}/name`, "name", found.name, "Name"))];
  let extra = "";
  if (table === "courses") {
    const c = v.b.courses.find((x) => x.id === id)!;
    const dishRows = c.dishes.map((d) =>
      join(
        `<div class="pair">`,
        field(`${at}/dishes/${d.id}/name`, "name", d.name, "Dish", "dish"),
        field(`${at}/dishes/${d.id}/dietary`, "dietary", d.dietary ?? "", "Dietary marks", "v, gf"),
        tool(`remove ${d.name}`, { icon: "trash", kind: "danger", iconOnly: true, write: write("board", "remove", `${at}/dishes/${d.id}`) }),
        "</div>",
      ),
    );
    const drinkRows = c.drinks.map((d) =>
      join(`<div class="pair">`, field(`${at}/drinks/${d.id}/name`, "name", d.name, "Drink", "drink"), tool(`remove ${d.name}`, { icon: "trash", kind: "danger", iconOnly: true, write: write("board", "remove", `${at}/drinks/${d.id}`) }), "</div>"),
    );
    const addForm = (kind: "dishes" | "drinks", word: string) =>
      `<form class="pair"${write("board", "add", `${at}/${kind}/-`)}><input class="field" name="name" placeholder="A ${word}" aria-label="${esc(`A new ${word}`)}" autocomplete="off" required>${tool(`Add a ${word}`, { icon: "plus", kind: "add", write: "", submit: true })}</form>`;
    extra = join(
      `<h3 class="cap">Dishes</h3><form data-write-on="blur"><div class="props">${dishRows.join("")}</div></form>${addForm("dishes", "dish")}`,
      `<h3 class="cap">Drinks</h3><form data-write-on="blur"><div class="props">${drinkRows.join("")}</div></form>${addForm("drinks", "drink")}`,
    );
  } else if (table === "gifts") {
    const g = v.b.gifts.find((x) => x.id === id)!;
    props.push(
      prop("Words", field(`${at}/description`, "description", g.description ?? "", "Words", "a line about it")),
      prop("Link", field(`${at}/link`, "link", g.link ?? "", "Link", "https://")),
      prop(
        "Shared",
        choice("Shared: any number may claim it", [
          { text: "Yes", on: g.shared, write: write("board", "replace", `${at}/shared`, "1"), kind: "yes" },
          { text: "No", on: !g.shared, write: write("board", "replace", `${at}/shared`, "0"), kind: "no" },
        ]),
      ),
      prop("Picture", pictureField(`${at}/picture_key`, g.picture_key)),
    );
  } else if (table === "events") {
    const e = v.b.events.find((x) => x.id === id)!;
    props.push(
      prop("When", field(`${at}/when_at`, "when_at", e.when_at ?? "", "When", "2027-04-02T13:00")),
      prop("Where", field(`${at}/where_at`, "where_at", e.where_at ?? "", "Where")),
      prop("Notes", field(`${at}/notes`, "notes", e.notes ?? "", "Notes")),
    );
  } else {
    const p = v.b.places.find((x) => x.id === id)!;
    props.push(
      prop("Notes", field(`${at}/notes`, "notes", p.notes ?? "", "Notes", "how far, how to book")),
      prop("Link", field(`${at}/link`, "link", p.link ?? "", "Link", "https://")),
      prop("Picture", pictureField(`${at}/picture_key`, p.picture_key)),
    );
  }
  // removing asks in a modal (rule 14) -- the drawer only opens it; `confirmRemove` does the write
  const remove = `<div class="sheet-foot">${tool(`Remove this ${noun}`, { icon: "trash", kind: "danger", write: write("session", "replace", "/confirm", at.slice(1)) })}</div>`;
  const body = join(`<form data-write-on="blur"><div class="props">${props.join("")}${order}</div></form>`, extra, remove);
  return sheet("keep-sheet", found.name, body, write("session", "remove", "/keep"), "keep-sheet");
}
