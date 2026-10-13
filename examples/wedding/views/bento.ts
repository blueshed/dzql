// The surfaces every page is made of are the kernel's (src/bento.ts), bound here to the wedding's
// icons and to the session, the document its page's state is written to. Every gesture is a write
// to the session -- going to a page, opening a drawer, switching a reading -- so the kernel
// renders the result.

import { bento } from "../../../src/bento";
import { icon } from "./icons";

export { choice, prop, rows, type Crumb, type OpenOptions } from "../../../src/bento";

export const { tool, addTool, findControl, collectionPage, row, drawer, addModal, confirmModal, site } = bento({
  icon,
  session: "session",
  leave: { text: "Leave", icon: "log-out", path: "/code" },
});
