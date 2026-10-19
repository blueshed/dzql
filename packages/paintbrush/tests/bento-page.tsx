// Every surface drawn twice, for bento.test.ts: by dzql's bento.ts (the HTML the server sends) and by
// src/resources/bento.tsx (railroad, in the browser), from the same input. The page puts each pair
// side by side, reads each back as the browser holds it, less what only one of them carries -- a
// write (`data-write`, `data-value`), the server's parts (`data-eta-part`, `data-page`), an icon's
// drawing -- and says each pair as `window.pairs`. The presses the railroad side hears are counted.
import { mount, signal } from "@blueshed/railroad";
import { ChefHat, Clock, Coffee, List, LogOut, Map as MapIcon, MapPin } from "lucide";
import * as server from "dzql/rendering/bento";
import { svg, type IconNode } from "dzql/rendering/icons";
import { write } from "dzql/rendering/html";
import { ChevronRight, Eye, EyeOff, Pencil, Plus, Redo2, Search, Trash2, Undo2, X } from "lucide";
import { bento, choice, field, go, here, layers, mark, paged, prop, rows, rowsOf, run, type Act } from "../src/resources/bento";

const NODES: Record<string, IconNode> = {
  "chevron-right": ChevronRight as IconNode, pencil: Pencil as IconNode, undo: Undo2 as IconNode, redo: Redo2 as IconNode, plus: Plus as IconNode, x: X as IconNode, trash: Trash2 as IconNode,
  search: Search as IconNode, eye: Eye as IconNode, "eye-off": EyeOff as IconNode, "log-out": LogOut as IconNode, list: List as IconNode, map: MapIcon as IconNode, coffee: Coffee as IconNode,
  "chef-hat": ChefHat as IconNode, "map-pin": MapPin as IconNode, clock: Clock as IconNode,
};
const s = server.bento({ icon: (n: string, size = 16) => svg(NODES[n]!, { size, name: n }), session: "visit", leave: { text: "Sign out", icon: "log-out", path: "/who" } });
const w = write("order", "replace", "/x", 1); // any write: it is left out of the comparison

declare global {
  interface Window {
    pairs: { name: string; server: string; browser: string }[];
    presses: string[];
    items: ReturnType<typeof signal<{ id: number; name: string }[]>>;
    go: typeof go;
    drawn: number;
  }
}
window.presses = [];
const press = (what: string): Act => () => void window.presses.push(what);
const b = bento({ undo: press("undo"), redo: press("redo"), leave: { text: "Sign out", icon: LogOut, on: press("leave") } });
const quiet = bento(); // no undo, no leave: no page's tools

const cases: [name: string, server: string, browser: () => Node][] = [
  ["the trail", s.crumbs([{ label: "Cafés" }, { label: "Corner Café", back: w }, { label: "The kitchen" }]), () => b.crumbs([{ label: "Cafés" }, { label: "Corner Café", back: press("back") }, { label: "The kitchen" }])],
  ["a tool", s.tool("Send", { kind: "add", icon: "plus", write: w }), () => b.tool("Send", { kind: "add", icon: Plus, on: press("send") })],
  ["a quiet tool, disabled", s.tool("Cancel", { kind: "quiet", write: w, disabled: true }), () => b.tool("Cancel", { kind: "quiet", disabled: true })],
  ["a square tool, pressed and expanded", s.tool("Find", { icon: "search", iconOnly: true, pressed: true, expanded: false, className: "find", write: w }), () => b.tool("Find", { icon: Search, iconOnly: true, pressed: true, expanded: false, className: "find" })],
  ["a submit with its own label", s.tool("Go", { label: "Go there", submit: true, kind: "danger", write: "" }), () => b.tool("Go", { label: "Go there", submit: true, kind: "danger" })],
  ["the page's tools", s.pageTools("across"), () => b.pageTools("across")!],
  ["the page's tools, down", s.pageTools(), () => b.pageTools()!],
  ["the reading switch", s.readingSwitch([["List", "list", true, w], ["Map", "map", false, w]]), () => b.readingSwitch([["List", List, true, press("list")], ["Map", MapIcon, false, press("map")]])],
  ["the plus", s.addTool(w, "Add a dish"), () => b.addTool(press("add"), "Add a dish")],
  ["find, closed", s.findControl("menu", {} as server.FindState).tool, () => b.findControl({ word: signal<string | undefined>(undefined), hide: signal(false), shown: 0, total: 0 }).tool],
  ...(() => {
    const open = s.findControl("menu", { word: "fl", hide: true, shown: 1, total: 6 });
    const find = () => b.findControl({ word: signal<string | undefined>("fl"), hide: signal(true), shown: 1, total: 6 });
    return [["find, open", open.tool, () => find().tool], ["find's field", open.filter!, () => find().filter]] as [string, string, () => Node][];
  })(),
  ["a pin", s.pin("Table 4", { mark: "map-pin", write: w }), () => b.pin("Table 4", { mark: MapPin, on: press("pin") })],
  ["a pin, read", s.pin("Open till 17:00"), () => b.pin("Open till 17:00")],
  ["a cell that opens", s.cell({ name: "The kitchen", mark: "chef-hat", count: 5, opens: w, big: true, summary: "the oldest 12 min", body: "<p>bar</p>" }).html, () => b.cell({ name: "The kitchen", mark: ChefHat, count: 5, opens: press("kitchen"), big: true, summary: "the oldest 12 min", body: <p>bar</p> }).node],
  ["a thing, chosen, with pins", s.cell({ name: "Your order", key: "order", thing: { open: w, chosen: true }, pins: [s.pin("Table 4")] }).html, () => b.cell({ name: "Your order", key: "order", thing: { open: press("order"), chosen: true }, pins: [b.pin("Table 4")] }).node],
  ["a cell only read", s.cell({ name: "Today", summary: null }).html, () => b.cell({ name: "Today", summary: null }).node],
  ...(() => {
    const cells = () => [s.cell({ name: "Menu", span: 2, rows: 2, body: "<p>menu</p>" }), s.cell({ name: "Your order", opens: w }), s.cell({ name: "The kitchen", opens: w })];
    const ours = () => [b.cell({ name: "Menu", span: 2, rows: 2, body: <p>menu</p> }), b.cell({ name: "Your order", opens: press("order") }), b.cell({ name: "The kitchen", opens: press("kitchen") })];
    const trail = [{ label: "Cafés", back: w }, { label: "Corner Café" }];
    const ourTrail = [{ label: "Cafés", back: press("cafes") }, { label: "Corner Café" }];
    const open = { key: "kitchen", reading: "<p>reading</p>", tools: ["<p>tool</p>"], filter: "<p>filter</p>", body: "<p>orders</p>", note: "5 open" };
    const ourOpen = () => ({ key: "kitchen", reading: <p>reading</p>, tools: [<p>tool</p>], filter: <p>filter</p>, body: <p>orders</p>, note: "5 open" });
    return [
      ["a box", s.boxPage(trail, ["<p>in place</p>"], cells()), () => b.boxPage(ourTrail, [<p>in place</p>], ours())],
      ["a box with a heading", s.boxPage(trail, [], cells(), undefined, { logo: '<img src="logo.png" alt="">', actions: [s.tool("Add to the menu", { icon: "plus", write: w })] }), () => b.boxPage(ourTrail, [], ours(), undefined, { logo: <img src="logo.png" alt="" />, actions: [b.tool("Add to the menu", { icon: Plus })] })],
      ["a box, a cell open", s.boxPage(trail, ["<p>in place</p>"], cells(), open), () => b.boxPage(ourTrail, [<p>in place</p>], ours(), ourOpen())],
      ["a box, a cell open, its way back found", s.boxPage([{ label: "Corner Café" }], [], cells(), { key: "kitchen", body: "" }), () => b.boxPage([{ label: "Corner Café" }], [], ours(), { key: "kitchen", body: <></> })],
      ["a collection", s.collectionPage([{ label: "The kitchen" }], { key: "orders", body: "<p>orders</p>" }), () => b.collectionPage([{ label: "The kitchen" }], { key: "orders", body: <p>orders</p> })],
    ] as [string, string, () => Node][];
  })(),
  ["a row that taps", s.row({ id: "d1", tap: w, chosen: true, hushed: true, lead: "<b>1</b>", what: "Flat white", note: "double", state: "£3.20", mark: "pencil" }), () => b.row({ id: "d1", tap: press("d1"), chosen: true, hushed: true, lead: <b>1</b>, what: "Flat white", note: "double", state: "£3.20", mark: "pencil" })],
  ["a row hidden", s.row({ tap: w, chosen: false, hidden: true, what: "Cortado", mark: "chevron" }), () => b.row({ tap: press("d2"), chosen: false, hidden: true, what: "Cortado", mark: "chevron" })],
  ["a row only read", s.row({ what: "Total", state: "£9.90", total: true }), () => b.row({ what: "Total", state: "£9.90", total: true })],
  ["a row with a deed", s.row({ id: "d3", tap: w, chosen: false, what: "Oat latte", note: "oat", state: "£3.60", mark: "pencil", act: s.tool("Add", { write: w }) }), () => b.row({ id: "d3", tap: press("d3"), chosen: false, what: "Oat latte", note: "oat", state: "£3.60", mark: "pencil", act: b.tool("Add", { on: press("add d3") }) })],
  ["a row with nothing to do", s.row({ what: "Soup", state: "sold out", act: "" }), () => b.row({ what: "Soup", state: "sold out", act: "" })],
  ["rows", server.rows([s.row({ what: "a" }), s.row({ what: "b" })], "None"), () => rows([b.row({ what: "a" }), b.row({ what: "b" })], "None")],
  ["no rows", server.rows([], "Nothing yet."), () => rows([], "Nothing yet.")],
  ["a run", server.run("Coffee"), () => run("Coffee")],
  ["a property", server.prop("Price", "<span>£3.20</span>"), () => prop("Price", <span>£3.20</span>)],
  ["a text field", server.field({ doc: "menu", path: "/dishes/1/name", value: "Flat white", label: "Name", placeholder: "A name", said: "<span>saved</span>" }), () => field({ doc: "menu", path: "/dishes/1/name", value: "Flat white", label: "Name", placeholder: "A name", said: <span>saved</span>, write: press("name") })],
  ["a number, as it is typed", server.field({ doc: "menu", path: "/dishes/1/price", value: 3.2, label: "Price", kind: "number", on: "input" }), () => field({ doc: "menu", path: "/dishes/1/price", value: 3.2, label: "Price", kind: "number", on: "input", write: press("price") })],
  ["a textarea", server.field({ doc: "menu", path: "/dishes/1/about", value: "Double ristretto", label: "What it is", kind: "textarea" }), () => field({ doc: "menu", path: "/dishes/1/about", value: "Double ristretto", label: "What it is", kind: "textarea", write: press("about") })],
  ["a select", server.field({ doc: "menu", path: "/dishes/1/run", value: "food", label: "Under", kind: "select", options: [{ value: "coffee", text: "Coffee" }, { value: "food", text: "Food" }] }), () => field({ doc: "menu", path: "/dishes/1/run", value: "food", label: "Under", kind: "select", options: [{ value: "coffee", text: "Coffee" }, { value: "food", text: "Food" }], write: press("run") })],
  ["a tick, in a row", server.field({ doc: "menu", path: "/dishes/1/out", value: true, label: "Sold out", kind: "checkbox", inRow: true }), () => field({ doc: "menu", path: "/dishes/1/out", value: true, label: "Sold out", kind: "checkbox", inRow: true, write: press("out") })],
  ["a field read", server.field({ doc: "menu", path: "/dishes/1/run", value: "food", label: "Under", kind: "select", options: [{ value: "food", text: "Food" }], may: false }), () => field({ doc: "menu", path: "/dishes/1/run", value: "food", label: "Under", kind: "select", options: [{ value: "food", text: "Food" }], may: false, write: press("never") })],
  ["a tick read, in a row", server.field({ doc: "menu", path: "/dishes/1/out", value: false, label: "Sold out", kind: "checkbox", inRow: true, may: false }), () => field({ doc: "menu", path: "/dishes/1/out", value: false, label: "Sold out", kind: "checkbox", inRow: true, may: false, write: press("never") })],
  ["a choice", server.choice("On the menu under", [{ text: "Coffee", on: true, write: w }, { text: "Food", on: false, write: w, kind: "no" }]), () => choice("On the menu under", [{ text: "Coffee", on: true, act: press("coffee") }, { text: "Food", on: false, act: press("food"), kind: "no" }])],
  ["a choice locked", server.choice("Paid", [{ text: "Yes", on: true, write: w, kind: "yes" }], true), () => choice("Paid", [{ text: "Yes", on: true, act: press("yes"), kind: "yes" }], true)],
  ["a drawer", s.drawer("dish", "Flat white", server.prop("Price", "<span>£3.20</span>"), w, "dish-drawer"), () => b.drawer("dish", "Flat white", prop("Price", <span>£3.20</span>), press("close"), "dish-drawer")],
  ["adding, in a modal", s.addModal("Add to the menu", [{ name: "name", label: "Its name", placeholder: "Scone" }, { name: "price", label: "Its price", type: "number", required: false }, { name: "run", label: "Under", options: [{ value: "coffee", text: "Coffee" }, { value: "food", text: "Food" }], value: "food" }], w, w, "Add", "<p>told</p>"), () => b.addModal("Add to the menu", [{ name: "name", label: "Its name", placeholder: "Scone" }, { name: "price", label: "Its price", type: "number", required: false }, { name: "run", label: "Under", options: [{ value: "coffee", text: "Coffee" }, { value: "food", text: "Food" }], value: "food" }], (v) => void window.presses.push(`added ${JSON.stringify(v)}`), press("cancel"), "Add", <p>told</p>)],
  ["removing, in a modal", s.confirmModal("Take it off the menu?", "Nobody can order it.", w, w, "Take it off"), () => b.confirmModal("Take it off the menu?", "Nobody can order it.", press("take off"), press("never mind"), "Take it off")],
  ["the layers, a drawer and a modal open", server.layers("<p>page</p>", "<p>drawer</p>", "<p>modal</p>"), () => layers(<p>page</p>, <p>drawer</p>, <p>modal</p>)],
  ["the layers, nothing open", server.layers("<p>page</p>", "", ""), () => layers(<p>page</p>, null, null)],
  ["the page's tools, none", "", () => quiet.pageTools() ?? <></>],
];

// The element as the browser holds it, in words: its tag, its attributes in order (a field's value,
// a tick and a choice as the browser has them, not as they were written), and its children; an
// icon is its size; a comment, and text that is only space, are nothing.
const LEFT_OUT = new Set(["data-write", "data-value", "data-eta-part", "data-page", "data-page-write"]);
function said(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (tag === "svg") return `<svg ${el.getAttribute("width")}x${el.getAttribute("height")} ${el.getAttribute("aria-hidden") ?? ""}>`;
  const attrs = [...el.attributes].filter((a) => !LEFT_OUT.has(a.name) && !["value", "checked", "selected", "style"].includes(a.name)).map((a) => `${a.name}=${JSON.stringify(a.value)}`);
  const style = (el as HTMLElement).style?.cssText;
  if (style) attrs.push(`style=${JSON.stringify(style)}`);
  if (el instanceof HTMLInputElement) attrs.push(el.type === "checkbox" ? `:checked=${el.checked}` : `:value=${JSON.stringify(el.value)}`);
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) attrs.push(`:value=${JSON.stringify(el.value)}`);
  if (el instanceof HTMLOptionElement) attrs.push(`:selected=${el.selected}`);
  const inner = el instanceof HTMLTextAreaElement ? "" : [...el.childNodes].map(said).join("");
  return `<${tag}${attrs.sort().map((a) => ` ${a}`).join("")}>${inner}</${tag}>`;
}

// What only the browser does: the page drawn from where you are, what opens over it, a list that changes
window.items = signal([{ id: 1, name: "Flat white" }]);
window.go = go;
window.drawn = 0;
const live = () =>
  layers(
    paged((path) => (window.drawn++, <p id="path">{path || "home"}</p>)),
    (at) => (at.what === "dish" ? <p id="drawer">{at.which}</p> : null),
    (at) => (at.what === "new" ? <p id="modal">new</p> : null),
  );

const sides = mount(document.body, () => (
  <main>
    <section id="live">
      {live()}
      {rowsOf(window.items, (i) => i.id, (i$) => b.row({ what: () => i$.get().name }), "Nothing yet.")}
      <span id="here">{() => JSON.stringify(here.get())}</span>
    </section>
    {cases.map(([name, html, ours]) => (
      <section data-case={name}>
        <div class="server" innerHTML={html} />
        <div class="browser">{ours()}</div>
      </section>
    ))}
  </main>
));
void sides;
window.pairs = [...document.querySelectorAll<HTMLElement>("[data-case]")].map((section) => ({
  name: section.dataset.case!,
  server: [...section.querySelector(".server")!.childNodes].map(said).join(""),
  browser: [...section.querySelector(".browser")!.childNodes].map(said).join(""),
}));
void mark;
