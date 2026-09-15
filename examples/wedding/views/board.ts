// The couple's pages: their home -- the welcome edited in place, then households, courses, gifts,
// events and where to stay as compartments -- the households collection (the photo of families or
// the list, with each waiting ask beneath its household and Yes/No on the row), a family's box as
// the couple read it, and the four lists they keep, each row opening its drawer.

import type { BoardDocument } from "../documents/board";
import type { HouseholdDocument } from "../documents/household";
import type { SessionDocument } from "../documents/session";
import { boxPage, cell, collectionPage, leaveTool, readingSwitch, redoTool, sheet, tool, undoTool, type Crumb } from "./bento";
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
  isComing,
  pencil,
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

export function boardPages(v: BoardView): string {
  const { b } = v;
  const trail: Crumb[] = [{ label: coupleName(b), page: "" }];
  const [head, hid, third] = (v.session.ui.page ?? "").split("/");
  let page: string;
  if (head === "households") {
    const h = hid ? b.households.find((x) => String(x.id) === hid) : undefined;
    if (!hid) page = householdsCollection(v, trail);
    else if (!h) page = householdsCollection(v, trail);
    else {
      const familyTrail: Crumb[] = [...trail, { label: "Households", page: "households" }, { label: h.code, page: `households/${h.id}` }];
      page = third === "asks" ? familyAsks(h, familyTrail) : familyBox(v, h, familyTrail);
    }
  } else if (head && isKeepTable(head)) {
    page = keepCollection(v, head, trail);
  } else {
    page = rootBox(v, trail);
  }
  return frame(false, join(page, keepSheet(v)), v.session.ui.page ?? "");
}

// ───────────────────────────── the home ─────────────────────────────

/** A field edited where it is: its own path, written when it loses focus (see the enclosing `data-write-on="blur"` form). */
function field(path: string, name: string, value: string, label: string, placeholder = "", classes = "field"): string {
  return `<input class="${classes}"${write("board", "replace", path)} name="${esc(name)}" value="${esc(value)}" placeholder="${esc(placeholder)}" aria-label="${esc(label)}" autocomplete="off">`;
}

/** A field on its own row in a `.rows` stack -- wrapped so the row keeps its own height, not one flexed by the column. */
const fieldRow = (path: string, name: string, value: string, label: string, placeholder = ""): string =>
  `<div class="field-form">${field(path, name, value, label, placeholder)}</div>`;

/** A picture for the welcome, a gift or a place: the one applet, since choosing a file and sending it is the browser's job. */
export const pictureField = (path: string, current: string | null): string =>
  `<div data-applet="picture-field" data-props="${esc(JSON.stringify({ doc: "board", path, current }))}"></div>`;

function rootBox(v: BoardView, trail: Crumb[]): string {
  const { b } = v;
  const claimed = b.gifts.filter((g) => g.taken > 0).length;
  const shared = b.gifts.filter((g) => g.shared).length;
  const t = b.totals;
  const welcome = join(
    `<div class="welcome-preview"><p class="kicker">The marriage of</p>`,
    `<div class="names"><form class="field-form" data-write-on="blur">${field("/name1", "name1", b.name1, "The first name", "one name")}<span class="amp">&amp;</span>${field("/name2", "name2", b.name2, "The second name", "the other")}</form></div>`,
    `<div class="when-where"><form class="field-form" data-write-on="blur">${field("/day", "day", b.day, "The day", "2027-04-02")}${field("/venue", "venue", b.venue ?? "", "The place", "where")}</form></div>`,
    `<p class="when">${esc(formatDay(b.day))}</p>`,
    b.deadline && `<p class="note">Answers by ${esc(formatDay(b.deadline))}.</p>`,
    b.picture_key ? picture(b.picture_key, "") : `<p class="note">No photograph yet.</p>`,
    `<div class="welcome-tools">${pictureField("/picture_key", b.picture_key)}</div>`,
    `</div>`,
    `<div class="bubble couple"><form class="words-form" data-write-on="blur"><textarea class="message-box"${write("board", "replace", "/message")} name="message" rows="2" placeholder="Your words on the welcome" aria-label="Your words on the welcome">${esc(b.message ?? "")}</textarea></form></div>`,
  );
  return boxPage(
    trail,
    [welcome],
    [
      cell({ name: "households", mark: "home", count: t.households, summary: `${t.answered} answered · ${t.coming} coming${t.asksWaiting ? ` · ${plural(t.asksWaiting, "ask", "asks")} waiting` : ""}`, page: "households" }),
      cell({ name: "courses", mark: "utensils", count: b.courses.length, summary: coursesSummary(b.courses), page: "courses" }),
      cell({ name: "gifts", mark: "gift", count: b.gifts.length, summary: b.gifts.length ? `${claimed} claimed${shared ? ` · ${shared} shared` : ""}` : "none yet", page: "gifts" }),
      cell({ name: "events", mark: "calendar", count: b.events.length, summary: eventsSummary(b.events), page: "events" }),
      cell({ name: "where to stay", mark: "bed", count: b.places.length, summary: placesSummary(b.places), page: "places" }),
    ],
    [undoTool(), redoTool(), leaveTool()],
  );
}

// ───────────────────────────── the households ─────────────────────────────

export const reading = (v: BoardView, key: string): string => v.session.ui.reading?.[key] ?? "photo";

const chaseLink = (h: HouseholdDocument): string =>
  `<a class="chase-link" href="mailto:${esc(h.email)}?subject=${encodeURIComponent("Just checking in")}">${icon("mail")}chase</a>`;

const replyPills = (h: HouseholdDocument, askId: number): string =>
  `<div class="coming-pills reply-pills" role="group" aria-label="yes or no"><button class="pill pill-sm yes" type="button"${write("board", "replace", `/households/${h.id}/asks/${askId}/reply`, "yes")}>Yes</button><button class="pill pill-sm no" type="button"${write("board", "replace", `/households/${h.id}/asks/${askId}/reply`, "no")}>No</button></div>`;

/** Every household as a family: its guests as members, the code on the family figure's chest, the answer at its feet. */
function boardFamilies(households: HouseholdDocument[]): Family[] {
  const families: Family[] = [];
  for (const h of [...households].sort((a, b) => a.code.localeCompare(b.code))) {
    const mark = answerOf(h);
    const tap: PhotoEntry["tap"] = { doc: "session", op: { op: "replace", path: "/page", value: `households/${h.id}` } };
    const members: PhotoEntry[] = h.guests.map((g) => {
      const state = inPhoto({ coming: g.coming, answer: h.answer });
      return { key: String(g.id), spec: specOf(g.minifigure, g.name), ghost: state === "ghost", out: state === null, mark, tap };
    });
    if (!members.length) continue;
    families.push({ key: String(h.id), members, label: h.code, mark, ghost: mark === "maybe", out: mark === "no" || mark === "none", tap });
  }
  return families;
}

/** The board's photo of families: its mount, replaced alone when a look changes. */
export function boardPhoto(v: BoardView): string {
  const { entries, label } = familiesPhoto(boardFamilies(v.b.households), null);
  return photoMount("board-photo", entries, label);
}

/** A family's photo as the couple read it, no taps. Replaced alone when a look changes. */
export const familyPhoto = (h: HouseholdDocument): string => photoMount("family-photo", familyEntries(h, false), `${h.code}, as minifigures`);

/** A family's guest as a row: name, choices, whether coming. Replaced alone when a choice changes. */
export const familyGuestRow = (v: BoardView, g: HouseholdDocument["guests"][number]): string =>
  `<div class="row-line stay" id="guest-${g.id}"><div><span class="what">${esc(g.name)}</span><p class="note">${esc(choicesLine(g, v.b.courses))}</p></div><span class="said">${g.coming === null ? "not said" : isComing(g) ? "coming" : "not coming"}</span></div>`;

function householdsCollection(v: BoardView, trail: Crumb[]): string {
  const { b } = v;
  let body: string;
  if (reading(v, "households") === "photo") {
    body = boardFamilies(b.households).length ? `<div class="reading photo-reading">${boardPhoto(v)}</div>` : `<p class="note">Nobody invited yet.</p>`;
  } else {
    const rank: Record<string, number> = { none: 0, maybe: 1, yes: 2, no: 3 };
    const rows = [...b.households].sort((x, y) => rank[answerOf(x)]! - rank[answerOf(y)]! || x.code.localeCompare(y.code));
    body = `<div class="rows">${rows
      .flatMap((h) => {
        const names = h.guests.map((g) => firstNameOf(g.name) + (g.coming === null || isComing(g) ? "" : " (not coming)")).join(", ");
        return [
          join(
            `<div class="row-line stay"><div>`,
            `<a class="name-link" href="#"${nav(`households/${h.id}`)}>${esc(h.code)}${icon("chevron-right")}</a>`,
            `<p class="note">${esc(names || "nobody named yet")}</p>`,
            h.message && `<p class="note quote">“${esc(h.message)}”</p>`,
            `</div><div class="answer-cell">${answerWord(answerOf(h))}${chaseLink(h)}</div></div>`,
          ),
          ...h.asks
            .filter((a) => a.reply === null)
            .map((a) => `<div class="row-line ask"><div><span class="what">${esc(a.name)}</span><p class="note">asked by ${esc(h.code)}</p></div>${replyPills(h, a.id)}</div>`),
        ];
      })
      .join("")}</div>`;
  }
  const invite = join(
    `<form class="tool-form invite"${write("board", "add", "/households/-")}>`,
    `<input class="field" name="email" type="email" placeholder="Their email" aria-label="The household's email" autocomplete="off" required>`,
    `<input class="field" name="names" placeholder="Names on the invitation, comma-separated" aria-label="Names on the invitation" autocomplete="off">`,
    `<input class="field short" name="plus_ones" type="number" min="0" value="0" aria-label="Plus-ones they may name">`,
    `<button type="submit" class="tool add">${icon("plus")}Invite a household</button></form>`,
  );
  return collectionPage([...trail, { label: "Households" }], {
    tools: [readingSwitch("households", reading(v, "households"), ["photo", "list"]), invite],
    body,
    note: reading(v, "households") === "photo" ? "Tap a family to see them. At their feet, their answer." : null,
    foot: [undoTool(), redoTool(), leaveTool()],
  });
}

/** A family's bubble as the couple read it: the same display as the household's own, not theirs to touch. */
function familyBubble(h: HouseholdDocument): string {
  const words = h.message ?? "";
  return `<div class="bubble theirs${h.answer ? " answered" : ""}">${faceMark(h.answer)}<div class="bubble-words${words ? "" : " empty"}">${esc(words || (h.answer ? `${answerSays(h.answer)}.` : "No answer yet."))}</div></div>`;
}

function familyBox(v: BoardView, h: HouseholdDocument, trail: Crumb[]): string {
  const waiting = h.asks.filter((a) => a.reply === null).length;
  const key = `family-${h.id}`;
  const guests =
    reading(v, key) === "photo"
      ? h.guests.length ? `<div class="reading photo-reading">${familyPhoto(h)}</div>` : `<p class="note">Nobody named yet.</p>`
      : `<div class="rows">${h.guests.map((g) => familyGuestRow(v, g)).join("")}</div>`;
  const plusOnes = `<form class="tool-form" data-write-on="blur"><label class="when" for="plus-ones">Plus-ones</label><input class="field short" id="plus-ones" name="plus_ones" type="number" min="0" value="${h.plus_ones}"${write("board", "replace", `/households/${h.id}/plus_ones`)}></form>`;
  return boxPage(
    trail,
    [familyBubble(h)],
    [
      cell({ name: "guests", mark: "users", count: h.guests.length, big: true, tools: h.guests.length ? readingSwitch(key, reading(v, key), ["photo", "list"]) : undefined, body: guests }),
      cell({ name: "asks", mark: "question", count: h.asks.length, summary: waiting ? `${waiting} waiting for your answer` : h.asks.length ? "all answered" : "none", page: `households/${h.id}/asks` }),
      cell({ name: "the code", summary: `${h.code} · ${h.email}`, body: plusOnes }),
    ],
    [chaseLink(h), undoTool(), redoTool(), leaveTool()],
  );
}

function familyAsks(h: HouseholdDocument, trail: Crumb[]): string {
  const body = h.asks.length
    ? `<div class="rows">${h.asks
        .map(
          (a) =>
            `<div class="row-line ask"><div><span class="what">${esc(a.name)}</span><p class="note">${a.reply === "yes" ? "yes — a guest now" : a.reply === "no" ? "no" : "waiting for your answer"}</p></div>${a.reply === null ? replyPills(h, a.id) : answerWord(a.reply)}</div>`,
        )
        .join("")}</div>`
    : `<p class="note">They have not asked for anyone.</p>`;
  return collectionPage([...trail, { label: "Asks" }], { body, foot: [undoTool(), redoTool(), leaveTool()] });
}

// ───────────────────────────── keeping ─────────────────────────────

const openKeep = (table: KeepTable) => (id: number) => write("session", "replace", "/keep", `${table}/${id}`);

/** The couple's collections -- courses, gifts, events, where to stay: a row each, ✎ its drawer, Add on the collection. */
function keepCollection(v: BoardView, table: KeepTable, trail: Crumb[]): string {
  const { b } = v;
  const { label, noun } = KEEP[table];
  let body: string;
  if (table === "events") body = timetableRows(b.events, openKeep(table));
  else if (table === "places") body = placeRows(b.places, openKeep(table));
  else if (table === "courses") {
    body = b.courses.length
      ? `<div class="rows">${b.courses.map((c) => `<div class="row-line tap stay" role="button" tabindex="0"${openKeep(table)(c.id)}><div><span class="what">${esc(c.name)}</span><p class="note">${plural(c.dishes.length, "dish", "dishes")} · ${plural(c.drinks.length, "drink", "drinks")}</p></div>${pencil()}</div>`).join("")}</div>`
      : `<p class="note">No courses yet.</p>`;
  } else {
    body = b.gifts.length
      ? `<div class="rows">${b.gifts
          .map((g) =>
            join(
              `<div class="row-line tap gift${g.picture_key ? " pic" : ""}" role="button" tabindex="0"${openKeep(table)(g.id)}>`,
              g.picture_key && picture(g.picture_key, g.name),
              `<div><span class="what">${esc(g.name)}</span><p class="note">${g.shared ? "shared · " : ""}${g.claimants.length ? `claimed by ${esc(g.claimants.join(", "))}` : "unclaimed"}</p></div>`,
              pencil(),
              "</div>",
            ),
          )
          .join("")}</div>`
      : `<p class="note">No gifts yet.</p>`;
  }
  const add = `<form class="tool-form"${write("board", "add", `/${table}/-`)}><input class="field" name="name" placeholder="Its name" aria-label="${esc(`The ${noun}'s name`)}" autocomplete="off" required><button type="submit" class="tool add">${icon("plus")}Add a ${noun}</button></form>`;
  return collectionPage([...trail, { label }], { tools: [add], body, foot: [undoTool(), redoTool(), leaveTool()] });
}

/** The row's drawer: its fields, each a form; a course's dishes and drinks; its place in the order; Remove at the foot. */
function keepSheet(v: BoardView): string {
  const [table, idText] = (v.session.ui.keep ?? "").split("/");
  if (!table || !isKeepTable(table)) return "";
  const id = Number(idText);
  const rows = v.b[table] as { id: number; name: string; seq: number }[];
  const row = rows.find((r) => r.id === id);
  if (!row) return "";
  const at = `/${table}/${id}`;
  const { noun } = KEEP[table];
  const position = rows.indexOf(row) + 1;
  const order = join(
    `<div class="row-line field-row"><span class="when">Order</span><div class="tools">`,
    `<button type="button" class="ghost small" aria-label="Move up"${write("board", "replace", `${at}/seq`, position - 1)}${position === 1 ? " disabled" : ""}>${icon("up")}</button>`,
    `<button type="button" class="ghost small" aria-label="Move down"${write("board", "replace", `${at}/seq`, position + 1)}${position === rows.length ? " disabled" : ""}>${icon("down")}</button>`,
    `<span class="note">${position} of ${rows.length}</span></div></div>`,
  );
  const remove = `<div class="sheet-foot">${tool(`Remove this ${noun}`, { icon: "trash", kind: "danger", write: write("board", "remove", at) })}</div>`;
  const fields: string[] = [fieldRow(`${at}/name`, "name", row.name, "Name")];
  let extra = "";
  if (table === "courses") {
    const c = v.b.courses.find((x) => x.id === id)!;
    const dishRows = c.dishes.map((d) =>
      join(
        `<div class="row-line dish-row">`,
        field(`${at}/dishes/${d.id}/name`, "name", d.name, "Dish", "dish", "inline-field"),
        field(`${at}/dishes/${d.id}/dietary`, "dietary", d.dietary ?? "", "Dietary marks", "v, gf", "inline-field"),
        `<button type="button" class="ghost danger small" aria-label="${esc(`remove ${d.name}`)}"${write("board", "remove", `${at}/dishes/${d.id}`)}>${icon("trash", 15)}</button>`,
        "</div>",
      ),
    );
    const drinkRows = c.drinks.map((d) =>
      join(
        `<div class="row-line drink-row">`,
        field(`${at}/drinks/${d.id}/name`, "name", d.name, "Drink", "drink", "inline-field"),
        `<button type="button" class="ghost danger small" aria-label="${esc(`remove ${d.name}`)}"${write("board", "remove", `${at}/drinks/${d.id}`)}>${icon("trash", 15)}</button>`,
        "</div>",
      ),
    );
    const addForm = (kind: "dishes" | "drinks", word: string) =>
      `<div class="row-line tools-row"><form class="tool-form"${write("board", "add", `${at}/${kind}/-`)}><input class="field" name="name" placeholder="The ${word}" aria-label="${esc(`A new ${word}`)}" autocomplete="off" required><button type="submit" class="tool add">${icon("plus")}Add a ${word}</button></form></div>`;
    extra = join(
      `<h3 class="cap">Dishes</h3><form data-write-on="blur"><div class="rows">${dishRows.join("")}</div></form>${addForm("dishes", "dish")}`,
      `<h3 class="cap">Drinks</h3><form data-write-on="blur"><div class="rows">${drinkRows.join("")}</div></form>${addForm("drinks", "drink")}`,
    );
  } else if (table === "gifts") {
    const g = v.b.gifts.find((x) => x.id === id)!;
    fields.push(
      fieldRow(`${at}/description`, "description", g.description ?? "", "Words", "a line about it"),
      fieldRow(`${at}/link`, "link", g.link ?? "", "Link", "https://"),
      `<div class="row-line field-row"><span class="when">Shared</span><div class="coming-pills" role="radiogroup" aria-label="Shared: any number may claim it"><button type="button" class="pill pill-sm yes${g.shared ? " on" : ""}" role="radio" aria-checked="${g.shared}"${write("board", "replace", `${at}/shared`, "1")}>Yes</button><button type="button" class="pill pill-sm no${g.shared ? "" : " on"}" role="radio" aria-checked="${!g.shared}"${write("board", "replace", `${at}/shared`, "0")}>No</button></div></div>`,
      `<div class="row-line field-row"><span class="when">Picture</span>${pictureField(`${at}/picture_key`, g.picture_key)}</div>`,
    );
  } else if (table === "events") {
    const e = v.b.events.find((x) => x.id === id)!;
    fields.push(
      fieldRow(`${at}/when_at`, "when_at", e.when_at ?? "", "When", "2027-04-02T13:00"),
      fieldRow(`${at}/where_at`, "where_at", e.where_at ?? "", "Where"),
      fieldRow(`${at}/notes`, "notes", e.notes ?? "", "Notes"),
    );
  } else {
    const p = v.b.places.find((x) => x.id === id)!;
    fields.push(
      fieldRow(`${at}/notes`, "notes", p.notes ?? "", "Notes", "how far, how to book"),
      fieldRow(`${at}/link`, "link", p.link ?? "", "Link", "https://"),
      `<div class="row-line field-row"><span class="when">Picture</span>${pictureField(`${at}/picture_key`, p.picture_key)}</div>`,
    );
  }
  const body = join(`<form data-write-on="blur"><div class="rows">${fields.join("")}${order}</div></form>`, extra, remove);
  return sheet("keep-sheet", row.name, body, write("session", "remove", "/keep"), "keep-sheet");
}
