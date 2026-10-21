/**
 * Board: the server side of `board:<id>`, one board with its columns and cards. Three
 * collections in a parent chain, behind the document:
 *
 *   kanban_boards   (root)
 *   kanban_columns  parent: kanban_boards  → FK kanban_boards_id
 *   kanban_cards    parent: kanban_columns → FK kanban_columns_id
 *
 * `createTables(db, schema)` makes the tables in a SQLite database in memory,
 * thrown away when the server stops (a kept file's tables are its migrations':
 * the lists example); `registerDocs` then
 * opens `board:1` by walking the parent keys down from the board, and applies
 * each op to the table its path names. No hand-written SQL in this example.
 * (On Postgres the same schema and documents run on dzql: `dzql/postgres`.)
 *
 * The types are shared: the client imports them as types only (`import type`),
 * so none of the server code below reaches the browser bundle.
 */
import { Database } from "bun:sqlite";
import type { WsServer } from "@blueshed/delta/server";
import { createTables, defineDoc, defineSchema, importTables, registerDocs } from "@blueshed/delta/sqlite";

export interface Board  { id: number; owner_id: number; title: string }
export interface Column { id: number; kanban_boards_id: number; owner_id: number; title: string; position: number }
export interface Card   { id: number; kanban_columns_id: number; owner_id: number; title: string; position: number }

/** What `board:1` holds: the board, its columns and their cards, each by id. */
export interface BoardDoc {
  kanban_boards:  Record<number, Board>;
  kanban_columns: Record<number, Column>;
  kanban_cards:   Record<number, Card>;
}

export const schema = defineSchema({
  kanban_boards: {
    columns: {
      owner_id: "integer",
      title:    "text",
    },
    temporal: false,
  },
  kanban_columns: {
    columns: {
      owner_id: "integer",
      title:    "text",
      position: "integer",
    },
    parent:   "kanban_boards",   // → kanban_boards_id FK
    temporal: false,
  },
  kanban_cards: {
    columns: {
      owner_id: "integer",
      title:    "text",
      position: "integer",
    },
    parent:   "kanban_columns",  // → kanban_columns_id FK (two hops from board)
    temporal: false,
  },
});

/**
 * The doc: `board:<id>`. Scoped-single — one board with its columns and
 * cards included: the root row, then the parent chain down to the two-hop
 * `kanban_cards` of this board's columns.
 */
export const docs = [
  defineDoc("board:", {
    root: "kanban_boards",
    include: ["kanban_columns", "kanban_cards"],
    scope: { id: ":id" },   // single-mode: scope the root by the {id} in the doc name
  }),
];

/** The tables made in memory, one board seeded (`board:1`, three columns, five cards) and its document registered; the database, for the server to close. */
export function boardApi(ws: WsServer): Database {
  const db = new Database(":memory:");   // fresh each run
  createTables(db, schema);
  importTables(db, schema, {
    tables: {
      kanban_boards: [{ id: 1, owner_id: 1, title: "Product roadmap" }],
      kanban_columns: [
        { id: 1, kanban_boards_id: 1, owner_id: 1, title: "Todo", position: 0 },
        { id: 2, kanban_boards_id: 1, owner_id: 1, title: "In progress", position: 1 },
        { id: 3, kanban_boards_id: 1, owner_id: 1, title: "Done", position: 2 },
      ],
      kanban_cards: [
        { id: 1, kanban_columns_id: 1, owner_id: 1, title: "write the kanban example", position: 0 },
        { id: 2, kanban_columns_id: 1, owner_id: 1, title: "sketch 0.4 roadmap", position: 1 },
        { id: 3, kanban_columns_id: 2, owner_id: 1, title: "review RLS policy", position: 0 },
        { id: 4, kanban_columns_id: 3, owner_id: 1, title: "ship v0.3.0", position: 0 },
        { id: 5, kanban_columns_id: 3, owner_id: 1, title: "capture bench results", position: 1 },
      ],
    },
  });
  registerDocs(ws, db, schema, docs);
  return db;
}
