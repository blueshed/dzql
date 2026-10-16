/**
 * The app's tables and documents, made in Postgres: one schema for every resource, and one
 * `generateSql` for every document (dzql compiles them all at once, one app to a database).
 */
import type { Pool } from "pg";
import { applyFramework, applySql, defineSchema, generateSql } from "dzql/postgres";
import { peopleDocs } from "./resources/people/people-api";
import { postsDocs } from "./resources/posts/posts-api";

export const schema = defineSchema({
  people: { columns: { name: "text" }, temporal: false },
  posts: { columns: { author_id: "integer", title: "text", content: "text" }, temporal: false },
});

export const docs = [...peopleDocs, ...postsDocs];

/** Make the tables, and compile the documents: at every start, and before a command. */
export async function prepare(pool: Pool) {
  await applyFramework(pool); // delta's own tables and functions
  await applySql(pool, generateSql(schema, docs)); // the app's tables, and each document compiled
}
