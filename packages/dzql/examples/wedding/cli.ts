import type { Aliases } from "dzql/rendering/cli/commands";
import type { PatchOp } from "dzql/rendering/json-patch";

// This example's own short verbs, loaded by src/cli.ts (via ETA_EXAMPLE=wedding) and tried after
// the kernel's own doc-agnostic commands (inspect/watch/undo/write). No database import here on
// purpose -- src/cli.ts loads this file just to build wire ops, never to read or write anything.
const session = (op: PatchOp) => ({ doc: "session", ops: [op] });
const household = (op: PatchOp) => ({ doc: "household", ops: [op] });
const board = (op: PatchOp) => ({ doc: "board", ops: [op] });

export const aliases: Aliases = {
  /** enter <code> -- open a household (or the couple's board) by its code. */
  enter: (args) => session({ op: "replace", path: "/code", value: args.join(" ") }),
  leave: () => session({ op: "remove", path: "/code" }),
  /** answer yes|maybe|no */
  answer: (args) => household({ op: "replace", path: "/answer", value: args[0] ?? "" }),
  /** say <words> -- the household's message to the couple. */
  say: (args) => household({ op: "replace", path: "/message", value: args.join(" ") }),
  /** coming <guest id> yes|no */
  coming: (args) => household({ op: "replace", path: `/guests/${args[0] ?? ""}/coming`, value: args[1] ?? "" }),
  /** ask <name> -- ask to bring someone. */
  ask: (args) => household({ op: "add", path: "/asks/-", value: args.join(" ") }),
  /** claim <gift id> / unclaim <gift id> */
  claim: (args) => household({ op: "add", path: "/claims/-", value: args[0] ?? "" }),
  unclaim: (args) => household({ op: "remove", path: `/claims/${args[0] ?? ""}` }),
  /** reply <household id> <ask id> yes|no -- the couple's. */
  reply: (args) => board({ op: "replace", path: `/households/${args[0] ?? ""}/asks/${args[1] ?? ""}/reply`, value: args[2] ?? "" }),
  /** invite <email> [names, comma-separated] -- the couple's. */
  invite: (args) => board({ op: "add", path: "/households/-", value: { email: args[0] ?? "", names: args.slice(1).join(" ") } }),
};
