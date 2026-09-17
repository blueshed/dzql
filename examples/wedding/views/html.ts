// The kernel's HTML vocabulary (src/html.ts), and the one gesture that is the wedding's own.
import { write } from "../../../src/html";

export { esc, join, write } from "../../../src/html";

/** Going to a page is a write to the session: the trail below the root ("" is the box at the root). */
export const nav = (page: string): string => write("session", "replace", "/page", page);
