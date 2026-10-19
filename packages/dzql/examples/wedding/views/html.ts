// The kernel's HTML vocabulary (src/rendering/html.ts), and the one gesture that is the wedding's own.
import { address } from "dzql/rendering/bento";
import { go } from "./bento";
export { go };

export { esc, join, write, appletProps, appletWrites } from "dzql/rendering/html";

/** Opening something over the page you are on -- a drawer, a modal -- is going to the same page with it named; closing it is going to the page alone. */
export const open = (path: string, what: string, which: string | number = ""): string => go(address(path, what, which));
