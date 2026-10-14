// The couple's page: the photo of every family, as a household's is its own. Their welcome is the
// bubble over it, a thing with ✎. A tap on a family opens its drawer -- their answer and words,
// their guests (added, taken off), whoever they asked for (yes or no), their email and plus-ones.
// The same families as a list is the other reading; find looks for a family by its code
// or a name; the plus invites a household. The four lists the couple keep -- courses,
// gifts, events, where to stay -- are tools on the rail, each a drawer of rows that takes a new one
// in place, and a row opens a drawer of its own, whose × goes back to its list.

import type { BoardDocument } from "../documents/board";
import type { HouseholdDocument } from "../documents/household";
import { over, type SessionDocument } from "../documents/session";
import { addModal, addTool, choice, collectionPage, confirmModal, findControl, prop, readingSwitch, row, rows, drawer, tool } from "./bento";
import { appletWrites, esc, join, nav, open as openAt, write } from "./html";
import { address } from "../../../src/bento";
import { part } from "../../../src/parts";
import { icon, type IconName } from "./icons";
import { familiesPhoto, photoMount, type Family, type PhotoEntry } from "./photo";
import { answerOf, answerSays, answerWord, choicesLine, coupleName, faceMark, firstNameOf, formatDay, frame, guestMark, layers, isComing, matches, picture, placeRows, plural, runNames, specOf, timetableRows, type AnswerMark } from "./shared";
import { inPhoto } from "../documents/wedding";

/** Opening something over the page the couple are on -- a drawer, a modal -- and putting it away: both are going somewhere (views/html.ts). */
const open_ = (v: BoardView, what: string, which: string | number = ""): string => openAt(over(v.session.ui).path, what, which);
const close = (v: BoardView): string => nav(over(v.session.ui).path);

export type BoardView = { session: SessionDocument; b: BoardDocument };

type KeepTable = "courses" | "gifts" | "events" | "places";
const KEEP: Record<KeepTable, { label: string; noun: string; mark: IconName }> = {
  courses: { label: "Courses", noun: "course", mark: "utensils" },
  gifts: { label: "Gifts", noun: "gift", mark: "gift" },
  events: { label: "Events", noun: "event", mark: "calendar" },
  places: { label: "Where to stay", noun: "place", mark: "bed" },
};
const isKeepTable = (s: string): s is KeepTable => s in KEEP;

/** The list a row's keep drawer belongs to (`courses/2` is the courses'), if any. */
const keptIn = (v: BoardView): { table: KeepTable; id: number } | undefined => {
  const [table = "", id] = (over(v.session.ui).keep ?? "").split("/");
  return isKeepTable(table) ? { table, id: Number(id) } : undefined;
};

/** Find's word on the families, and the eye: a family is found by its code or any of its names. */
const findOf = (v: BoardView) => ({ word: v.session.ui.filter?.households, hide: v.session.ui.hide?.households });
const hits = (h: HouseholdDocument, word: string | undefined): boolean => matches(`${h.code} ${h.guests.map((g) => g.name).join(" ")}`, word);

export function boardPage(v: BoardView): string {
  const { b } = v;
  const ui = v.session.ui;
  const at = over(ui);
  const list = at.path === "list";
  const { word, hide } = findOf(v);

  const readings: [text: string, on: boolean, path: string, mark: IconName][] = [
    ["Everyone", !list, "", "camera"],
    ["List", list, "list", "list"],
  ];
  const reading = readingSwitch(readings.map(([text, on, path, mark]) => [text, mark, on, nav(path)]));
  const find = b.households.length ? findControl("households", { word, hide, shown: b.households.filter((h) => hits(h, word)).length, total: b.households.length }) : undefined;
  const kept = keptIn(v)?.table;
  const tools = [
    find?.tool ?? "",
    ...(Object.keys(KEEP) as KeepTable[]).map((table) => {
      const on = at.drawer === table || kept === table;
      return tool(KEEP[table].label, { icon: KEEP[table].mark, iconOnly: true, expanded: on, write: on ? close(v) : open_(v, table) });
    }),
    addTool(open_(v, "new", "households"), "Invite a household"),
  ].filter(Boolean);
  const body = join(`<div class="photo-page">`, welcomeBubble(b, !!at.answering, open_(v, "answer")), list ? householdsList(v) : photoReading(v), `</div>`);
  const page = collectionPage([{ label: coupleName(b) }], { key: "photo", reading, tools, filter: find?.filter, body });

  const modal = join(
    at.new === "households" &&
      addModal(
        "Invite a household",
        [
          { name: "email", label: "Their email", type: "email" },
          { name: "names", label: "Names on the invitation", placeholder: "comma-separated", required: false },
          { name: "plus_ones", label: "Plus-ones they may name", type: "number", value: "0", required: false },
        ],
        write("board", "add", "/households/-"),
        close(v),
        "Invite",
      ),
    confirmTakeOff(v),
    confirmRemove(v),
  );
  const drawers = join(familySheet(v), listSheet(v), keepSheet(v), welcomeSheet(v));
  return frame(false, layers(page, drawers, modal), ui.page ?? "");
}

// ───────────────────────────── the page ─────────────────────────────

/** The welcome as the couple's own thing, over the photo: their words, the day, the place, the deadline, carrying ✎;
 * a button: a tap opens the drawer where the whole of it is edited, and it is lit while that drawer is open. Their names are the trail's. */
function welcomeBubble(b: BoardDocument, open: boolean, edit: string): string {
  return join(
    `<button type="button" class="bubble couple thing" aria-expanded="${open}"${edit}>`,
    `<span class="bubble-words${b.message ? "" : " empty"}"><span>${esc(b.message || "Your words on the welcome")}</span>`,
    `<span class="note">${esc(formatDay(b.day))}${b.venue ? ` · ${esc(b.venue)}` : ""}${b.deadline ? ` · answers by ${esc(formatDay(b.deadline))}` : ""}</span></span>`,
    `<span class="pencil" aria-hidden="true">${icon("pencil", 16)}</span>`,
    "</button>",
  );
}

/** Every household as a family: its guests as members, each with whether they are coming at their feet (the family figure
 * with the household's answer), the code on the family figure's chest; a tap
 * opens the family's drawer, and it rings while that is open. Find's word hushes a whole family at once; with the eye, it
 * steps out of the photo. */
function boardFamilies(v: BoardView): Family[] {
  const { path, family } = over(v.session.ui);
  const { word, hide } = findOf(v);
  const families: Family[] = [];
  for (const h of [...v.b.households].sort((a, b) => a.code.localeCompare(b.code))) {
    const hush = !hits(h, word);
    if (!h.guests.length || (hush && hide)) continue;
    const mark = answerOf(h);
    const tap: PhotoEntry["tap"] = { doc: "session", op: { op: "replace", path: "/page", value: address(path, "family", h.id) } };
    const chosen = family === h.id;
    const members: PhotoEntry[] = h.guests.map((g) => {
      const state = inPhoto({ coming: g.coming, answer: h.answer });
      return { key: String(g.id), spec: specOf(g.minifigure, g.name), ghost: state === "ghost", out: state === null, mark: guestMark(g, h), tap, hushed: hush, chosen };
    });
    families.push({ key: String(h.id), members, label: h.code, mark, ghost: mark === "maybe", out: mark === "no" || mark === "none", tap, hushed: hush, chosen });
  }
  return families;
}

/** The photo of families: its mount, replaced alone when a look changes. */
export function boardPhoto(v: BoardView): string {
  const { entries, label } = familiesPhoto(boardFamilies(v), null);
  return photoMount("board-photo", entries, label);
}

/** The page read as the photo: every family, and what the caterer needs to know of them. */
function photoReading(v: BoardView): string {
  const t = v.b.totals;
  if (!v.b.households.some((h) => h.guests.length)) return `<p class="note">Nobody invited yet.</p>`;
  const counts = `${plural(t.households, "household", "households")} · ${t.answered} answered · ${t.coming} coming${t.asksWaiting ? ` · ${plural(t.asksWaiting, "ask", "asks")} waiting` : ""}`;
  return `<div class="reading photo">${boardPhoto(v)}</div><p class="note">${esc(counts)}. Tap a family to see them; at their feet, their answer.</p>`;
}

/** The page read as a list: a household a row, ✎ its drawer, in runs by their answer -- those still to answer first -- each answer
 * said once, at the head of its run, not on every row. Each run is a group named by its head, so a screen reader moving through
 * the rows hears the answer as it enters the run. A run whose every row find hides goes with them; one it misses dims. */
function householdsList(v: BoardView): string {
  const { word, hide } = findOf(v);
  const family = over(v.session.ui).family;
  if (!v.b.households.length) return rows([], "Nobody invited yet.");
  const order: AnswerMark[] = ["none", "maybe", "yes", "no"];
  return order
    .map((mark) => {
      const run = v.b.households.filter((h) => answerOf(h) === mark).sort((x, y) => x.code.localeCompare(y.code));
      if (!run.length) return "";
      const missed = run.filter((h) => !hits(h, word)).length === run.length;
      const head = `<h3 class="cap run-head${missed ? " hushed" : ""}" id="run-${mark}">${answerWord(mark)}</h3>`;
      const items = run.map((h) => {
        const names = h.guests.map((g) => firstNameOf(g.name) + (g.coming === null || isComing(g) ? "" : " (not coming)")).join(", ");
        const waiting = h.asks.filter((a) => a.reply === null).length;
        return row({
          id: `household-${h.id}`,
          tap: open_(v, "family", h.id),
          chosen: family === h.id,
          hushed: !hits(h, word),
          hidden: !hits(h, word) && hide,
          what: h.code,
          note: [names || "nobody named yet", waiting ? `${plural(waiting, "ask", "asks")} waiting` : ""].filter(Boolean).join(" · "),
          mark: "pencil",
        });
      });
      return `<div class="run" role="group" aria-labelledby="run-${mark}"${missed && hide ? " hidden" : ""}>${head}${rows(items, "")}</div>`;
    })
    .join("");
}

// ───────────────────────────── a family ─────────────────────────────

/** A field edited where it is: its own path, written when it loses focus (see the enclosing `data-write-on="blur"` form). */
function field(path: string, name: string, value: string, label: string, placeholder = "", type = "text"): string {
  return `<input class="field"${write("board", "replace", path)} name="${esc(name)}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" aria-label="${esc(label)}" autocomplete="off">`;
}

/** A form that adds one thing by its name, in place, at the foot of what it adds to. */
const addInPlace = (path: string, noun: string): string =>
  `<form class="pair add-here"${write("board", "add", path)}><input class="field" name="name" placeholder="${esc(`A new ${noun}`)}" aria-label="${esc(`A new ${noun}'s name`)}" autocomplete="off" required>${tool(`Add ${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`, { icon: "plus", kind: "add", write: "", submit: true })}</form>`;

const chaseLink = (h: HouseholdDocument): string =>
  `<a class="tool quiet" href="mailto:${esc(h.email)}?subject=${encodeURIComponent("Just checking in")}">${icon("mail")}Chase them</a>`;

/** What the family says, as the couple read it: the same bubble as the household's own, not theirs to touch. */
function familyBubble(h: HouseholdDocument): string {
  const words = h.message ?? "";
  return `<div class="bubble theirs${h.answer ? " answered" : ""}">${faceMark(h.answer)}<div class="bubble-words${words ? "" : " empty"}">${esc(words || (h.answer ? `${answerSays(h.answer)}.` : "No answer yet."))}</div></div>`;
}

/** A guest on a family's invitation: their name (`said`: the family's surname once), their choices, whether they are coming, and
 * taking them off, which asks first. Sent alone when it alone changed. */
const guestLine = (v: BoardView, h: HouseholdDocument, g: HouseholdDocument["guests"][number], said: string): string =>
  part(
    `guest-${g.id}`,
    join(
      `<div class="line" id="guest-${g.id}"><span class="words"><span class="what">${esc(said)}</span><span class="note">${esc(choicesLine(g, v.b.courses))}</span></span>`,
      answerWord(g.coming === null ? "none" : isComing(g) ? "yes" : "no", g.coming === null ? "not said" : isComing(g) ? "coming" : "not coming"),
      tool(`Take ${g.name} off`, { icon: "trash", kind: "danger", iconOnly: true, write: open_(v, "confirm", `households/${h.id}/guests/${g.id}`) }),
      `</div>`,
    ),
  );

/** Someone a family asked for and who is not a guest: waiting for the couple's yes or no, on its line -- the one decision it is for -- or refused. */
function askLine(h: HouseholdDocument, a: HouseholdDocument["asks"][number], said: string): string {
  const reply =
    a.reply === "no" ? answerWord("no", "no")
    : choice(`${a.name}, asked for`, [
        { text: "Yes", on: false, write: write("board", "replace", `/households/${h.id}/asks/${a.id}/reply`, "yes"), kind: "yes" },
        { text: "No", on: false, write: write("board", "replace", `/households/${h.id}/asks/${a.id}/reply`, "no"), kind: "no" },
      ]);
  return `<div class="line" id="ask-${a.id}"><span class="words"><span class="what">${esc(said)}</span></span>${reply}</div>`;
}

/** A family's drawer, under its code: what they say, their guests, whoever they asked for, and their invitation -- the email, the
 * plus-ones, the way to chase them. In each list a surname the family shares is said once. */
function familySheet(v: BoardView): string {
  const id = over(v.session.ui).family;
  const h = id === undefined ? undefined : v.b.households.find((x) => x.id === id);
  if (!h) return "";
  const asked = h.asks.filter((a) => a.reply !== "yes");
  const guests = runNames(h.guests.map((g) => g.name), h.code);
  const asks = runNames(asked.map((a) => a.name), h.code);
  const body = join(
    familyBubble(h),
    `<h3 class="cap">Guests</h3>`,
    h.guests.length ? `<div class="lines">${h.guests.map((g, i) => guestLine(v, h, g, guests[i]!)).join("")}</div>` : `<p class="note">Nobody named yet.</p>`,
    addInPlace(`/households/${h.id}/guests/-`, "guest"),
    asked.length > 0 && `<h3 class="cap">Asked for</h3><div class="lines">${asked.map((a, i) => askLine(h, a, asks[i]!)).join("")}</div>`,
    `<h3 class="cap">The invitation</h3>`,
    `<form data-write-on="blur"><div class="props">`,
    prop("Email", field(`/households/${h.id}/email`, "email", h.email, "Their email", "", "email")),
    prop("Plus-ones", field(`/households/${h.id}/plus_ones`, "plus_ones", String(h.plus_ones), "Plus-ones they may name", "0", "number")),
    `</div></form>`,
    `<div class="drawer-foot">${chaseLink(h)}</div>`,
  );
  return drawer("family-drawer", h.code, body, close(v), "family-drawer");
}

/** The modal asking to take a guest off a family's invitation, named for them; cancelling goes back to the family's drawer. */
function confirmTakeOff(v: BoardView): string {
  const [what, hid, sub, gid] = (over(v.session.ui).confirm ?? "").split("/");
  const h = what === "households" && sub === "guests" ? v.b.households.find((x) => String(x.id) === hid) : undefined;
  const g = h?.guests.find((x) => String(x.id) === gid);
  if (!h || !g) return "";
  return confirmModal(g.name, `Take them off the ${h.code} invitation?`, write("board", "remove", `/households/${h.id}/guests/${g.id}`), open_(v, "family", h.id), "Take off");
}

// ───────────────────────────── the welcome ─────────────────────────────

/** A picture for the welcome, a gift or a place: the one applet, since choosing a file and sending it is the browser's job. It writes the kept picture's key at its path. */
export const pictureField = (path: string, current: string | null): string =>
  `<div data-applet="picture-field"${appletWrites(["board", "replace", path])} data-props="${esc(JSON.stringify({ doc: "board", path, current }))}"></div>`;

/** The welcome's drawer: every property it carries, each its own path, written on blur. */
function welcomeSheet(v: BoardView): string {
  if (!over(v.session.ui).answering) return "";
  const { b } = v;
  const body = join(
    `<form data-write-on="blur"><div class="props">`,
    prop("Names", `<div class="pair">${field("/name1", "name1", b.name1, "The first name", "one name")}<span class="amp">&amp;</span>${field("/name2", "name2", b.name2, "The second name", "the other")}</div>`),
    prop("The day", field("/day", "day", b.day, "The day", "2027-04-02")),
    prop("The place", field("/venue", "venue", b.venue ?? "", "The place", "where")),
    prop("Answers by", field("/deadline", "deadline", b.deadline ?? "", "Answers by", "2027-02-01")),
    prop("Your words", `<textarea name="message"${write("board", "replace", "/message")} rows="3" placeholder="Your words on the welcome" aria-label="Your words on the welcome">${esc(b.message ?? "")}</textarea>`),
    `</div></form>`,
    `<div class="props">${prop("Picture", join(b.picture_key && `<div class="drawer-pic">${picture(b.picture_key, "")}</div>`, pictureField("/picture_key", b.picture_key)))}</div>`,
  );
  return drawer("welcome-drawer", "Our welcome", body, close(v), "welcome-drawer");
}

// ───────────────────────────── the lists they keep ─────────────────────────────

/** A list the couple keep, in a drawer: a row each, ✎ its own drawer; a new one named at the foot, in place. */
function listSheet(v: BoardView): string {
  const table = over(v.session.ui).drawer;
  if (!table || !isKeepTable(table)) return "";
  const { b } = v;
  const { noun, label } = KEEP[table];
  const openRow = (id: number) => open_(v, "keep", `${table}/${id}`);
  let body: string;
  if (table === "events") body = timetableRows(b.events, { open: openRow });
  else if (table === "places") body = placeRows(b.places, { open: openRow });
  else if (table === "courses") {
    body = rows(b.courses.map((c) => row({ id: `course-${c.id}`, tap: openRow(c.id), what: c.name, note: `${plural(c.dishes.length, "dish", "dishes")} · ${plural(c.drinks.length, "drink", "drinks")}`, mark: "pencil" })), "No courses yet.");
  } else {
    body = rows(
      b.gifts.map((g) =>
        row({
          id: `gift-${g.id}`,
          tap: openRow(g.id),
          lead: g.picture_key ? picture(g.picture_key, "") : undefined,
          what: g.name,
          note: g.description,
          state: `<span>${g.shared ? "shared · " : ""}${g.claimants.length ? `claimed by ${esc(g.claimants.join(", "))}` : "unclaimed"}</span>`,
          mark: "pencil",
        }),
      ),
      "No gifts yet.",
    );
  }
  return drawer(`${table}-drawer`, label, join(body, addInPlace(`/${table}/-`, noun)), close(v), "list-drawer");
}

/** The modal asking to confirm a removal -- a modal is new or delete and nothing else -- named for what it removes;
 * cancelling goes back to the row's drawer. */
function confirmRemove(v: BoardView): string {
  const confirm = over(v.session.ui).confirm ?? "";
  const [table = "", idText] = confirm.split("/");
  if (!isKeepTable(table)) return "";
  const found = (v.b[table] as { id: number; name: string }[]).find((r) => r.id === Number(idText));
  if (!found) return "";
  return confirmModal(found.name, "Remove it from the list?", write("board", "remove", `/${table}/${found.id}`), open_(v, "keep", confirm));
}

/** A row's drawer: its properties, each a field; a course's dishes and drinks; its place in the order; Remove at the foot. Its × goes back to its list. */
function keepSheet(v: BoardView): string {
  const kept = keptIn(v);
  if (!kept) return "";
  const { table, id } = kept;
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
    extra = join(
      `<h3 class="cap">Dishes</h3><form data-write-on="blur"><div class="props">${dishRows.join("")}</div></form>${addInPlace(`${at}/dishes/-`, "dish")}`,
      `<h3 class="cap">Drinks</h3><form data-write-on="blur"><div class="props">${drinkRows.join("")}</div></form>${addInPlace(`${at}/drinks/-`, "drink")}`,
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
  // removing asks in a modal -- the drawer only opens it; `confirmRemove` does the write
  const remove = `<div class="drawer-foot">${tool(`Remove this ${noun}`, { icon: "trash", kind: "danger", write: open_(v, "confirm", at.slice(1)) })}</div>`;
  const body = join(`<form data-write-on="blur"><div class="props">${props.join("")}${order}</div></form>`, extra, remove);
  return drawer("keep-drawer", found.name, body, open_(v, table), "keep-drawer");
}
