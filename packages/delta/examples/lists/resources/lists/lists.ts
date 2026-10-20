import { inject } from "@blueshed/railroad";
import { openDoc, WS } from "@blueshed/delta/client";
import type { ListDoc, Mine } from "./lists-api";

/** The lists `person` is on (their memberships), live. Opened inside a view, it closes when the view goes. */
export const openMine = (person: number) => openDoc<Mine>(`mine:${person}`);

/** One list, who is on it and its items, live. */
export const openList = (id: number) => openDoc<ListDoc>(`list:${id}`);

/** A walk: what it changed, or `conflict` (the paths someone else has changed since: nothing walked), or null (nothing to walk). */
export type Walk = { doc: string; ops: unknown[]; conflict?: string[] } | null;

/**
 * Undo this page's last change, wherever it shows: the ledger walks back what this person wrote
 * on this socket (the cursor), never what anyone else wrote. Its answer comes back through the
 * documents, as every write's does.
 */
export const undo = () => inject(WS).send({ action: "undo" }) as Promise<Walk>;

/** Redo what the last undo took back. */
export const redo = () => inject(WS).send({ action: "redo" }) as Promise<Walk>;
