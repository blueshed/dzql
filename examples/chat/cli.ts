import type { PatchOp } from "../../src/json-patch";

// This example's own short verbs, loaded by src/cli.ts (via ETA_EXAMPLE) and
// tried after the kernel's own doc-agnostic commands (inspect/watch/undo/
// write). No database import here on purpose -- src/cli.ts loads this file
// just to build wire ops, never to read or write anything itself.
export const aliases: Record<string, (args: string[]) => { doc: string; ops: PatchOp[] }> = {
  name: (args) => ({ doc: "session", ops: [{ op: "replace", path: "/name", value: args.join(" ") }] }),
  room: (args) => ({ doc: "session", ops: [{ op: "replace", path: "/room", value: args.join(" ") }] }),
  leave: () => ({ doc: "session", ops: [{ op: "remove", path: "/room" }] }),
  logout: () => ({ doc: "session", ops: [{ op: "remove", path: "/name" }] }),
  send: (args) => ({ doc: "room", ops: [{ op: "add", path: "/transcript/-", value: args.join(" ") }] }),
};
