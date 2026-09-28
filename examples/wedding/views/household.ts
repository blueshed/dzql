// A household's page: their photo, as leave's is its calendar. What they say is the bubble over it,
// a thing with ✎; their guests stand in it, and a tap on one opens their drawer -- dress them, say
// whether they are coming, choose the meal; a waiting ask stands as a ghost. The same people as a
// list, or the photo every household watches, are readings of it (rule 16), and find looks for
// someone in the first two by name (rule 17). The plus brings someone: names a plus-one while one
// is owed, asks the couple after. Gifts, the day and where to stay are what the couple tell every
// household: tools on the rail, each opening a drawer that is read, used (a gift claimed) and put
// away. Which reading and which drawer is the session's word.

import type { Guest, HouseholdDocument } from "../documents/household";
import { over, type Named, type SessionDocument } from "../documents/session";
import * as weddingDoc from "../documents/wedding";
import type { Course, Gift, Wedding } from "../documents/wedding";
import { addModal, addTool, choice, collectionPage, findControl, prop, row, rows, drawer, tool, type Crumb } from "./bento";
import type { DressProps } from "../applets/dress";
import { LOOK_FIELDS } from "../looks";
import type { MenuProps } from "../applets/menu";
import { esc, join, nav, open, write, appletWrites } from "./html";
import { part } from "../../../src/parts";
import { icon, type IconName } from "./icons";
import { familiesPhoto, familyEntries, photoMount, type Family, type PhotoEntry } from "./photo";
import { answerSays, answerWord, choicesLine, coupleName, faceMark, firstNameOf, formatDay, frame, layers, isComing, isGuestOut, matches, picture, placeRows, plural, runNames, specOf, timetableRows } from "./shared";

/** Opening something over the page this household is on -- a drawer, a modal -- and putting it away: both are going somewhere (views/html.ts). */
const open_ = (v: HouseholdView, what: string, which: string | number = ""): string => open(over(v.session.ui).path, what, which);
const close = (v: HouseholdView): string => nav(over(v.session.ui).path);

/** Everything a household's page reads: their own document, the wedding, the lists, and the photo. */
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

/** Find's word and its eye on the household's people (rule 17): by name, the photo and the list alike. */
const findOf = (v: HouseholdView): { word?: string; hide?: boolean } => ({ word: v.session.ui.filter?.guests, hide: v.session.ui.hide?.guests });

/** Whoever was asked for and is not a guest: waiting (a ghost in the photo), or refused (in the list alone). */
const askedFor = (v: HouseholdView, refused: boolean) => v.h.asks.filter((a) => a.reply === null || (refused && a.reply === "no"));

/** How the page is read: the household's photo (""), the same people as a list, or everyone's photo -- with one family open in it. */
type Reading = { as: "us" | "list" | "everyone"; family: string | null };

function readingOf(path: string): Reading {
  const [head, family = null] = path.split("/");
  return { as: head === "list" ? "list" : head === "everyone" ? "everyone" : "us", family };
}

const READINGS: [text: string, as: Reading["as"], path: string, mark: IconName][] = [
  ["Us", "us", "", "users"],
  ["Everyone", "everyone", "everyone", "camera"],
  ["List", "list", "list", "list"],
];

/** The information the couple give every household, each a tool on the rail and a drawer. */
const INFO: [text: string, what: Named, mark: IconName][] = [
  ["Gifts", "gifts", "gift"],
  ["The day", "day", "calendar"],
  ["Where to stay", "stay", "bed"],
];

export function householdPage(v: HouseholdView): string {
  const ui = v.session.ui;
  const at = over(ui);
  const read = readingOf(at.path);
  const everyone = read.as === "everyone" ? everyoneReading(v, read.family) : undefined;
  const trail: Crumb[] = [{ label: coupleName(v.w) }, ...(everyone?.crumbs ?? [{ label: v.h.code }])];

  const reading = `<div class="stack" role="radiogroup" aria-label="Read as">${READINGS.map(([text, as, path, mark]) => `<button type="button" class="tool" role="radio" aria-checked="${read.as === as}" aria-label="${text}"${nav(path)}>${icon(mark)}<span class="sr-only">${text}</span></button>`).join("")}</div>`;
  const owed = v.h.guests.filter((g) => g.named_by === "household").length < v.h.plus_ones;
  // find, on the people this reading shows: everyone's photo is nameless until the day
  const { word, hide } = findOf(v);
  const people = [...v.h.guests, ...askedFor(v, read.as === "list")].map((p) => p.name);
  const find = read.as !== "everyone" && people.length ? findControl("guests", { word, hide, shown: people.filter((n) => matches(n, word)).length, total: people.length }) : undefined;
  const tools = [
    find?.tool ?? "",
    ...INFO.map(([text, what, mark]) => tool(text, { icon: mark, iconOnly: true, expanded: at.drawer === what, write: at.drawer === what ? close(v) : open_(v, what) })),
    addTool(open_(v, "new", owed ? "guests" : "asks"), owed ? "Name our plus-one" : "Ask to bring someone"),
  ].filter(Boolean);
  const said = v.open && v.w.deadline ? `<p class="note">Answers by ${esc(formatDay(v.w.deadline))}.</p>` : "";
  const body = join(
    `<div class="photo-page">`,
    speechBubble(v.h, !!at.answering, open_(v, "answer")),
    said,
    read.as === "list" ? listReading(v) : read.as === "everyone" ? everyone!.body : usReading(v),
    `</div>`,
  );
  const page = collectionPage(trail, { key: "photo", reading, tools, filter: find?.filter, body });

  const modal =
    at.new === "guests" ? addModal("Name our plus-one", [{ name: "name", label: "Their name" }], write("household", "add", "/guests/-"), close(v))
    : at.new === "asks" ? addModal("Ask to bring someone", [{ name: "name", label: "Who to ask for" }], write("household", "add", "/asks/-"), close(v), "Ask")
    : "";
  const drawers = join(guestSheet(v), answerSheet(v), giftsSheet(v), daySheet(v), staySheet(v));
  const locked = !!modal || !!drawers;
  return frame(false, layers(page, drawers, modal), ui.page ?? "", locked);
}

// ───────────────────────────── the page ─────────────────────────────

/** What the household says, over the photo: the chosen face and the words. A thing (rule 15), and a
 * button: ✎ opens the answer's drawer, and it is lit while the drawer is open. */
function speechBubble(h: HouseholdDocument, open: boolean, answer: string): string {
  const words = h.message ?? "";
  return join(
    `<button type="button" class="bubble ours thing${h.answer ? " answered" : ""}" aria-expanded="${open}"${answer}>`,
    faceMark(h.answer),
    `<span class="bubble-words${words ? "" : " empty"}">${esc(words || (h.answer ? `${answerSays(h.answer)}.` : "Are you coming?"))}</span>`,
    `<span class="pencil" aria-hidden="true">${icon("pencil", 16)}</span>`,
    "</button>",
  );
}

/** The household's photo's mount: every guest, a waiting ask as a ghost; the chosen one rings while
 * their drawer is open. Replaced alone when a look changes. */
export const familyPhoto = (v: HouseholdView): string => photoMount("family-photo", familyEntries(v.h, over(v.session.ui), findOf(v)), "your household, as minifigures");

/** The page read as the household's photo: the page itself. */
function usReading(v: HouseholdView): string {
  if (!v.h.guests.length) return `<p class="note">Nobody is named on your invitation yet.</p>`;
  return `<div class="reading photo">${familyPhoto(v)}</div><p class="note">Tap anyone to dress them and choose their meal.</p>`;
}

/** One guest as a row: the name (`said`: as the list says it, the family's surname once), their choices, whether they are coming;
 * ✎ the drawer, lit while it is open (rule 13). Find dims it, or with the eye hides it, when the word misses. */
function guestRow(v: HouseholdView, g: Guest, said: string): string {
  const { word, hide } = findOf(v);
  const miss = !matches(g.name, word);
  return row({
    id: `guest-${g.id}`,
    tap: open_(v, "guest", g.id),
    chosen: over(v.session.ui).focus === g.id,
    hushed: miss,
    hidden: miss && hide,
    what: said,
    note: choicesLine(g, v.courses),
    state: answerWord(g.coming === null ? "none" : isComing(g) ? "yes" : "no", g.coming === null ? "not said" : isComing(g) ? "coming" : "not coming"),
    mark: "pencil",
  });
}

/** The same people as a list: the guests, then whoever was asked for and is not a guest -- waiting, or refused. One family, under
 * its own name in the trail, so a surname they share is said once. */
function listReading(v: HouseholdView): string {
  const { word, hide } = findOf(v);
  const asked = askedFor(v, true);
  const said = runNames([...v.h.guests, ...asked].map((p) => p.name), v.h.code);
  return rows(
    [
      ...v.h.guests.map((g, i) => guestRow(v, g, said[i]!)),
      ...asked.map((a, i) => {
        const miss = !matches(a.name, word);
        return row({ id: `ask-${a.id}`, what: said[v.h.guests.length + i]!, hushed: miss, hidden: miss && hide, state: a.reply === "no" ? answerWord("no", "the couple said no") : answerWord("none", "asked for") });
      }),
    ],
    "Nobody is named on your invitation yet.",
  );
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

/** The page read as everyone's photo; beyond EVERYONE_UP_TO, one figure per family, and a tap
 * opens a family in it -- a crumb longer, the way back to everyone before it. */
function everyoneReading(v: HouseholdView, familyKey: string | null): { body: string; crumbs: Crumb[] } {
  const byFamily = everyoneFamilies(v);
  const families = [...byFamily.values()];
  const total = families.reduce((n, f) => n + f.members.length, 0);
  const open = familyKey && byFamily.has(familyKey) ? familyKey : null;
  const { level, shown } = familiesPhoto(families, open);
  const crumbs: Crumb[] = open ? [{ label: v.h.code, back: nav("") }, { label: "Everyone", back: nav("everyone") }, { label: "One family" }] : [{ label: v.h.code }];
  const note =
    level === "families" ? `${total} in the photo, in ${shown} families. Tap a family to see them. Nobody knows whose is whose until the day.`
    : level === "family" ? `${shown} of them.`
    : `${total} in the photo: everyone whose household has said yes; a maybe stands as a ghost. ${v.names ? "It is the day: the names have come down." : "Nobody knows whose is whose until the day."}`;
  return { body: total ? `<div class="reading photo framed">${everyonePhoto(v, familyKey)}</div><p class="note">${esc(note)}</p>` : `<p class="note">Nobody yet.</p>`, crumbs };
}

// ───────────────────────────── the drawers ─────────────────────────────

/** The dressing applet's mount for one guest: a part, sent alone when their look changes. */
export function dressMount(v: HouseholdView, g: Guest): string {
  const dress: DressProps = { guestId: g.id, spec: specOf(g.minifigure), firstName: firstNameOf(g.name), out: isGuestOut(g, v.h) };
  return part(`dress-${g.id}`, `<div id="dress-${g.id}" data-applet="dress"${appletWrites(...LOOK_FIELDS.map((field) => ["household", "replace", `/guests/${g.id}/minifigure/${field}`] as const))} data-props="${esc(JSON.stringify(dress))}"></div>`);
}

/** The menu applet's mount for one guest: a part, sent alone when a choice changes. */
export function menuMount(v: HouseholdView, g: Guest): string {
  const menu: MenuProps = {
    guestId: g.id,
    courses: v.courses.map((c) => ({ id: c.id, name: c.name, dishes: c.dishes.map(({ id, name, dietary }) => ({ id, name, dietary })), drinks: c.drinks.map(({ id, name }) => ({ id, name })) })),
    choices: g.choices,
    out: isGuestOut(g, v.h),
    locked: !v.open,
  };
  // a course's dish or drink, chosen or taken back; nothing once answers are closed, its pills drawn disabled
  const choose = (op: "replace" | "remove", kind: "dish" | "drink") => ["household", op, `/guests/${g.id}/choices/*/${kind}`] as const;
  const writes = menu.locked ? "" : appletWrites(choose("replace", "dish"), choose("remove", "dish"), choose("replace", "drink"), choose("remove", "drink"));
  return part(`menu-${g.id}`, `<div id="menu-${g.id}" data-applet="menu"${writes} data-props="${esc(JSON.stringify(menu))}"></div>`);
}

/** The guest's drawer, named for them: the dressing sheet, whose callouts name its parts, the hint, coming as one choice (rule 13, off
 * the line), and the menu. */
function guestSheet(v: HouseholdView): string {
  const focus = over(v.session.ui).focus;
  const g = focus === undefined ? undefined : v.h.guests.find((x) => x.id === focus);
  if (!g) return "";
  const coming = choice(
    "Coming",
    [
      { text: "Yes", on: g.coming === 1, write: write("household", "replace", `/guests/${g.id}/coming`, "1"), kind: "yes" },
      { text: "No", on: g.coming === 0, write: write("household", "replace", `/guests/${g.id}/coming`, "0"), kind: "no" },
      { text: "Not sure", on: g.coming === null, write: write("household", "remove", `/guests/${g.id}/coming`) },
    ],
    !v.open,
  );
  const body = join(
    `<div class="figure-box">${dressMount(v, g)}</div>`,
    `<p class="hint">Touch a part to change it.</p>`,
    `<div class="props">${prop("Coming", coming)}</div>`,
    menuMount(v, g),
  );
  return drawer("guest-drawer", g.name, body, close(v), "guest-drawer");
}

/** What a gift is to this household, where its one control does not say it already: claimed by us, taken by another, or how many
 * have given to a shared one. That it is open, or that anyone may give, is the control's own word (Claim it, Give to it). */
function giftState(g: Gift, mine: boolean): { word: string; cls: string } | null {
  if (mine) return { word: "claimed by us", cls: "yes" };
  if (!g.shared && g.taken) return { word: "taken", cls: "no" };
  if (g.shared && g.taken) return { word: `${plural(g.taken, "household has", "households have")} given`, cls: "none" };
  return null;
}

/** The gifts, read in a drawer and put away: each whole -- its picture, its words, where to find it, what it is to us -- and the one thing this household may do with it. */
function giftsSheet(v: HouseholdView): string {
  if (over(v.session.ui).drawer !== "gifts") return "";
  const gifts = v.gifts.map((g) => {
    const mine = v.h.claims.includes(g.id);
    const st = giftState(g, mine);
    const act =
      mine ? tool("Unclaim", { kind: "quiet", write: write("household", "remove", `/claims/${g.id}`) })
      : g.shared || g.taken === 0 ? tool(g.shared ? "Give to it" : "Claim it", { icon: "gift", kind: "add", write: write("household", "add", "/claims/-", g.id) })
      : "";
    return part(
      `gift-${g.id}`,
      join(
        `<article class="gift" id="gift-${g.id}">`,
        g.picture_key && picture(g.picture_key, ""),
        `<div class="gift-words"><h3>${esc(g.name)}</h3>`,
        g.description && `<p class="note">${esc(g.description)}</p>`,
        g.link && `<a href="${esc(g.link)}" target="_blank" rel="noopener noreferrer">${esc(g.link.replace(/^https?:\/\//, ""))}</a>`,
        `<div class="gift-foot">${st ? `<span class="state-${st.cls}">${esc(st.word)}</span>` : ""}${act}</div>`,
        `</div></article>`,
      ),
    );
  });
  return drawer("gifts-drawer", "Gifts", gifts.length ? gifts.join("") : `<p class="note">No gifts on the list yet.</p>`, close(v), "info-drawer");
}

/** The day, read in a drawer: when and where, then what happens -- and where, only where it moves from the day's own place. */
function daySheet(v: HouseholdView): string {
  if (over(v.session.ui).drawer !== "day") return "";
  const body = join(`<p class="when-where">${esc(formatDay(v.w.day))}${v.w.venue ? `<br>${esc(v.w.venue)}` : ""}</p>`, timetableRows(v.events, { at: v.w.venue }));
  return drawer("day-drawer", "The day", body, close(v), "info-drawer");
}

/** Where to stay, read in a drawer. */
function staySheet(v: HouseholdView): string {
  if (over(v.session.ui).drawer !== "stay") return "";
  return drawer("stay-drawer", "Where to stay", placeRows(v.places), close(v), "info-drawer");
}

const DEFAULT_WORDS: Record<"yes" | "maybe" | "no", string> = {
  yes: "Yes! We'll be there.",
  maybe: "We hope so — we'll let you know.",
  no: "Sorry, we can't be there.",
};

/** The answer's drawer: every option whole -- a face, its colour, its sentence -- and the words beneath, written as they are left, as
 * every other drawer's are. */
function answerSheet(v: HouseholdView): string {
  if (!over(v.session.ui).answering) return "";
  const { h } = v;
  const option = (kind: "yes" | "maybe" | "no") =>
    `<button type="button" class="answer-option${h.answer === kind ? " on" : ""}" role="radio" aria-checked="${h.answer === kind}"${write("household", "replace", "/answer", kind)}${v.open ? "" : " disabled"}>${faceMark(kind, 40, true)}<span class="answer-say">${esc(DEFAULT_WORDS[kind])}</span></button>`;
  const body = join(
    v.open ? "" : `<p class="note">Answers closed on ${esc(formatDay(v.w.deadline ?? ""))}.</p>`,
    `<div class="answer-options" role="radiogroup" aria-label="Are you coming?">${option("yes")}${option("maybe")}${option("no")}</div>`,
    h.answer && v.open && `<div class="drawer-foot">${tool("Take back our answer", { kind: "quiet", write: write("household", "remove", "/answer") })}</div>`,
    `<div class="props">${prop(
      "Our words",
      `<form data-write-on="blur"><textarea name="message"${write("household", "replace", "/message")} rows="3" placeholder="Say something to the couple" aria-label="Our words">${esc(h.message ?? "")}</textarea></form>`,
    )}</div>`,
  );
  return drawer("answer-drawer", "Our answer", body, close(v), "answer-drawer");
}
