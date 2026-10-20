import { post, story, type Stories, type Write } from "dzql/modelling/stories";
import { links } from "./links";

// The cafe's stories, as the app tells them: each names the model story it tells (`model`, its
// number on the model's page, ./model.json), so the read-back matches them whatever their words.
// Mo manages and Kit cooks: each comes in by their link. A customer comes in by scanning the code
// on their table: Ann is at Table 1 and Bo at Table 2; Cy has come in and scanned nothing yet. The
// cafe starts with four free tables and Soup (1), Toast (2) and Coffee (3) on the menu; what a
// story starts from beyond that, its premise says. The first invoice opened is invoice 1, and the
// first dish ordered onto it is order 1.

const seat = (table: number): Write => ({ doc: "floor", ops: [{ op: "add", path: "/invoices/-", value: { tables_id: table } }] });
const order = (invoice: number, item: number): Write => ({ doc: "table", ops: [{ op: "add", path: "/orders/-", value: { invoices_id: invoice, dish_id: item } }] });
const status = (doc: string, id: number, value: "ready" | "placed"): Write => ({ doc, ops: [{ op: "replace", path: `/orders/${id}/status`, value }] });
const pay = (doc: string, invoice: number): Write => ({ doc, ops: [{ op: "replace", path: `/invoices/${invoice}/paid`, value: true }] });
const leave: Write = { doc: "visit", ops: [{ op: "remove", path: "/role" }] };
const addItem = (name: string, price: number): Write => ({ doc: "menu", ops: [{ op: "add", path: "/items/-", value: { name, price } }] });

const seated = { mo: [seat(1)] };
const ordered = { mo: [seat(1)], ann: [order(1, 1)] };
const ready = { mo: [seat(1)], ann: [order(1, 1)], kit: [status("floor", 1, "ready")] };

/** A member of staff's way in: their link. */
const link = (name: string) => post(links.ways().find((w) => w.name.startsWith(`${name},`))!.path);

export const stories = {
  cast: { mo: [], kit: [], ann: [], bo: [], cy: [] },
  signIn: (name) =>
    name === "mo" ? link("Mo")
    : name === "kit" ? link("Kit")
    : name === "ann" ? post("/scan", { table: "1" })
    : name === "bo" ? post("/scan", { table: "2" })
    : undefined,
  goTo: (address) => ({ doc: "visit", ops: [{ op: "replace", path: "/page", value: address }] }),
  stories: {
    // ── what the cafe has ──
    moAddsTable: story("Mo adds Table 5, and sees it on the floor; Cy at the door sees a way in to it", { model: 1, as: "mo", from: "tables?new", does: { doc: "floor", ops: [{ op: "add", path: "/tables/-", value: "Table 5" }] }, seen: { mo: "tables", cy: "" } }),
    kitPutsCake: story("Kit puts Cake on the menu, and Ann and Bo at their tables see it", { model: 2, as: "kit", from: "menu?new", does: addItem("Cake", 4), seen: { kit: "menu", ann: "menu", bo: "menu" } }),
    kitTakesToast: story("Kit takes Toast off the menu, and Ann and Bo see it gone", { model: 2, as: "kit", from: "menu?confirm=2", does: { doc: "menu", ops: [{ op: "remove", path: "/items/2" }] }, seen: { kit: "menu", ann: "menu", bo: "menu" } }),
    // an order keeps its dish's surrogate (its name and price, copied as it was ordered): the dish
    // taken off, Ann's invoice still says Soup at £5.50, so only her menu changes
    kitTakesSoup: story("Kit takes Soup off the menu after Ann has ordered it, and Ann and Bo see it gone from the menu; her invoice still says Soup", { model: 2, premise: ordered, as: "kit", from: "menu?confirm=1", does: { doc: "menu", ops: [{ op: "remove", path: "/items/1" }] }, seen: { kit: "menu", ann: "menu", bo: "menu" } }),

    // ── coming in, and being seated ──
    cyScansCode: story("Cy scans the code on Table 3, and her page says she is waiting there", { model: 3, as: "cy", does: post("/scan", { table: "3" }), offPage: true, seen: ["cy"] }),
    moSeatsTable: story("Mo seats Table 1 and opens its invoice, and Ann at Table 1 sees it open; Bo at Table 2 is not told", { model: 4, as: "mo", from: "tables?table=1", does: seat(1), seen: { mo: "tables?table=1", ann: "" }, untold: ["bo"] }),
    moCannotOpenSecond: story("Mo cannot open a second invoice on Table 1 while its first is unpaid", { model: 5, premise: seated, as: "mo", from: "tables?table=1", cannot: seat(1), told: "The manager cannot open an invoice on a table that already has an unpaid one" }),

    // ── ordering, cooking, placing ──
    annOrdersSoup: story("Ann orders Soup onto her invoice, and Kit sees it in the kitchen and Mo at her table", { model: 6, premise: seated, as: "ann", from: "menu?item=1", does: order(1, 1), seen: { ann: "invoice", kit: "orders", mo: "tables?table=1" } }),
    boOrdersCoffee: story("Bo orders Coffee at Table 2, and Kit sees it; Ann at Table 1 is not told", { model: 6, premise: { mo: [seat(2)] }, as: "bo", from: "menu?item=3", does: order(1, 3), seen: { bo: "invoice", kit: "orders" }, untold: ["ann"] }),
    kitSaysAnn: story("Kit says Ann's Soup is ready, and Mo sees it ready to take", { model: 7, premise: ordered, as: "kit", from: "orders?order=1", does: status("floor", 1, "ready"), seen: { kit: "orders", mo: "ready", ann: "invoice" } }),
    moTakesAnn: story("Mo takes Ann's Soup to her table and marks it placed", { model: 8, premise: ready, as: "mo", from: "ready?order=1", does: status("floor", 1, "placed"), seen: { mo: "ready", kit: "orders", ann: "invoice" } }),

    // ── paying ──
    annPaysInvoice: story("Ann pays her invoice, and Mo sees it paid and Table 1 free", { model: 9, premise: ordered, as: "ann", from: "invoice", does: pay("table", 1), seen: { ann: "invoice", mo: "tables" } }),
    annCannotAddInvoice: story("Ann cannot add to her invoice once it is paid", { model: 10, premise: { mo: [seat(1)], ann: [pay("table", 1)] }, as: "ann", from: "menu?item=1", cannot: order(1, 1), told: "A customer cannot add to a paid invoice" }),

    // ── nobody does another's job ──
    moCannotSayAnn: story("Mo cannot say Ann's Soup is ready: that is Kit's job", { model: 11, premise: ordered, as: "mo", from: "tables?table=1", cannot: status("floor", 1, "ready"), told: "The manager cannot order, pay or say an order is ready: that is the customer's and the cook's" }),
    moCannotPayAnn: story("Mo cannot pay Ann's invoice", { model: 11, premise: ordered, as: "mo", cannot: pay("table:1", 1) }),
    kitCannotSeatTable: story("Kit cannot seat Table 1: that is Mo's job", { model: 12, as: "kit", cannot: seat(1) }),
    kitCannotMarkAnn: story("Kit cannot mark Ann's ready Soup placed: that is Mo's job", { model: 12, premise: ready, as: "kit", from: "orders?order=1", cannot: status("floor", 1, "placed"), told: "The cook cannot say what tables there are, seat, open invoices, order, pay or place an order: that is the manager's and the customer's" }),
    annCannotPutCake: story("Ann cannot put Cake on the menu", { model: 13, as: "ann", cannot: addItem("Cake", 4) }),
    moCannotPutCake: story("Mo cannot put Cake on the menu: that is Kit's", { model: 14, as: "mo", cannot: addItem("Cake", 4) }),
    annCannotSayOwn: story("Ann cannot say her own Soup is ready", { model: 13, premise: ordered, as: "ann", cannot: status("table", 1, "ready") }),
    // the app's own, told on no model page (`model: false`): someone who is no customer yet, and going
    cyCannotOrder: story("Cy, who has scanned no table, cannot order", { model: false, as: "cy", cannot: order(1, 1) }),

    // ── going ──
    moSignsOut: story("Mo signs out, and is back at the door", { model: false, as: "mo", from: "", does: leave, seen: ["mo"] }),
    annSignsOut: story("Ann signs out, and her page no longer names her table", { model: false, as: "ann", from: "", does: leave, seen: ["ann"] }),
    annCannotMoveHerself: story("Ann cannot move herself to Table 3 over the wire", { model: false, as: "ann", cannot: { doc: "visit", ops: [{ op: "replace", path: "/table", value: "3" }] } }),
  },
} satisfies Stories;
