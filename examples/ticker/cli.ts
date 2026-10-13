import type { Aliases } from "../../src/cli/commands";

// This example's own short verbs, loaded by src/cli.ts (via ETA_EXAMPLE=ticker). No database
// import here on purpose -- this file only builds wire ops.
export const aliases: Aliases = {
  /** add <symbol> -- watch it on this session's board. */
  add: (args) => ({ doc: "watchlist", ops: [{ op: "add", path: "/symbols/-", value: args[0] ?? "" }] }),
  /** drop <index> -- take the symbol at that place off the board. */
  drop: (args) => ({ doc: "watchlist", ops: [{ op: "remove", path: `/symbols/${args[0] ?? ""}` }] }),
  /** city <zone> -- show the time in that city: an IANA zone, "Asia/Tokyo". */
  city: (args) => ({ doc: "clock", ops: [{ op: "replace", path: "/tz", value: args[0] ?? "" }] }),
  /** tick <symbol> <price> -- a tick, by hand. */
  tick: (args) => ({ doc: "ticker", ops: [{ op: "replace", path: `/${(args[0] ?? "").toUpperCase()}/price`, value: Number(args[1]) }] }),
};
