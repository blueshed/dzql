// The bento mock-up's behaviour, and all of it. Open a compartment: the same element grows into the
// window (a View Transition morphs the shape, so it reads as "that box got bigger", not "we went
// somewhere"). Its first crumb, the box it came from, is the way back. A figure in the reading (a
// pin, a face) opens the panel and is marked as chosen; the reading scrolls it into the clear
// beside the panel, the browser's own idea of scroll-into-view. Escape closes the panel, then the
// compartment. No server, no documents: a design prototype, not an eta example.
import { Bed, Camera, ChevronRight, createIcons, Gift, LayoutGrid, List, LogOut, MapPin, Minus, Pencil, Plus, Redo2, Search, Smile, Undo2, Users, X } from "lucide";

// The marks are lucide's, drawn the way lucide draws them in a browser: every <i data-lucide>
// becomes the outline's SVG at load. (The kernel's src/icons.ts does the same for a server render.)
createIcons({ icons: { Bed, Camera, ChevronRight, Gift, LayoutGrid, List, LogOut, MapPin, Minus, Pencil, Plus, Redo2, Search, Smile, Undo2, Users, X } });

const PANEL_WIDTH = 320; // --panel in styles.css
const PANEL_INSET = 24; // its distance from the window's edge
const PANEL_FROM = 720; // below this the panel is a sheet from the foot and covers nothing beside a figure
const NAME_ROOM = 140; // the name a figure wears, to its right

const bento = document.getElementById("bento")!;
const scrim = document.getElementById("scrim")!;
const panel = document.getElementById("panel")!;
const panelTitle = document.getElementById("panel-title")!;
const panelBody = document.getElementById("panel-body")!;
const panelClose = document.getElementById("panel-close")!;
const panelFoot = document.getElementById("panel-foot")!;
const modal = document.getElementById("modal") as HTMLDialogElement;
const modalForm = document.getElementById("modal-form") as HTMLFormElement;
const modalTitle = document.getElementById("modal-title")!;
const modalName = document.getElementById("modal-name") as HTMLInputElement;
const modalCancel = document.getElementById("modal-cancel")!;

/** The one compartment that moves is the one that is named for the transition, and it is drawn on top (styles.css); the others just change. */
function morph(cell: HTMLElement, change: () => void): void {
  if (!document.startViewTransition) return change();
  cell.style.viewTransitionName = "moving";
  document.startViewTransition(change).finished.finally(() => {
    cell.style.viewTransitionName = "";
  });
}

function openCell(cell: HTMLElement): void {
  morph(cell, () => {
    cell.classList.add("open");
    document.body.classList.add("windowed"); // the page behind holds still (styles.css)
  });
}

function closeCell(cell: HTMLElement): void {
  closePanel();
  morph(cell, () => {
    cell.classList.remove("open");
    document.body.classList.remove("windowed");
  });
}

/** The reading scrolls so the chosen figure sits in the clear beside the panel, not under it. The window does not change size because the content did. */
function scrollIntoClear(figure: HTMLElement): void {
  const reading = figure.closest<HTMLElement>(".full");
  if (!reading || window.innerWidth < PANEL_FROM) return;
  const clear = window.innerWidth - PANEL_WIDTH - PANEL_INSET * 2 - NAME_ROOM;
  const { left } = figure.getBoundingClientRect();
  if (left > clear) reading.scrollBy({ left: left - clear, behavior: "smooth" });
}

function openPanel(figure: HTMLElement): void {
  const name = figure.dataset.site!;
  for (const other of document.querySelectorAll<HTMLElement>('[data-site][aria-pressed="true"]')) {
    if (other !== figure) other.setAttribute("aria-pressed", "false");
  }
  figure.setAttribute("aria-pressed", "true");
  panelTitle.textContent = name;
  if (figure.classList.contains("thing")) {
    // a thing's properties, each by its kind: the answer as a choice, the words as text
    panelBody.innerHTML = `<label class="modal-field"><span class="note">Answer</span><div class="choice" role="radiogroup"><button type="button" class="carry" aria-pressed="true">Yes</button><button type="button" class="carry" aria-pressed="false">Maybe</button><button type="button" class="carry" aria-pressed="false">No</button></div></label><label class="modal-field"><span class="note">Words for the couple</span><textarea rows="3">Cannot wait. Ada is vegetarian.</textarea></label>`;
  } else {
    panelBody.textContent = `A line or two about ${name} would go here: whatever the compartment knows about it.`;
  }
  // what the figure carries -- claim, give -- is one control in its drawer, not on its line
  panelFoot.replaceChildren();
  if (figure.dataset.carry) {
    const carry = document.createElement("button");
    carry.type = "button";
    carry.className = "carry";
    carry.textContent = figure.dataset.carry;
    panelFoot.append(carry);
  }
  panel.classList.add("on");
  panel.setAttribute("aria-hidden", "false");
  scrim.classList.add("on");
  document.body.classList.add("panel-on"); // the rails step aside (styles.css)
  scrollIntoClear(figure);
}

function closePanel(): void {
  panel.classList.remove("on");
  panel.setAttribute("aria-hidden", "true");
  scrim.classList.remove("on");
  document.body.classList.remove("panel-on");
  for (const figure of document.querySelectorAll<HTMLElement>('[data-site][aria-pressed="true"]')) {
    figure.setAttribute("aria-pressed", "false");
  }
}

/** The filter, apples' way: a field beside its tool; what it misses dims and nothing hides; the tally counts lit of all. */
function toggleFilter(tool: HTMLElement): void {
  const body = tool.closest<HTMLElement>(".cell-body")!;
  const filter = body.querySelector<HTMLElement>(".filter")!;
  const on = filter.hidden;
  filter.hidden = !on;
  tool.setAttribute("aria-pressed", String(on));
  const input = filter.querySelector<HTMLInputElement>("input")!;
  if (on) input.focus();
  else {
    input.value = "";
    applyFilter(body, "");
  }
}

function applyFilter(body: HTMLElement, text: string): void {
  const word = text.trim().toLowerCase();
  const figures = [...body.querySelectorAll<HTMLElement>(".full [data-site]")];
  let lit = 0;
  for (const figure of figures) {
    const hit = !word || figure.dataset.site!.toLowerCase().includes(word);
    figure.classList.toggle("hushed", !hit);
    if (hit) lit++;
  }
  body.querySelector<HTMLElement>(".tally")!.textContent = word ? `${lit} of ${figures.length}` : "";
}

/** The modal: one question -- the name of the new thing -- and the thing is on its list when the answer lands. */
let making: { kind: string; body: HTMLElement } | undefined;

function askFor(kind: string, body: HTMLElement): void {
  making = { kind, body };
  modalTitle.textContent = `New ${kind}`;
  modalName.value = "";
  modal.showModal();
}

modalCancel.addEventListener("click", () => modal.close());

modalForm.addEventListener("submit", () => {
  if (!making) return;
  const name = modalName.value.trim();
  if (!name) return;
  if (making.kind === "gift") {
    const li = document.createElement("li");
    li.innerHTML = `<button type="button" class="row" data-carry="Claim" aria-pressed="false"><span></span><span class="note">open</span></button>`;
    const row = li.querySelector<HTMLElement>(".row")!;
    row.dataset.site = name;
    row.querySelector("span")!.textContent = name;
    making.body.querySelector(".full.list")!.append(li);
  } else {
    const thumb = document.createElement("span");
    thumb.className = "thumb";
    thumb.style.setProperty("--c", "#c9a227");
    thumb.title = name;
    making.body.querySelector(".full.thumbs-grid")!.append(thumb);
  }
  making = undefined;
});

bento.addEventListener("input", (event) => {
  const input = event.target as HTMLElement;
  if (input.matches(".filter input")) applyFilter(input.closest<HTMLElement>(".cell-body")!, (input as HTMLInputElement).value);
});

bento.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;

  const back = target.closest<HTMLElement>(".cell-back");
  if (back) {
    closeCell(back.closest<HTMLElement>(".cell")!);
    return;
  }

  const figure = target.closest<HTMLElement>("[data-site]");
  if (figure) {
    openPanel(figure); // a figure in a reading, or a compartment that is a thing: either opens its drawer
    return;
  }

  const add = target.closest<HTMLElement>(".add");
  if (add) {
    askFor(add.dataset.new!, add.closest<HTMLElement>(".cell-body")!);
    return;
  }

  const find = target.closest<HTMLElement>(".find");
  if (find) {
    toggleFilter(find);
    return;
  }

  if (target.closest(".rail, .cell-foot, .filter")) return; // a tool is not a way to open a compartment

  const cell = target.closest<HTMLElement>(".cell");
  if (cell && !cell.classList.contains("open")) openCell(cell);
});

scrim.addEventListener("click", closePanel);
panelClose.addEventListener("click", closePanel);

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (panel.classList.contains("on")) {
    closePanel();
    return;
  }
  const open = document.querySelector<HTMLElement>(".cell.open");
  if (open) closeCell(open);
});
