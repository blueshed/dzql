/**
 * Posts — what people write for everyone to read. Two documents over the one table:
 *
 * - `posts:`, every post: what everyone signed in reads, live. Nobody writes through it.
 * - `mine:<id>`, the posts of the person signed in as `id`, theirs alone (`owns`): every post is
 *   written, changed and taken away through it. A post added through it is theirs: its author is
 *   the name's, never the value's (the document's scope).
 *
 * A change through `mine:` reaches every page holding `posts:` too: delta tells each document
 * holding a row of what changed for it.
 *
 * The types are shared: the client imports them as types only (`import type`).
 */
import type { Pool } from "pg";
import type { DeltaAuth } from "@blueshed/delta/auth";
import { defineDoc, docTypeFromDef, type DocType } from "dzql/postgres";
import type { Person } from "../people/people-api";

export type Post = { id: number; author_id: number; title: string; content: string };
/** `posts:` and `mine:<id>` alike: the posts, by id. */
export type Posts = { posts: Record<string, Post> };

export const everyPost = defineDoc("posts:", { root: "posts", include: [] });
export const myPosts = defineDoc("mine:", { root: "posts", include: [], scope: { author_id: ":author" } });
export const postsDocs = [everyPost, myPosts];

/** Refused: a change to `posts:` is made through your own, `mine:<you>`. */
const readOnly = <C, I>(type: DocType<C, I>): DocType<C, I> => ({
  ...type,
  async apply() {
    throw Object.assign(new Error("posts are written through your own: mine:<you>"), { code: 403 });
  },
});

/** The documents' types: everyone reads `posts:`; `mine:<id>` is `id`'s alone. */
export const postsTypes = (pool: Pool, auth: DeltaAuth<Person>) => [
  readOnly(docTypeFromDef<Person>(everyPost, pool, { auth, shared: true })),
  docTypeFromDef<Person>(myPosts, pool, { auth, owns: (me, name) => name === `mine:${me.id}` }),
];
