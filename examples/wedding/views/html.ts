// The kernel's HTML vocabulary (src/html.ts), and the one gesture that is the wedding's own.
import { address } from "../../../src/bento";
import { write } from "../../../src/html";

export { esc, join, write, appletProps, appletWrites } from "../../../src/html";

/** Going to a page is a write to the session: the trail below the root ("" is the box at the root). */
export const nav = (page: string): string => write("session", "replace", "/page", page);

/** Opening something over the page you are on -- a drawer, a modal -- is going to the same page with it named; closing it is going to the page alone. */
export const open = (path: string, what: string, which: string | number = ""): string => nav(address(path, what, which));
