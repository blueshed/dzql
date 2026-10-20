import { openDoc } from "@blueshed/delta/client";
import type { MessageDoc } from "./message-api";

/**
 * The message document. `message.data` is what the server holds, null until it arrives, and
 * follows every change anyone makes. It is read-only: change it with `message.send(ops)`.
 */
export const message = openDoc<MessageDoc>("message:1");
