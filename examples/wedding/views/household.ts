// A household's pages: their box -- the answer in place, a thing with ✎; the guests as the family
// photo, the big compartment; asks, gifts, the day, where to stay, everyone -- each compartment
// growing into the window (rule 7); and the drawers: a guest's (dress the figure, coming, the
// meal), a gift's (claim it), the answer's. Which page and which drawer is the session's word.

import type { Guest, HouseholdDocument } from "../documents/household";
import type { SessionDocument } from "../documents/session";
import * as weddingDoc from "../documents/wedding";
import type { Course, Gift, Wedding } from "../documents/wedding";
import { addModal, addTool, boxPage, cell, choice, findControl, prop, readingSwitch, row, rows, sheet, tool, type Crumb, type OpenOptions } from "./bento";
import type { DressProps } from "../applets/dress";
import type { MenuProps } from "../applets/menu";
import { esc, join, nav, write } from "./html";
import { icon } from "./icons";
import { familiesPhoto, familyEntries, photoMount, type Family, type PhotoEntry } from "./photo";
import {
  answerSays,
  answerWord,
  choicesLine,
  coupleName,
  eventsSummary,
  faceMark,
  firstNameOf,
  formatDay,
  frame,
  inertWhile,
  isComing,
  isGuestOut,
  matches,
  picture,
  placeRows,
  placesSummary,
  plural,
  specOf,
  timetableRows,
} from "./shared";

/** Everything a household's pages read: their own document, the wedding, the lists, and the photo. */
export type HouseholdView = {
  session: SessionDocument;
  h: HouseholdDocument;
  w: Wedding;
  courses: Course[];
  gifts: Gift[];
  events: weddingDoc.Event[];
  places: weddingDoc.Place[];
  photo: weddingDoc.PhotoRow[];
  /** May the household still answer and choose? */
  open: boolean;
  /** Does the photo carry names? */
  names: boolean;
};

/** Which compartment the page names, grown into the window (rule 7), and the crumbs it adds to the trail. */
function openFor(v: HouseholdView, head: string, second: string | undefined): { open?: OpenOptions; crumbs: Crumb[] } {
  if (head === "guests") return { open: guestsOpen(v), crumbs: [{ label: "Guests" }] };
  if (head === "asks") return { open: asksOpen(v), crumbs: [{ label: "Asks" }] };
  if (head === "gifts") return { open: giftsOpen(v), crumbs: [{ label: "Gifts" }] };
  if (head === "day") return { open: { key: "day", body: timetableRows(v.events), note: `${formatDay(v.w.day)}${v.w.venue ? ` · ${v.w.venue}` : ""}` }, crumbs: [{ label: "The day" }] };
  if (head === "stay") return { open: { key: "stay", body: placeRows(v.places) }, crumbs: [{ label: "Where to stay" }] };
  if (head === "everyone") return everyoneOpen(v, second ?? null);
  return { crumbs: [] };
}

export function householdPages(v: HouseholdView): string {
  const ui = v.session.ui;
  const trail: Crumb[] = [{ label: coupleName(v.w) }, { label: v.h.code, back: nav("") }];
  const [head, second] = (ui.page ?? "").split("/");
  const { open, crumbs: openCrumbs } = openFor(v, head, second);
  const deadline = v.open && v.w.deadline ? `<p class="note">Answers by ${esc(formatDay(v.w.deadline))}.</p>` : "";
  const page = boxPage(open ? [...trail, ...openCrumbs] : trail, [speechBubble(v.h, !!ui.answering), deadline], boxCells(v), open);
  const modalOpen = !!ui.new;
  const locked = modalOpen || ui.focus !== undefined || ui.gift !== undefined || !!ui.answering;
  const modal =
    ui.new === "guests" ? addModal("Name our plus-one", [{ name: "name", label: "Their name" }], write("household", "add", "/guests/-"))
    : ui.new === "asks" ? addModal("Ask to bring someone", [{ name: "name", label: "Who to ask for" }], write("household", "add", "/asks/-"), "Ask")
    : "";
  const body = join(inertWhile(modalOpen, join(page, guestSheet(v), giftSheet(v), answerSheet(v))), modal);
  return frame(false, body, ui.page ?? "", locked);
}

// ───────────────────────────── the box ─────────────────────────────

/** What the household says, in the photo: the chosen face and the words. A thing (rule 15): ✎
 * opens the answer's drawer, and it is lit while the drawer is open. */
function speechBubble(h: HouseholdDocument, open: boolean): string {
  const words = h.message ?? "";
  return join(
    `<div class="bubble ours thing${h.answer ? " answered" : ""}" role="button" tabindex="0" aria-pressed="${open}"${write("session", "replace", "/answering", "1")}>`,
    faceMark(h.answer),
    `<div class="bubble-words${words ? "" : " empty"}">${esc(words || (h.answer ? `${answerSays(h.answer)}.` : "Are you coming?"))}</div>`,
    `<span class="pencil" aria-hidden="true">${icon("pencil", 16)}</span>`,
    "</div>",
  );
}

/** The box's own compartments, in their place in the tray -- all six, whether the box is shown
 * whole or one of them is grown into the window. */
function boxCells(v: HouseholdView) {
  const { h, gifts, photo } = v;
  const waiting = h.asks.filter((a) => a.reply === null).length;
  const inPhoto = photo.filter((r) => weddingDoc.inPhoto(r) !== null).length;
  const openGifts = gifts.filter((g) => g.shared || g.taken === 0).length;
  const coming = h.guests.filter(isComing).length;
  return [
    // the family photo is the small reading of the guests, still (no taps) until the compartment opens
    cell({ name: "guests", mark: "users", count: h.guests.length, big: true, opens: nav("guests"), summary: h.guests.length ? `${coming} coming` : "nobody named yet", body: h.guests.length ? `<div class="mini photo">${familyMini(v)}</div>` : undefined }),
    cell({ name: "asks", mark: "question", count: h.asks.length, summary: waiting ? `${waiting} waiting` : h.asks.length ? "all answered" : "ask to bring someone", opens: nav("asks") }),
    cell({ name: "gifts", mark: "gift", count: gifts.length, summary: `${h.claims.length ? `${h.claims.length} claimed by us · ` : ""}${openGifts} open`, opens: nav("gifts") }),
    cell({ name: "the day", mark: "calendar", summary: eventsSummary(v.events), opens: nav("day"), key: "day" }),
    cell({ name: "where to stay", mark: "bed", summary: placesSummary(v.places), opens: nav("stay"), key: "stay" }),
    cell({ name: "everyone", mark: "camera", summary: `${inPhoto} in the photo`, opens: nav("everyone") }),
  ];
}

export const reading = (v: HouseholdView, key: string, fallback = "photo"): string => v.session.ui.reading?.[key] ?? fallback;

/** The family photo as the box's small reading: still, no taps. Replaced alone when a look changes. */
export const familyMini = (v: HouseholdView): string => photoMount("family-mini", familyEntries(v.h, false), "your household, as minifigures");

/** The family photo's mount in the window: every guest, a waiting ask as a ghost; the chosen one rings while
 * their drawer is open, and find's word (rule 17) hushes whoever it misses. Replaced alone when a look changes. */
export const familyPhoto = (v: HouseholdView): string => photoMount("family-photo", familyEntries(v.h, true, v.session.ui.focus, v.session.ui.filter?.guests), "your household, as minifigures");

/** One guest as a row: the name, their choices, whether they are coming; ✎ the drawer, lit while it is open (rule 13). */
export function guestRow(v: HouseholdView, g: Guest, word?: string, hide?: boolean): string {
  const miss = word !== undefined && !matches(g.name, word);
  const said = g.coming === null ? "not said" : isComing(g) ? "coming" : "not coming";
  return row({
    id: `guest-${g.id}`,
    tap: write("session", "replace", "/focus", g.id),
    chosen: v.session.ui.focus === g.id,
    hushed: miss,
    hidden: miss && hide,
    what: g.name,
    note: choicesLine(g, v.courses),
    state: answerWord(g.coming === null ? "none" : isComing(g) ? "yes" : "no", said),
    mark: "pencil",
  });
}

/** The guests grown into the window: the photo or the list (rule 16), the plus for a plus-one, find. */
function guestsOpen(v: HouseholdView): OpenOptions {
  const { h } = v;
  const word = v.session.ui.filter?.guests;
  const hide = v.session.ui.hide?.guests;
  const waitingAsks = h.asks.filter((a) => a.reply === null);
  const hits = (name: string) => word === undefined || matches(name, word);
  const shown = h.guests.filter((g) => hits(g.name)).length + waitingAsks.filter((a) => hits(a.name)).length;
  const find = findControl("guests", { word, hide, shown, total: h.guests.length + waitingAsks.length });
  const named = h.guests.filter((g) => g.named_by === "household").length;
  const photo = reading(v, "guests") === "photo";
  const body = photo
    ? h.guests.length ? `<div class="reading photo">${familyPhoto(v)}</div>` : `<p class="note">Nobody is named on your invitation yet.</p>`
    : rows(
        [
          ...h.guests.map((g) => guestRow(v, g, word, hide)),
          ...waitingAsks.map((a) => row({ what: a.name, note: "a waiting ask — not a guest yet", state: answerWord("none", "waiting"), hushed: !hits(a.name), hidden: !hits(a.name) && hide })),
        ],
        "Nobody is named on your invitation yet.",
      );
  return {
    key: "guests",
    reading: h.guests.length ? readingSwitch("guests", reading(v, "guests"), [["photo", "camera"], ["list", "list"]]) : undefined,
    tools: [named < h.plus_ones ? addTool("guests", "Name our plus-one") : "", h.guests.length ? find.tool : ""].filter(Boolean),
    filter: find.filter,
    body,
    note: photo && h.guests.length ? "Tap anyone to dress them and choose their meal." : null,
  };
}

// ───────────────────────────── the collections ─────────────────────────────

function asksOpen(v: HouseholdView): OpenOptions {
  const word = (reply: "yes" | "no" | null) => (reply === "yes" ? "yes — a guest now" : reply === "no" ? "no" : "waiting");
  const mark = (reply: "yes" | "no" | null) => (reply === "yes" ? "yes" : reply === "no" ? "no" : "none");
  return {
    key: "asks",
    tools: [addTool("asks", "Ask to bring someone")],
    body: rows(
      v.h.asks.map((a) => row({ id: `ask-${a.id}`, what: a.name, state: answerWord(mark(a.reply), word(a.reply)) })),
      "Nobody asked for yet. An ask is answered by the couple; a yes makes a guest.",
    ),
  };
}

/** What a gift is to this household: claimed by us, taken by another, open, or shared and how many have. */
function giftState(g: Gift, mine: boolean): { word: string; cls: string } {
  if (mine) return { word: "claimed by us", cls: "yes" };
  if (!g.shared && g.taken) return { word: "taken", cls: "no" };
  if (g.shared) return { word: g.taken ? `${plural(g.taken, "household has", "households have")} claimed this · anyone may` : "open · anyone may", cls: "none" };
  return { word: "open", cls: "none" };
}

function giftsOpen(v: HouseholdView): OpenOptions {
  const word = v.session.ui.filter?.gifts;
  const hide = v.session.ui.hide?.gifts;
  const hits = (g: Gift) => word === undefined || matches(g.name, word);
  const find = findControl("gifts", { word, hide, shown: v.gifts.filter(hits).length, total: v.gifts.length });
  const list = v.gifts.map((g) => {
    const st = giftState(g, v.h.claims.includes(g.id));
    return row({
      id: `gift-${g.id}`,
      tap: write("session", "replace", "/gift", g.id),
      chosen: v.session.ui.gift === g.id,
      hushed: !hits(g),
      hidden: !hits(g) && hide,
      lead: g.picture_key ? picture(g.picture_key, g.name) : undefined,
      what: g.name,
      note: g.description,
      state: `<span class="state-${st.cls}">${esc(st.word)}</span>`,
      mark: "pencil",
    });
  });
  return { key: "gifts", tools: v.gifts.length ? [find.tool] : [], filter: find.filter, body: rows(list, "No gifts on the list yet.") };
}

/** Everyone in the photo, as families: the wedding's guests whose households said yes, a maybe as a ghost, grouped by household. */
function everyoneFamilies(v: HouseholdView): Map<string, Family> {
  const byFamily = new Map<string, Family>();
  for (const r of v.photo) {
    const state = weddingDoc.inPhoto(r);
    if (!state) continue;
    const key = String(r.household_id);
    const entry: PhotoEntry = { key: String(r.guest_id), ghost: state === "ghost", spec: specOf(r.look, v.names ? r.name : undefined) };
    const f = byFamily.get(key) ?? { key, members: [], ghost: state === "ghost", tap: { doc: "session", op: { op: "replace", path: "/page", value: `everyone/${key}` } } };
    f.members.push(entry);
    byFamily.set(key, f);
  }
  return byFamily;
}

/** The everyone photo's mount, at whichever level the crowd and the open family put it. Replaced alone when a look changes. */
export function everyonePhoto(v: HouseholdView, familyKey: string | null): string {
  const byFamily = everyoneFamilies(v);
  const open = familyKey && byFamily.has(familyKey) ? familyKey : null;
  const { entries, label } = familiesPhoto([...byFamily.values()], open);
  return photoMount("everyone-photo", entries, label, v.names);
}

/** Everyone in the photo; beyond EVERYONE_UP_TO, one figure per family, › into a family -- still
 * the same "everyone" window (rule 7), the family it holds open is the window's own state. */
function everyoneOpen(v: HouseholdView, familyKey: string | null): { open: OpenOptions; crumbs: Crumb[] } {
  const byFamily = everyoneFamilies(v);
  const families = [...byFamily.values()];
  const total = families.reduce((n, f) => n + f.members.length, 0);
  const open = familyKey && byFamily.has(familyKey) ? familyKey : null;
  const { level, shown } = familiesPhoto(families, open);
  const crumbs: Crumb[] = open ? [{ label: "Everyone", back: nav("everyone") }, { label: "One family" }] : [{ label: "Everyone" }];
  return {
    open: {
      key: "everyone",
      body: total ? `<div class="reading photo framed">${everyonePhoto(v, familyKey)}</div>` : `<p class="note">Nobody yet.</p>`,
      note:
        level === "families" ? `${total} in the photo, in ${shown} families. Tap a family to see them. Nobody knows whose is whose until the day.`
        : level === "family" ? `One family, ${shown} of them.`
        : `${total} in the photo: everyone whose household has said yes; a maybe stands as a ghost. ${v.names ? "It is the day: the names have come down." : "Nobody knows whose is whose until the day."}`,
    },
    crumbs,
  };
}

// ───────────────────────────── the drawers ─────────────────────────────

/** The dressing applet's mount for one guest. Replaced alone when their look changes. */
export function dressMount(v: HouseholdView, g: Guest): string {
  const dress: DressProps = { guestId: g.id, spec: specOf(g.minifigure), firstName: firstNameOf(g.name), out: isGuestOut(g, v.h) };
  return `<div id="dress-${g.id}" data-applet="dress" data-props="${esc(JSON.stringify(dress))}"></div>`;
}

/** The menu applet's mount for one guest. Replaced alone when a choice changes. */
export function menuMount(v: HouseholdView, g: Guest): string {
  const menu: MenuProps = {
    guestId: g.id,
    firstName: firstNameOf(g.name),
    courses: v.courses.map((c) => ({ id: c.id, name: c.name, dishes: c.dishes.map(({ id, name, dietary }) => ({ id, name, dietary })), drinks: c.drinks.map(({ id, name }) => ({ id, name })) })),
    choices: g.choices,
    out: isGuestOut(g, v.h),
    locked: !v.open,
  };
  return `<div id="menu-${g.id}" data-applet="menu" data-props="${esc(JSON.stringify(menu))}"></div>`;
}

/** The guest's drawer: the dressing sheet, coming as one choice (rule 13, off the line), the hint, and the menu. */
function guestSheet(v: HouseholdView): string {
  const focus = v.session.ui.focus;
  const g = focus === undefined ? undefined : v.h.guests.find((x) => x.id === focus);
  if (!g) return "";
  const coming = choice(
    "Coming",
    [
      { text: "Yes", on: g.coming === 1, write: write("household", "replace", `/guests/${g.id}/coming`, "1"), kind: "yes" },
      { text: "No", on: g.coming === 0, write: write("household", "replace", `/guests/${g.id}/coming`, "0"), kind: "no" },
    ],
    !v.open,
  );
  const body = join(
    `<div class="figure-box">${dressMount(v, g)}</div>`,
    `<p class="hint">Touch ${esc(firstNameOf(g.name))}’s hair, face, top, arms or legs to change them.</p>`,
    `<div class="props">${prop("Coming", coming)}</div>`,
    menuMount(v, g),
  );
  return sheet("guest-sheet", g.name, body, write("session", "remove", "/focus"), "guest-sheet");
}

/** The gift whole -- the picture, the words, where to find it, what it is to us -- and the one thing this household may change: claimed by us. */
function giftSheet(v: HouseholdView): string {
  const g = v.gifts.find((x) => x.id === v.session.ui.gift);
  if (!g) return "";
  const mine = v.h.claims.includes(g.id);
  const st = giftState(g, mine);
  const mayClaim = mine || g.shared || g.taken === 0;
  const claim = mayClaim
    ? choice("Claimed by us", [
        { text: "Yes", on: mine, write: write("household", "add", "/claims/-", g.id), kind: "yes" },
        { text: "No", on: !mine, write: write("household", "remove", `/claims/${g.id}`), kind: "no" },
      ])
    : `<span class="note">taken by another household</span>`;
  const body = join(
    g.picture_key && `<div class="sheet-pic">${picture(g.picture_key, g.name)}</div>`,
    g.description && `<p class="words">${esc(g.description)}</p>`,
    `<div class="props">`,
    prop("It is", `<span class="state-${st.cls}">${esc(st.word)}</span>`),
    g.link && prop("Find it", `<a href="${esc(g.link)}" target="_blank" rel="noopener noreferrer">${esc(g.link.replace(/^https?:\/\//, ""))}</a>`),
    prop("Claimed by us", claim),
    "</div>",
  );
  return sheet("gift-sheet", g.name, body, write("session", "remove", "/gift"), "gift-sheet");
}

const DEFAULT_WORDS: Record<"yes" | "maybe" | "no", string> = {
  yes: "Yes! We'll be there.",
  maybe: "We hope so — we'll let you know.",
  no: "Sorry, we can't be there.",
};

/** The answer's drawer: every option whole -- a face, its colour, its sentence -- and the words beneath. */
function answerSheet(v: HouseholdView): string {
  if (!v.session.ui.answering) return "";
  const { h } = v;
  const option = (kind: "yes" | "maybe" | "no") =>
    `<button type="button" class="answer-option${h.answer === kind ? " on" : ""}" role="radio" aria-checked="${h.answer === kind}"${write("household", "replace", "/answer", kind)}${v.open ? "" : " disabled"}>${faceMark(kind, 40, true)}<span class="answer-say">${esc(DEFAULT_WORDS[kind])}</span></button>`;
  const body = join(
    v.open ? "" : `<p class="note">Answers closed on ${esc(formatDay(v.w.deadline ?? ""))}.</p>`,
    `<div class="answer-options" role="radiogroup" aria-label="Are you coming?">${option("yes")}${option("maybe")}${option("no")}</div>`,
    `<div class="props">${prop(
      "Our words",
      `<form class="words-form"${write("household", "replace", "/message")}><textarea name="message" rows="3" placeholder="Say something to the couple" aria-label="Our words">${esc(h.message ?? "")}</textarea><div class="form-foot">${tool("Save our words", { write: "", submit: true })}</div></form>`,
    )}</div>`,
  );
  return sheet("answer-sheet", "Our answer", body, write("session", "remove", "/answering"), "answer-sheet");
}
