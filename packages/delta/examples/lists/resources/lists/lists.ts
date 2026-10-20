import { openDoc } from "@blueshed/delta/client";
import type { ListDoc, Mine } from "./lists-api";

/** The lists `person` is on (their memberships), live. Opened inside a view, it closes when the view goes. */
export const openMine = (person: number) => openDoc<Mine>(`mine:${person}`);

/** One list, who is on it and its items, live. */
export const openList = (id: number) => openDoc<ListDoc>(`list:${id}`);
