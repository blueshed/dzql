import { openDoc } from "@blueshed/delta/client";
import type { BoardDoc } from "./board-api";

/**
 * The board document. `board.data` is what the server holds, null until it arrives, and
 * follows every change anyone makes. It is read-only: change it with `board.send(ops)`.
 */
export const board = openDoc<BoardDoc>("board:1");
