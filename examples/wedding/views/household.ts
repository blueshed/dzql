// A household's pages: their box -- the answer in place as a speech bubble, the guests as the family
// photo (the big compartment), asks, gifts, the day, where to stay, everyone -- and the collections
// beneath, each › from its compartment; and the drawers: a guest's (dress the figure, choose the
// meal), a gift's (claim it), the answer's. Which page and which drawer is the session's word.

import type { HouseholdDocument } from "../documents/household";
import type { SessionDocument } from "../documents/session";
import * as weddingDoc from "../documents/wedding";
import type { Course, Gift, Wedding } from "../documents/wedding";
import { boxPage, cell, collectionPage, leaveTool, readingSwitch, sheet, tool, undoTool, type Crumb } from "./bento";
import type { DressProps } from "../applets/dress";
import type { MenuProps } from "../applets/menu";
import { esc, join, nav, write } from "./html";
import { icon } from "./icons";
import { familiesPhoto, familyEntries, photoApplet, type Family, type PhotoEntry } from "./photo";
import {
  answerSays,
  answerWord,
  choicesLine,
  comingPills,
  coupleName,
  eventsSummary,
  faceMark,
  firstNameOf,
  formatDay,
  frame,
  isGuestOut,
  pencil,
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

export function householdPages(v: HouseholdView): string {
  const trail: Crumb[] = [{ label: coupleName(v.w) }, { label: v.h.code, page: "" }];
  const [head, second] = (v.session.ui.page ?? "").split("/");
  const page =
    head === "asks" ? asksCollection(v, trail)
    : head === "gifts" ? giftsCollection(v, trail)
    : head === "day" ? collectionPage([...trail, { label: "The day" }], { body: timetableRows(v.events), note: `${formatDay(v.w.day)}${v.w.venue ? ` · ${v.w.venue}` : ""}`, foot: [undoTool(), leaveTool()] })
    : head === "stay" ? collectionPage([...trail, { label: "Where to stay" }], { body: placeRows(v.places), foot: [undoTool(), leaveTool()] })
    : head === "everyone" ? everyonePage(v, trail, second ?? null)
    : householdBox(v, trail);
  return frame(false, join(page, guestSheet(v), giftSheet(v), answerSheet(v)));
}

// ───────────────────────────── the box ─────────────────────────────

/** What the household says, in the photo: the chosen face and the words, and a pencil that opens the answer's drawer, where all three are whole. */
function speechBubble(h: HouseholdDocument): string {
  const words = h.message ?? "";
  return join(
    `<div class="bubble ours${h.answer ? " answered" : ""}">`,
    faceMark(h.answer),
    `<div class="bubble-words${words ? "" : " empty"}">${esc(words || (h.answer ? `${answerSays(h.answer)}.` : "Are you coming?"))}</div>`,
    `<button class="pencil-btn" type="button" aria-label="Our answer"${write("session", "replace", "/answering", "1")}>${icon("pencil", 18)}</button>`,
    "</div>",
  );
}

function householdBox(v: HouseholdView, trail: Crumb[]): string {
  const { h, gifts, photo } = v;
  const waiting = h.asks.filter((a) => a.reply === null).length;
  const inPhoto = photo.filter((r) => weddingDoc.inPhoto(r) !== null).length;
  const openGifts = gifts.filter((g) => g.shared || g.taken === 0).length;
  const named = h.guests.filter((g) => g.named_by === "household").length;
  const plusOne =
    named < h.plus_ones &&
    `<form class="tool-form"${write("household", "add", "/guests/-")}><input class="field" name="name" placeholder="Their name" aria-label="Our plus-one's name" autocomplete="off" required><button type="submit" class="tool add">${icon("plus")}Name our plus-one</button></form>`;
  return boxPage(
    trail,
    [speechBubble(h)],
    [
      // the guests, whole: read as the photo or the list, a row's coming on the row, ✎ the drawer; no page beneath
      cell({ name: "guests", mark: "users", count: h.guests.length, big: true, tools: h.guests.length ? readingSwitch("guests", reading(v, "guests"), ["photo", "list"]) : undefined, body: guestsBody(v) }),
      cell({ name: "asks", mark: "question", count: h.asks.length, summary: waiting ? `${waiting} waiting` : h.asks.length ? "all answered" : "ask to bring someone", page: "asks" }),
      cell({ name: "gifts", mark: "gift", count: gifts.length, summary: `${h.claims.length ? `${h.claims.length} claimed by us · ` : ""}${openGifts} open`, page: "gifts" }),
      cell({ name: "the day", mark: "calendar", summary: eventsSummary(v.events), page: "day" }),
      cell({ name: "where to stay", mark: "bed", summary: placesSummary(v.places), page: "stay" }),
      cell({ name: "everyone", mark: "camera", summary: `${inPhoto} in the photo`, page: "everyone" }),
    ],
    [plusOne || "", undoTool(), leaveTool()],
  );
}

const reading = (v: HouseholdView, key: string, fallback = "photo"): string => v.session.ui.reading?.[key] ?? fallback;

/** The household's guests in the current reading, the photo or the list, whole in the box's compartment. */
function guestsBody(v: HouseholdView): string {
  const { h } = v;
  if (reading(v, "guests") === "photo") {
    return join(
      h.guests.length ? photoApplet(familyEntries(h), "your household, as minifigures") : `<p class="note">Nobody is named on your invitation yet.</p>`,
      h.guests.length > 0 && `<p class="note">Tap anyone to dress them and choose their meal.</p>`,
    );
  }
  const rows = h.guests.map((g) =>
    join(
      `<div class="row-line guest"><div>`,
      `<button class="name-link" type="button"${write("session", "replace", "/focus", g.id)}>${esc(g.name)}${pencil()}</button>`,
      `<p class="note">${esc(choicesLine(g, v.courses))}</p></div>`,
      comingPills((value) => write("household", "replace", `/guests/${g.id}/coming`, value), g.coming, !v.open),
      "</div>",
    ),
  );
  const ghosts = h.asks
    .filter((a) => a.reply === null)
    .map((a) => `<div class="row-line guest ghost-row"><div><span class="what">${esc(a.name)}</span><p class="note">a waiting ask — not a guest yet</p></div><span class="taken">waiting</span></div>`);
  return `<div class="rows">${rows.join("")}${ghosts.join("")}</div>`;
}

// ───────────────────────────── the collections ─────────────────────────────

function asksCollection(v: HouseholdView, trail: Crumb[]): string {
  const word = (reply: "yes" | "no" | null) => (reply === "yes" ? "yes — a guest now" : reply === "no" ? "no" : "waiting");
  const mark = (reply: "yes" | "no" | null) => (reply === "yes" ? "yes" : reply === "no" ? "no" : "none");
  const body = v.h.asks.length
    ? `<div class="rows">${v.h.asks.map((a) => `<div class="row-line stay"><span class="what">${esc(a.name)}</span>${answerWord(mark(a.reply), word(a.reply))}</div>`).join("")}</div>`
    : `<p class="note">Nobody asked for yet. An ask is answered by the couple; a yes makes a guest.</p>`;
  return collectionPage([...trail, { label: "Asks" }], {
    tools: [`<form class="tool-form"${write("household", "add", "/asks/-")}><input class="field" name="name" placeholder="Their name" aria-label="Who to bring" autocomplete="off" required><button type="submit" class="tool add">${icon("plus")}Ask to bring someone</button></form>`],
    body,
    foot: [undoTool(), leaveTool()],
  });
}

/** What a gift is to this household: claimed by us, taken by another, open, or shared and how many have. */
function giftState(g: Gift, mine: boolean): { word: string; cls: string } {
  if (mine) return { word: "claimed by us", cls: "yes" };
  if (!g.shared && g.taken) return { word: "taken", cls: "no" };
  if (g.shared) return { word: g.taken ? `${plural(g.taken, "household has", "households have")} claimed this · anyone may` : "open · anyone may", cls: "none" };
  return { word: "open", cls: "none" };
}

function giftsCollection(v: HouseholdView, trail: Crumb[]): string {
  const rows = v.gifts.map((g) => {
    const st = giftState(g, v.h.claims.includes(g.id));
    return join(
      `<div class="row-line gift tap${g.picture_key ? " pic" : ""}" role="button" tabindex="0"${write("session", "replace", "/gift", g.id)}>`,
      g.picture_key && picture(g.picture_key, g.name),
      `<div><span class="what">${esc(g.name)}</span><p class="note state-${st.cls}">${esc(st.word)}</p></div>`,
      pencil(),
      "</div>",
    );
  });
  return collectionPage([...trail, { label: "Gifts" }], {
    body: `<div class="rows">${rows.join("")}</div>`,
    note: v.gifts.length ? null : "No gifts on the list yet.",
    foot: [undoTool(), leaveTool()],
  });
}

/** Everyone in the photo: the wedding's guests whose households said yes, a maybe as a ghost; beyond EVERYONE_UP_TO, one figure per family, › into a family. */
function everyonePage(v: HouseholdView, trail: Crumb[], familyKey: string | null): string {
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
  const families = [...byFamily.values()];
  const total = families.reduce((n, f) => n + f.members.length, 0);
  const open = familyKey && byFamily.has(familyKey) ? familyKey : null;
  const { entries, label, level, shown } = familiesPhoto(families, open);
  const here: Crumb[] = [...trail, open ? { label: "Everyone", page: "everyone" } : { label: "Everyone" }];
  if (open) here.push({ label: "One family" });
  return collectionPage(here, {
    body: total ? photoApplet(entries, label, { reveal: v.names, framed: true }) : `<p class="note">Nobody yet.</p>`,
    note:
      level === "families" ? `${total} in the photo, in ${shown} families. Tap a family to see them. Nobody knows whose is whose until the day.`
      : level === "family" ? `One family, ${shown} of them.`
      : `${total} in the photo: everyone whose household has said yes; a maybe stands as a ghost. ${v.names ? "It is the day: the names have come down." : "Nobody knows whose is whose until the day."}`,
    foot: [undoTool(), leaveTool()],
  });
}

// ───────────────────────────── the drawers ─────────────────────────────

/** The guest's drawer: the head with the name, the dressing sheet, the hint, and their choices beneath -- the two applets, given what they need. */
function guestSheet(v: HouseholdView): string {
  const focus = v.session.ui.focus;
  const g = focus === undefined ? undefined : v.h.guests.find((x) => x.id === focus);
  if (!g) return "";
  const firstName = firstNameOf(g.name);
  const out = isGuestOut(g, v.h);
  const dress: DressProps = { guestId: g.id, spec: specOf(g.minifigure), firstName, out };
  const menu: MenuProps = {
    guestId: g.id,
    firstName,
    courses: v.courses.map((c) => ({ id: c.id, name: c.name, dishes: c.dishes.map(({ id, name, dietary }) => ({ id, name, dietary })), drinks: c.drinks.map(({ id, name }) => ({ id, name })) })),
    choices: g.choices,
    out,
    locked: !v.open,
  };
  const body = join(
    `<div class="figure-box"><div data-applet="dress" data-props="${esc(JSON.stringify(dress))}"></div></div>`,
    `<p class="hint">Touch ${esc(firstName)}’s hair, face, top, arms or legs to change them.</p>`,
    `<div data-applet="menu" data-props="${esc(JSON.stringify(menu))}"></div>`,
  );
  return sheet("guest-sheet", g.name, body, write("session", "remove", "/focus"), "guest-sheet");
}

/** The gift whole -- the picture, the words, where to buy, how many have claimed it -- and the one field this household may change: claimed by us. */
function giftSheet(v: HouseholdView): string {
  const g = v.gifts.find((x) => x.id === v.session.ui.gift);
  if (!g) return "";
  const mine = v.h.claims.includes(g.id);
  const st = giftState(g, mine);
  const mayClaim = mine || g.shared || g.taken === 0;
  const claim = mayClaim
    ? join(
        `<div class="coming-pills" role="radiogroup" aria-label="Claimed by us">`,
        `<button class="pill pill-sm yes${mine ? " on" : ""}" type="button" role="radio" aria-checked="${mine}"${write("household", "add", "/claims/-", g.id)}>Yes</button>`,
        `<button class="pill pill-sm no${mine ? "" : " on"}" type="button" role="radio" aria-checked="${!mine}"${write("household", "remove", `/claims/${g.id}`)}>No</button>`,
        "</div>",
      )
    : `<span class="taken">taken by another household</span>`;
  const body = join(
    `<div class="gift-whole">`,
    g.picture_key && `<div class="gift-pic">${picture(g.picture_key, g.name)}</div>`,
    g.description && `<p class="gift-words">${esc(g.description)}</p>`,
    g.link && `<p class="note"><a href="${esc(g.link)}" target="_blank" rel="noopener noreferrer">Where to find it</a></p>`,
    `<p class="note state-${st.cls}">${esc(st.word)}</p></div>`,
    `<div class="rows"><div class="row-line stay"><span class="what">Claimed by us</span>${claim}</div></div>`,
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
    `<h3 class="cap">Our words</h3>`,
    `<form class="words-form"${write("household", "replace", "/message")}><textarea class="message-box" name="message" rows="3" placeholder="Say something to the couple" aria-label="Our words">${esc(h.message ?? "")}</textarea>`,
    `<div class="tools">${tool("Save our words", { write: "", kind: undefined })}</div></form>`,
  );
  return sheet("answer-sheet", "Our answer", body, write("session", "remove", "/answering"), "answer-sheet");
}
