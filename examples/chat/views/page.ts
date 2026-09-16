// Chat's page, drawn as the bento mock-up draws a page (examples/bento): the ground is the room.
// Its box holds three compartments -- the conversation, big; the people; the rooms -- each
// growing into the window when opened, with its tools on the rail and the page's tools at the
// bottom right. A person is a thing: their drawer holds their name. A new room is the plus and a
// modal. Before a name there is only the door.

import { slug, tray, type Tray } from "../../../src/tray";
import type { ChatMessage } from "../documents/room";
import type { Ui } from "../documents/session";
import { esc, join, write } from "./html";
import { icon, type IconName } from "./icons";

export type View = {
  name: string;
  room: string | null;
  ui: Ui;
  rooms: string[];
  people: string[];
  transcript: ChatMessage[];
};

// ───────────────────────────── the door ─────────────────────────────

/** Without a name you cannot enter: the one form before the box. */
export function door(): string {
  return join(
    `<section class="door">`,
    `<h1 class="cap">Chat</h1>`,
    `<form${write("session", "replace", "/name")}>`,
    `<label for="name" class="note">Your name</label>`,
    `<input id="name" name="name" autocomplete="off" autofocus required>`,
    `<button type="submit" class="tool">Continue</button>`,
    `</form></section>`,
  );
}

// ───────────────────────────── the tools ─────────────────────────────

interface ToolOptions {
  icon?: IconName;
  kind?: "quiet" | "add";
  write: string;
  pressed?: boolean;
  iconOnly?: boolean;
  submit?: boolean;
}

function tool(text: string, o: ToolOptions): string {
  const word = o.iconOnly ? `<span class="sr-only">${esc(text)}</span>` : esc(text);
  return `<button type="${o.submit ? "submit" : "button"}" class="tool${o.kind ? ` ${o.kind}` : ""}"${o.iconOnly ? ` aria-label="${esc(text)}"` : ""}${o.pressed === undefined ? "" : ` aria-pressed="${o.pressed}"`}${o.write}>${o.icon ? icon(o.icon) : ""}${word}</button>`;
}

/** Undo, redo and log out: one stack, at the bottom right of the window, across beside the trail on the box. */
function pageTools(lay: "down" | "across"): string {
  return join(
    `<div class="stack page-tools${lay === "across" ? " across" : ""}" aria-label="Tools">`,
    tool("Undo", { icon: "undo", iconOnly: true, write: write("ledger", "remove", "/latest") }),
    tool("Redo", { icon: "redo", iconOnly: true, write: write("ledger", "add", "/latest") }),
    tool("Log out", { icon: "log-out", kind: "quiet", iconOnly: true, write: write("session", "remove", "/name") }),
    "</div>",
  );
}

/** Find (rule 17): the tool on the rail, and open, the field beside it with the tally and the eye. */
function findControl(key: string, ui: Ui, shown: number, total: number): { tool: string; filter?: string } {
  const word = ui.filter?.[key];
  const open = word !== undefined;
  const hide = !!ui.hide?.[key];
  const button = tool("Find", { icon: "search", iconOnly: true, pressed: open, write: open ? write("session", "remove", `/filter/${key}`) : write("session", "replace", `/filter/${key}`, "") });
  if (!open) return { tool: button };
  const eye = tool(hide ? "Show what misses" : "Hide what misses", { icon: hide ? "eye-off" : "eye", iconOnly: true, pressed: hide, write: hide ? write("session", "remove", `/hide/${key}`) : write("session", "replace", `/hide/${key}`, true) });
  return {
    tool: button,
    filter: `<div class="filter"><form data-write-on="input"><input name="q" type="search" value="${esc(word)}" placeholder="Find" aria-label="Find" autocomplete="off" autofocus${write("session", "replace", `/filter/${key}`)}></form><span class="tally">${shown} of ${total}</span>${eye}</div>`,
  };
}

export const matches = (text: string, word: string | undefined): boolean => word === undefined || !word.trim() || text.toLowerCase().includes(word.trim().toLowerCase());

// ───────────────────────────── the rows ─────────────────────────────

interface RowOptions {
  id?: string;
  tap?: string;
  chosen?: boolean;
  hushed?: boolean;
  hidden?: boolean;
  lead?: string;
  what: string;
  note?: string;
  state?: string;
  mark?: "pencil" | "chevron";
}

/** A row of a list: a lead, the words, the state, the mark -- the same on every list. */
function row(o: RowOptions): string {
  const classes = ["row", o.tap && "tap", o.hushed && "hushed"].filter(Boolean).join(" ");
  const mark = o.mark === "pencil" ? `<span class="mark">${icon("pencil", 16)}</span>` : o.mark === "chevron" ? `<span class="mark">${icon("chevron-right", 18)}</span>` : "";
  return join(
    `<div class="${classes}"${o.id ? ` id="${esc(o.id)}"` : ""}${o.tap ? ` role="button" tabindex="0"${o.tap}` : ""}${o.chosen !== undefined ? ` aria-pressed="${o.chosen}"` : ""}${o.chosen ? " data-reveal" : ""}${o.hidden ? " hidden" : ""}>`,
    o.lead && `<span class="lead">${o.lead}</span>`,
    `<span class="words"><span class="what">${esc(o.what)}</span>${o.note ? `<span class="note">${esc(o.note)}</span>` : ""}</span>`,
    o.state && `<span class="state">${esc(o.state)}</span>`,
    mark,
    "</div>",
  );
}

const rows = (items: string[], empty: string): string => (items.length ? `<div class="rows">${items.join("")}</div>` : `<p class="note">${esc(empty)}</p>`);

/** The first letter of a name, as the face it wears. */
const face = (name: string, me: boolean): string => `<span class="face${me ? " me" : ""}" aria-hidden="true">${esc(name.charAt(0).toUpperCase())}</span>`;

// ───────────────────────────── the conversation ─────────────────────────────

/** A message is a bubble: yours on the right, everyone else's on the left with a face, the name shown only on the first of a run. */
export function messageLi(message: ChatMessage, index: number, messages: ChatMessage[], viewer: string, word?: string, hide?: boolean): string {
  const mine = message.name === viewer;
  const firstOfRun = index === 0 || messages[index - 1]!.name !== message.name;
  const miss = !matches(`${message.name} ${message.text}`, word);
  const nameLine = !mine && firstOfRun ? `<span class="name">${esc(message.name)}</span>` : "";
  return join(
    `<li id="m${message.id}" class="${mine ? "mine" : ""}${miss ? " hushed" : ""}"${miss && hide ? " hidden" : ""}>`,
    face(message.name, mine),
    `<div class="body">${nameLine}<span class="bubble">${esc(message.text)}</span></div>`,
    "</li>",
  );
}

/** The last lines of the conversation, as the compartment's small reading. */
export function talkMini(transcript: ChatMessage[]): string {
  const last = transcript.slice(-3);
  return `<div id="talk-mini" class="mini lines">${last.length ? last.map((m) => `<p><b>${esc(m.name)}</b> ${esc(m.text)}</p>`).join("") : `<p class="note">Nothing said yet.</p>`}</div>`;
}

/** Who is here, as faces, with the count: the people compartment's small reading. */
export function peopleMini(people: string[], me: string): string {
  return `<div id="people-mini"><p class="cell-summary">${people.length} here</p><div class="mini faces">${people.map((p) => `<span class="who">${face(p, p === me)}<span class="note">${esc(p)}</span></span>`).join("")}</div></div>`;
}

/** The people as rows: a person is a thing, ✎ their drawer. */
export function peopleRows(people: string[], me: string, ui: Ui): string {
  return `<div id="people-rows">${rows(
    people.map((p) => row({ id: `p-${slug(p)}`, tap: write("session", "replace", "/focus", p), chosen: ui.focus === p, what: p, state: p === me ? "you" : "here", mark: "pencil" })),
    "Nobody here.",
  )}</div>`;
}

// ───────────────────────────── the page ─────────────────────────────

const COLUMNS = 3;

interface Cell {
  key: string;
  name: string;
  mark: IconName;
  count?: number;
  summary?: string;
  body?: string;
  big?: boolean;
  /** Opens into the window. */
  opens: boolean;
}

function cellHtml(c: Cell, t: Tray, phone: Tray): string {
  const corners = (x: Tray) => x.cells.find((p) => p.key === c.key)!.corners.join(" ");
  const opens = c.opens ? ` role="button" tabindex="0" data-moving="${c.key}"${write("session", "replace", "/open", c.key)}` : "";
  return join(
    `<div class="cell${c.big ? " big" : ""}" data-key="${c.key}" data-corners="${corners(t)}" data-corners-phone="${corners(phone)}" style="grid-area: ${c.key}"${opens}>`,
    `<div class="cell-head cap"><span class="cell-icon">${icon(c.mark, 18)}</span><span class="cell-name">${esc(c.name)}${c.count !== undefined ? ` · ${c.count}` : ""}</span>${c.opens ? `<span class="chev">${icon("chevron-right", 18)}</span>` : ""}</div>`,
    c.summary && `<p class="cell-summary">${esc(c.summary)}</p>`,
    c.body && `<div class="cell-body">${c.body}</div>`,
    "</div>",
  );
}

interface Open {
  key: string;
  tools?: string[];
  filter?: string;
  body: string;
}

function windowHtml(v: View, o: Open, name: string): string {
  const back = v.room ? `<span class="cell-back cap">#${esc(v.room)}</span>` : `<span class="cell-back cap">Chat</span>`;
  return join(
    `<div class="cell open" data-key="${o.key}" data-moving="${o.key}">`,
    `<div class="cell-head cap"><a class="cell-back" href="#"${write("session", "remove", "/open")}>${back}</a><span class="chev">${icon("chevron-right", 14)}</span><span class="cell-name">${esc(name)}</span></div>`,
    o.tools && o.tools.length > 0 && `<div class="rail work"><div class="stack">${o.tools.join("")}</div></div>`,
    o.filter,
    `<div class="full">${o.body}</div>`,
    pageTools("down"),
    "</div>",
  );
}

function conversationOpen(v: View): Open {
  const word = v.ui.filter?.conversation;
  const hide = v.ui.hide?.conversation;
  const shown = v.transcript.filter((m) => matches(`${m.name} ${m.text}`, word)).length;
  const find = findControl("conversation", v.ui, shown, v.transcript.length);
  return {
    key: "conversation",
    tools: v.transcript.length ? [find.tool] : [],
    filter: find.filter,
    body: join(
      `<ul class="messages" id="messages" data-autoscroll>${v.transcript.map((m, i) => messageLi(m, i, v.transcript, v.name, word, hide)).join("")}</ul>`,
      `<form class="say"${write("room", "add", "/transcript/-")}><input name="text" autocomplete="off" required autofocus placeholder="Message #${esc(v.room ?? "")}" aria-label="Say"><button type="submit" class="tool">Send</button></form>`,
    ),
  };
}

function peopleOpen(v: View): Open {
  return { key: "people", body: peopleRows(v.people, v.name, v.ui) };
}

function roomsOpen(v: View): Open {
  const word = v.ui.filter?.rooms;
  const hide = v.ui.hide?.rooms;
  const hits = (r: string) => matches(r, word);
  const find = findControl("rooms", v.ui, v.rooms.filter(hits).length, v.rooms.length);
  const list = v.rooms.map((r) =>
    row({ id: `r-${slug(r)}`, tap: write("session", "replace", "/room", r), hushed: !hits(r), hidden: !hits(r) && hide, lead: `<span class="hash">${icon("hash", 16)}</span>`, what: r, state: r === v.room ? "here" : undefined, mark: "chevron" }),
  );
  return {
    key: "rooms",
    tools: [v.rooms.length ? find.tool : "", tool("New room", { icon: "plus", iconOnly: true, write: write("session", "replace", "/new", "rooms") })].filter(Boolean),
    filter: find.filter,
    body: rows(list, "No rooms yet. Make one."),
  };
}

/** The drawer: a person's properties. Your own name is yours to change. */
function personSheet(v: View): string {
  const who = v.ui.focus;
  if (!who) return "";
  const me = who === v.name;
  const close = write("session", "remove", "/focus");
  const name = me
    ? `<form data-write-on="blur"><input class="field" name="name" value="${esc(who)}" aria-label="Your name" autocomplete="off"${write("session", "replace", "/name")}></form>`
    : `<span>${esc(who)}</span>`;
  return join(
    `<div class="scrim"${close}></div>`,
    `<div class="sheet" role="dialog" aria-label="${esc(who)}">`,
    `<div class="sheet-head"><h2>${esc(who)}</h2><button type="button" class="tool quiet sheet-close" aria-label="Close"${close}>${icon("x", 18)}</button></div>`,
    `<div class="sheet-body"><div class="props">`,
    `<div class="prop"><span class="prop-name cap">Name</span><div class="prop-value">${name}</div></div>`,
    `<div class="prop"><span class="prop-name cap">Here</span><div class="prop-value">${v.people.includes(who) ? "yes" : "not any more"}</div></div>`,
    `</div></div></div>`,
  );
}

/** The modal: a new room, one question. Its name is the write that makes it and goes in. */
function newRoomModal(): string {
  const close = write("session", "remove", "/new");
  return join(
    `<div class="scrim modal-scrim"${close}></div>`,
    `<dialog open class="modal" aria-label="A new room"><h3>A new room</h3>`,
    `<form${write("session", "replace", "/room")}><label class="modal-field"><span class="note">Its name</span><input name="room" autocomplete="off" required autofocus></label>`,
    `<div class="modal-foot">${tool("Cancel", { kind: "quiet", write: close })}${tool("Make it", { icon: "plus", kind: "add", write: "", submit: true })}</div></form></dialog>`,
  );
}

/** The box, or one compartment grown into the window; the drawer and the modal over it. */
export function page(v: View): string {
  const open = v.ui.open ?? (v.room ? undefined : "rooms");
  const cells: Cell[] = [
    { key: "conversation", name: "conversation", mark: "talk", big: true, opens: !!v.room, summary: v.room ? undefined : "no room yet", body: v.room ? talkMini(v.transcript) : undefined },
    { key: "people", name: "people", mark: "users", opens: !!v.room, summary: v.room ? undefined : "nobody yet", body: v.room ? peopleMini(v.people, v.name) : undefined },
    { key: "rooms", name: "rooms", mark: "hash", count: v.rooms.length, opens: true, summary: v.room ? `in #${v.room}` : "choose one, or make one" },
  ];
  const spec = cells.map((c) => ({ key: c.key, span: c.big ? COLUMNS : 1 }));
  const wide = tray(spec, COLUMNS);
  const narrow = tray(spec, 1);
  const opened: Open | undefined = open === "conversation" && v.room ? conversationOpen(v) : open === "people" && v.room ? peopleOpen(v) : open === "rooms" ? roomsOpen(v) : undefined;
  const placed = cells.map((c) => (opened && c.key === opened.key ? windowHtml(v, opened, c.name) : cellHtml(c, wide, narrow)));
  const trail = join(
    `<nav class="crumbs cap" aria-label="Where you are">`,
    v.room ? `<span class="crumb"><a href="#"${write("session", "remove", "/room")}>Chat</a></span><span class="crumb"><span class="sep">${icon("chevron-right", 14)}</span><b aria-current="page">#${esc(v.room)}</b></span>` : `<span class="crumb"><b aria-current="page">Chat</b></span>`,
    `<span class="crumb who"><span class="sep">${icon("chevron-right", 14)}</span><span class="user-label">${esc(v.name)}</span></span>`,
    "</nav>",
  );
  const modalOpen = v.ui.new === "rooms";
  const areas = (t: Tray) => t.areas.replace(/\n/g, " ");
  const body = join(
    `<header class="page-head">${trail}${opened ? "" : pageTools("across")}</header>`,
    `<section class="page box${opened ? " windowed" : ""}"><div class="cells" style='--tray-areas: ${areas(wide)}; --tray-areas-phone: ${areas(narrow)}'>${placed.join("")}</div></section>`,
    personSheet(v),
  );
  return join(`<div class="site${modalOpen || v.ui.focus ? " locked" : ""}">`, modalOpen ? `<div inert>${body}</div>` : body, modalOpen && newRoomModal(), "</div>");
}
