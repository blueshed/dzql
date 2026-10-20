import { openDoc } from "@blueshed/delta/client";
import type { Catalogue, Kitchen, Order } from "./order-api";

export const catalogue = openDoc<Catalogue>("catalogue:");
export const order = openDoc<Order>("order:1");
export const kitchen = openDoc<Kitchen>("kitchen:");
