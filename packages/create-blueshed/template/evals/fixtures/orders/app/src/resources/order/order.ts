import { openDoc, type Doc } from "@blueshed/delta/client";
import { signal } from "@blueshed/railroad";
import type { Catalogue, Kitchen, Order, Orders } from "./order-api";

export const catalogue = openDoc<Catalogue>("catalogue:");
export const kitchen = openDoc<Kitchen>("kitchen:");

// Your order: this page keeps its number, so you come back to it. Until your first Add there is none.
const kept = localStorage.getItem("order");
export const order = signal<Doc<Order> | null>(kept ? openDoc<Order>(`order:${kept}`) : null);

let making: Promise<Doc<Order>> | undefined;

/** Your order, made by your first Add: the server names it (`add /orders/-` takes the next number), and the page keeps it. */
export function yourOrder(): Promise<Doc<Order>> {
  const open = order.peek();
  if (open) return Promise.resolve(open);
  making ??= (async () => {
    const orders = openDoc<Orders>("orders:");
    try {
      await orders.ready;
      const ack = await orders.send([{ op: "add", path: "/orders/-", value: {} }], { inverse: true });
      const { id } = ack.ops[0].value as { id: number };
      localStorage.setItem("order", String(id));
      const doc = openDoc<Order>(`order:${id}`);
      await doc.ready;
      order.set(doc);
      return doc;
    } finally {
      orders.close();
      making = undefined;
    }
  })();
  return making;
}
