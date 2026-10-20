import { rows } from "dzql/rendering/bento";
import { write } from "dzql/rendering/html";
import { surfaces } from "../../surfaces";
import { money } from "../floor/floor-api";
import { WORD, type At, type Part } from "../floor/floor-view";
import { openInvoice, total, type TableView } from "./table-api";

// A table's part of the page: the customer's invoice, what is on it, and paying.

const { tool, cell, row, go } = surfaces;

/** Where the customer's invoice stands, in a line. */
export function standing(t: TableView): string {
  const inv = openInvoice(t.invoices, t.table.id);
  const last = inv ?? t.invoices.at(-1);
  const mine = last ? t.orders.filter((o) => o.invoice === last.id) : [];
  return inv ? `${mine.length} ordered, ${money(total(t.orders, inv.id))}` : last ? `paid, ${money(total(t.orders, last.id))}: thank you` : `waiting to be seated at ${t.table.name}`;
}

/** The customer's invoice. */
export function invoice(t: TableView, at: At): Part {
  const inv = openInvoice(t.invoices, t.table.id);
  const last = inv ?? t.invoices.at(-1);
  const mine = last ? t.orders.filter((o) => o.invoice === last.id) : [];
  const said = standing(t);
  const part: Part = { title: "your invoice", cell: cell({ key: "invoice", name: "your invoice", mark: "receipt", count: inv ? mine.length || null : null, opens: go("invoice"), summary: said }) };
  if (at.path !== "invoice") return part;
  part.open = {
    key: "invoice",
    tools: inv ? [tool("Pay", { icon: "credit-card", iconOnly: true, write: write("table", "replace", `/invoices/${inv.id}/paid`, true) })] : [],
    body: rows(mine.map((o) => row({ id: `l${o.id}`, what: o.item, note: money(o.price), state: WORD[o.status] })), inv ? "Nothing ordered yet: the menu is where to order." : "No invoice open.", "invoice-rows"),
    note: said,
  };
  return part;
}
