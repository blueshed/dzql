import { joinPath, type DeltaOp } from "@blueshed/delta/core";
import { computed } from "@blueshed/railroad";
import { Plus, X } from "lucide";
import { bento, rowsOf } from "../bento";
import { toast } from "../toast";
import { catalogue, kitchen, order, yourOrder } from "./order";

const { cell, row, tool } = bento();
const items = catalogue.data.map((c) => Object.values(c?.items ?? {}));
const lines = computed(() => Object.values(order.get()?.data.get()?.lines ?? {}));
const item = (id: number) => catalogue.data.get()?.items[id];
const money = (n: number) => n.toFixed(2);
const change = (ops: DeltaOp[]) => yourOrder().then((o) => o.send(ops)).catch(() => toast("Not saved", "alert"));

/** The catalogue on the box: each item, its price, and Add, which puts a line on your order. */
export function CatalogueCell() {
  return cell({
    name: "Catalogue",
    span: 2,
    body: rowsOf(items, (i) => i.id, (i$) =>
      row({
        what: () => i$.get().name,
        state: () => money(i$.get().price),
        act: tool("Add", { icon: Plus, label: `Add ${i$.peek().name}`, on: () => void change([{ op: "add", path: "/lines/-", value: { item: i$.peek().id } }]) }),
      }), "Nothing to order yet."),
  });
}

/** The kitchen on the box, the cook's: each open order, and what is on it. */
export function KitchenCell() {
  const open = kitchen.data.map((k) =>
    Object.values(k?.orders ?? {})
      .map((o) => ({ id: o.id, items: Object.values(k!.lines).filter((l) => l.orders_id === o.id).map((l) => l.item) }))
      .filter((o) => o.items.length > 0),
  );
  return cell({
    name: "Kitchen",
    body: rowsOf(open, (o) => o.id, (o$) => row({ what: () => `Order ${o$.get().id}`, note: () => o$.get().items.map((i) => item(i)?.name ?? "").join(", ") }), "No open orders."),
  });
}
/** Your order on the box: each line named and priced from the catalogue, × to take it off, and the total. */
export function OrderCell() {
  const total = () => lines.get().reduce((sum, l) => sum + (item(l.item)?.price ?? 0), 0);
  const body = (
    <>
      {rowsOf(lines, (l) => l.id, (l$) =>
        row({
          what: () => item(l$.get().item)?.name ?? "",
          state: () => money(item(l$.get().item)?.price ?? 0),
          act: tool("Remove", { icon: X, iconOnly: true, kind: "quiet", on: () => void change([{ op: "remove", path: joinPath("lines", l$.peek().id) }]) }),
        }), "Nothing yet.")}
      {row({ what: "Total", state: () => money(total()), total: true })}
    </>
  );
  return cell({ name: "Your order", count: () => lines.get().length || null, body });
}
