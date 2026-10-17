/**
 * The adapter a backend supplies to the path cases, and the law each ends on:
 * every copy still open, with everything it was told applied, equals a fresh
 * open. Part of `pathCases` (`../path.ts`).
 */
import { expect } from "bun:test";
import { applyOps } from "../../core";
import { type Snapshot } from "../../schema";
import { waitFor } from "../support";

// ---------------------------------------------------------------------------
// The adapter a backend supplies
// ---------------------------------------------------------------------------

/** One process: delta over the backend, in-process (`createLocal()`), and everything it published. */
export interface PathProcess {
  call(action: string, msg: Record<string, unknown>): Promise<any>;
  heard: { channel: string; data: any }[];
}

export interface PathBackend {
  /** The process the cases write through: the schema and seed in place, a ledger kept. */
  process: PathProcess;
  /** Resolve once everything a write set going has been delivered. */
  quiet(): Promise<void>;
  /** Every row the backend holds, as `importTables` takes them: what carries to the next backend. */
  exportTables(): Promise<Snapshot>;
  /**
   * The store itself sets a household's t to its email in capitals whenever
   * the row is written (a trigger), until the answer is called. A backend no
   * SQL reaches -- the JSON file, whose SQLite is its own -- leaves it out.
   */
  storeSetsT?(): Promise<() => Promise<void>>;
}

// ---------------------------------------------------------------------------
// Reading what was told
// ---------------------------------------------------------------------------

/** A copy as the law compares it: its version is not its content. */
export function content(doc: any): any {
  if (doc === null || typeof doc !== "object") return doc;
  const { _v, ...rest } = doc;
  return rest;
}

/** The ops each message on `channel` carried, in order. */
export const told = (p: PathProcess, channel: string): unknown[][] =>
  p.heard.filter((h) => h.channel === channel).map((h) => h.data.ops);

/** The ops `channel` was told, as one list. */
export const toldOps = (p: PathProcess, channel: string): any[] => told(p, channel).flat();

// ---------------------------------------------------------------------------
// The law
// ---------------------------------------------------------------------------

/** Open `docs` and keep what each opened, to hold against what it is told. */
export async function openAll(p: PathProcess, docs: string[]): Promise<Map<string, any>> {
  const copies = new Map<string, any>();
  for (const doc of docs) {
    const res = await p.call("open", { doc });
    if (res.error) throw new Error(`open ${doc}: ${JSON.stringify(res.error)}`);
    copies.set(doc, structuredClone(res.result));
  }
  p.heard.length = 0; // only what the writes tell counts
  return copies;
}

/**
 * Each copy, with what its channel was told since `openAll` applied in order,
 * equals a fresh open. A document whose root row is gone opens as 404; its
 * copy must then have been told its root is null -- or, a custom document whose
 * read is gone, let go (404), and told nothing more. The fresh open is a real
 * one: the document is closed first, so no backend answers from a copy of its
 * own -- a custom document's is the one it keeps from what it told.
 */
export async function assertCopiesHold(b: PathBackend, copies: Map<string, any>): Promise<void> {
  await b.quiet();
  for (const [doc, opened] of copies) {
    const copy = structuredClone(opened);
    const heard = b.process.heard.filter((m) => m.channel === doc);
    // let go (a custom document whose read is gone: 404): it is no longer open, and hears nothing after
    const gone = heard.findIndex((h) => h.data.error);
    if (gone >= 0) {
      expect({ doc, told: heard.slice(gone).map((h) => h.data) }).toEqual({ doc, told: [{ doc, error: { code: 404, message: "Not found" } }] });
      continue;
    }
    for (const h of heard) applyOps(copy, h.data.ops);
    await b.process.call("close", { doc });
    const fresh = await b.process.call("open", { doc });
    if (fresh.error?.code === 404) {
      const root = Object.keys(opened).find((k) => opened[k] && typeof opened[k] === "object" && "id" in opened[k]);
      expect({ doc, root: root ? copy[root] : copy }).toEqual({ doc, root: null });
      continue;
    }
    expect({ doc, copy: content(copy) }).toEqual({ doc, copy: content(fresh.result) });
  }
}

// ---------------------------------------------------------------------------
// Writing, and waiting to be told
// ---------------------------------------------------------------------------

/** Write through `doc`, and fail the case if the write is refused. */
export async function write(p: PathProcess, doc: string, ops: unknown[], extra: Record<string, unknown> = {}): Promise<any> {
  const res = await p.call("delta", { doc, ops, ...extra });
  if (res.error) throw new Error(`delta ${doc}: ${JSON.stringify(res.error)}`);
  return res.result;
}

/**
 * `channel` was told exactly `expected`, message by message: waits until as
 * many messages as expected have come, then lets the backend go quiet and
 * compares the lot, so a late extra message fails too.
 */
export async function expectTold(b: PathBackend, channel: string, expected: unknown[][]): Promise<void> {
  await waitFor(() => told(b.process, channel).length >= expected.length, { timeout: 3000 }).catch(() => {});
  await b.quiet();
  expect({ channel, told: told(b.process, channel) }).toEqual({ channel, told: expected });
}

/** Nothing was told on any of `channels`. */
export async function expectSilent(b: PathBackend, ...channels: string[]): Promise<void> {
  await b.quiet();
  for (const channel of channels) expect({ channel, told: told(b.process, channel) }).toEqual({ channel, told: [] });
}

// ---------------------------------------------------------------------------
// Carrying the data to the next place
// ---------------------------------------------------------------------------

/**
 * Every document of the seed, as a process opens it: what must read the same
 * after the data is carried to another backend.
 */
export const everyDocument = ["fo-board:1", "fo-board:2", "fo-menu:1", "fo-household:1", "fo-course:1", "fo-notes:1", "fo-all-courses:", "fo-courses-like:So"];

/** Open each of `docs` and answer what each read, without its version. */
export async function readAll(p: PathProcess, docs = everyDocument): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const doc of docs) out[doc] = content((await p.call("open", { doc })).result);
  return out;
}
