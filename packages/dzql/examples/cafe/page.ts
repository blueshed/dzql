import { layers, parseAddress, type Crumb } from "dzql/rendering/bento";
import { surfaces } from "./surfaces";
import { read as floorOf } from "./resources/floor/floor-api";
import { tables, type Part } from "./resources/floor/floor-view";
import { read as kitchenOf } from "./resources/kitchen/kitchen-api";
import { orders, ready } from "./resources/kitchen/kitchen-view";
import { read as menuOf } from "./resources/menu/menu-api";
import { kept, ordering } from "./resources/menu/menu-view";
import { openInvoice, read as tableOf } from "./resources/table/table-api";
import { invoice } from "./resources/table/table-view";
import { read as visitOf } from "./resources/visit/visit-api";
import { read as doorOf } from "./resources/door/door-api";
import { door } from "./resources/door/door-view";
import { links } from "./links";

// The cafe's page, drawn by the server for whoever is looking, from the parts each resource draws
// (`resources/<name>/<name>-view.ts`). Nobody yet: the door, a way in for each of the staff and
// each table. The manager's box: the tables (the floor) and what is ready to take (the kitchen,
// each by its table's name at the door). The cook's: the orders still to cook (the kitchen) and the
// menu. A customer's: the menu to order from, and their invoice to pay.

const { boxPage, go, site } = surfaces;

/** The parts in front of a person, by their role. */
function partsOf(sessionId: string, role: "manager" | "cook" | "customer", table: string | null, page: string): { home: string; parts: Part[] } {
  const at = parseAddress(page);
  if (role === "manager") {
    const f = floorOf();
    return { home: "The floor", parts: [tables(f, at, sessionId), ready(kitchenOf(), doorOf(), at, sessionId)] };
  }
  if (role === "cook") return { home: "The kitchen", parts: [orders(kitchenOf(), doorOf(), at, sessionId), kept(menuOf(), at, sessionId)] };
  const t = tableOf(table!);
  return { home: t.table.name, parts: [ordering(menuOf(), openInvoice(t.invoices, t.table.id), at, sessionId), invoice(t, at)] };
}

/** The page for a session, where its tab stands (`page`, the tab's address). */
export function render(sessionId: string, page: string): string {
  const v = visitOf(sessionId);
  if (!v.role) return layers(door(links.ways(), doorOf()), "", "");
  const { home, parts } = partsOf(sessionId, v.role, v.table, page);
  const shown = parts.find((p) => p.open);
  const trail: Crumb[] = shown ? [{ label: home, back: go("") }, { label: shown.title }] : [{ label: home }];
  return site(page, layers(boxPage(trail, [], parts.map((p) => p.cell), shown?.open), shown?.sheet ?? "", shown?.modal ?? ""));
}
