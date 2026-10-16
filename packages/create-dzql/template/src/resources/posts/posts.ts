import { openDoc } from "@blueshed/delta/client";
import type { Posts } from "./posts-api";

/** Every post, live: read-only. Opened inside a view, it closes when the view goes. */
export const openPosts = () => openDoc<Posts>("posts:");

/** Your own posts: every change goes through it (`send(ops)`). Opened inside a view, it closes when the view goes. */
export const openMine = (id: number) => openDoc<Posts>(`mine:${id}`);
