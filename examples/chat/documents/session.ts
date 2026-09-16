import { db } from "../db";
import type { PatchOp } from "../../../src/json-patch";
import { parsePointer } from "../../../src/json-pointer";
import { prefixDoc, record } from "../../../src/ledger";
import { ensureExists } from "./room";

/** The tray's state: what is open on the box, whose drawer, what find says. A visit's, never on the ledger. */
export type Ui = {
  /** The compartment grown into the window. */
  open?: "conversation" | "people" | "rooms";
  /** The person whose drawer is open. */
  focus?: string;
  /** The modal that is open: a new room. */
  new?: "rooms";
  /** Find's word, by the collection's name. */
  filter?: Record<string, string>;
  /** The eye on find: hide what the word misses instead of dimming it. */
  hide?: Record<string, true>;
};

export type SessionDocument = { name: string | null; room: string | null; ui: Ui };

const readStmt = db.query<{ name: string | null; room: string | null; ui: string }, [string]>(`
  SELECT name, room, ui FROM sessions WHERE id = ? AND revoked_at IS NULL
`);
const upsertNameStmt = db.query<unknown, [string, string, number]>(`
  INSERT INTO sessions (id, name, created_at) VALUES (?1, ?2, ?3)
  ON CONFLICT(id) DO UPDATE SET name = ?2, revoked_at = NULL
`);
// Upserts, unlike a plain UPDATE, so joining a room works even for a session
// that never set a name (a document read/patch shouldn't require a hidden call order).
const joinRoomStmt = db.query<unknown, [string, string, number]>(`
  INSERT INTO sessions (id, room, created_at) VALUES (?1, ?2, ?3)
  ON CONFLICT(id) DO UPDATE SET room = ?2
`);
const clearRoomStmt = db.query<unknown, [string]>("UPDATE sessions SET room = NULL WHERE id = ?");
const revokeStmt = db.query<unknown, [number, string]>("UPDATE sessions SET revoked_at = ?, room = NULL, ui = '{}' WHERE id = ?");
const uiStmt = db.query<unknown, [string, string, number]>(`
  INSERT INTO sessions (id, ui, created_at) VALUES (?1, ?2, ?3)
  ON CONFLICT(id) DO UPDATE SET ui = ?2
`);

export function read(id: string): SessionDocument {
  const row = readStmt.get(id);
  return row ? { name: row.name, room: row.room, ui: JSON.parse(row.ui) as Ui } : { name: null, room: null, ui: {} };
}

export type SessionPatchResult = { version: number; applied: PatchOp[] };

// A `replace` inverse can't restore "no value" (patch() treats a blank/null
// value as invalid and ignores it) -- restoring a field that was previously
// unset must be expressed as `remove`, or undo of a session's very first
// name-set or room-join would silently do nothing.
function restoreOp(path: string, value: string | null): PatchOp {
  return value !== null ? { op: "replace", path, value } : { op: "remove", path };
}

const OPENABLE = new Set(["conversation", "people", "rooms"]);

/** One transaction: every statement here, the ledger row, and the version it returns commit together or not at all. */
export const patch = db.transaction(function patch(id: string, ops: PatchOp[], undoes?: number): SessionPatchResult {
  const applied: PatchOp[] = [];
  const recorded: PatchOp[] = []; // a name or a room: on the ledger; the tray's own state is not
  const inverse: PatchOp[] = [];
  let ui: Ui | undefined;

  for (const op of ops) {
    const [field, key] = parsePointer(op.path);
    const before = read(id);
    const removing = op.op === "remove";
    const next: Ui = ui ?? { ...before.ui };

    if (field === "name" && !removing) {
      const name = String(op.value ?? "").trim();
      if (!name) continue;
      upsertNameStmt.run(id, name, Date.now());
      applied.push(op);
      recorded.push(op);
      inverse.unshift(restoreOp("/name", before.name));
      continue;
    } else if (field === "name" && removing) {
      // Logout clears both name and room in one statement (see revokeStmt),
      // so its inverse must restore both, or undo would leave the session
      // named but orphaned from the room it was in.
      revokeStmt.run(Date.now(), id);
      applied.push(op);
      recorded.push(op);
      if (before.room !== null) inverse.unshift(restoreOp("/room", before.room));
      inverse.unshift(restoreOp("/name", before.name));
      ui = undefined;
      continue;
    } else if (field === "room" && !removing) {
      const room = String(op.value ?? "").trim();
      if (!room || room === before.room) continue; // the room you are in already: nothing to do, nothing to undo
      ensureExists(room);
      joinRoomStmt.run(id, room, Date.now());
      applied.push(op);
      recorded.push(op);
      inverse.unshift(restoreOp("/room", before.room));
      // a new room is a new ground, and the conversation is what you came for: it opens; nothing
      // else stays open, and find's word stays the collection's own
      ui = { open: "conversation", filter: next.filter, hide: next.hide };
      continue;
    } else if (field === "room" && removing) {
      clearRoomStmt.run(id);
      applied.push(op);
      recorded.push(op);
      inverse.unshift(restoreOp("/room", before.room));
      ui = { filter: next.filter, hide: next.hide };
      continue;
    } else if (field === "open") {
      // opening a compartment closes any drawer or modal on the last one
      if (removing) delete next.open;
      else if (OPENABLE.has(String(op.value))) next.open = op.value as Ui["open"];
      else continue;
      delete next.focus;
      delete next.new;
    } else if (field === "focus") {
      if (removing) delete next.focus;
      else if (String(op.value ?? "").trim()) next.focus = String(op.value).trim();
      else continue;
    } else if (field === "new") {
      if (removing) delete next.new;
      else if (op.value === "rooms") next.new = "rooms";
      else continue;
    } else if ((field === "filter" || field === "hide") && key) {
      const map = { ...(next[field] ?? {}) } as Record<string, string | true>;
      if (removing) {
        if (!(key in map)) continue;
        delete map[key];
        if (field === "filter" && next.hide && key in next.hide) {
          // closing find forgets the eye too
          const eyes = { ...next.hide };
          delete eyes[key];
          if (Object.keys(eyes).length) next.hide = eyes;
          else delete next.hide;
        }
      } else map[key] = field === "filter" ? String(op.value ?? "") : true;
      if (Object.keys(map).length) (next as Record<string, unknown>)[field] = map;
      else delete next[field];
    } else {
      continue;
    }
    applied.push(op);
    ui = next;
  }

  if (ui !== undefined) uiStmt.run(id, JSON.stringify(cleaned(ui)), Date.now());
  // record() with nothing recorded is the current version, no row: the tray's own state leaves no trace
  const version = record(prefixDoc("session", id), recorded, inverse, id, undoes);
  return { version, applied };
});

/** The ui without its empty keys, so a fresh visit and one that closed everything read the same. */
function cleaned(ui: Ui): Ui {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ui)) if (v !== undefined && !(typeof v === "object" && v !== null && Object.keys(v).length === 0)) out[k] = v;
  return out as Ui;
}
