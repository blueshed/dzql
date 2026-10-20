import { openDoc } from "@blueshed/delta/client";
import type { Load } from "./load-api";

/** The server's load, live while this page watches it. */
export const load = openDoc<Load>("load:server");
