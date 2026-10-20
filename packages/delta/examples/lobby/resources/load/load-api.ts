/**
 * Load: `load:server`, the machine's load, a source document: its truth is outside the app (the
 * operating system). One reading shared by everyone watching, taken when the first opens it, then
 * every two seconds while anyone watches, and stopped when the last leaves. With no reading for
 * ten seconds it says itself `stale`, so a page never shows an old number as now. Read only.
 */
import { loadavg } from "node:os";
import { registerSource } from "@blueshed/delta/kinds";
import type { WsServer } from "@blueshed/delta/server";

/** What `load:server` holds: the reading (the last minute's load average), when it was taken, and whether it is too old to trust. */
export interface Load { reading: number | null; at: number | null; stale: boolean }

/** The source on the socket; its `stopAll`, for the server to call when it stops. */
export function loadApi(ws: WsServer) {
  return registerSource<number>(ws, {
    prefix: "load:",
    read: () => Math.round(loadavg()[0]! * 100) / 100,
    every: 2_000,
    stale: 10_000,
  });
}
