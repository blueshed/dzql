/**
 * A fact from another parent's rows, worked out and never stored: whether a room is taken, and until
 * when, from the open stays, which hang from guests. The rooms' list holds its own rows only (a row
 * has one parent), so the fact is a recompute document over both collections: read again on every
 * write to either, and told to whoever holds it. Kept as a column on the room, written beside each
 * stay (delta #79), it would be a second copy, for the app's writes to keep honest. The stays hold
 * the room once (`unique`), so a room is taken by one stay at a time.
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createLocal } from "../src/server/local";
import { createTables, defineCustomDoc, defineDoc, defineSchema, registerDocs } from "../src/server/sqlite";
import { setLogLevel } from "../src/server/logger";

setLogLevel("silent");

const schema = defineSchema({
  rooms: { columns: { name: "text" }, temporal: false, unique: ["name"] },
  guests: { columns: { name: "text" }, temporal: false },
  stays: {
    parent: "guests",
    columns: { room: "integer", until: "timestamptz", left: "timestamptz?" },
    temporal: false,
    unique: [{ columns: ["room"], whereNull: ["left"] }],
  },
});
const rooms = defineDoc("rooms:", { root: "rooms", include: [] });         // the rooms, as the desk keeps them
const guest = defineDoc("guest:", { root: "guests", include: ["stays"] }); // a guest and their stays

// The desk: every room, each with whether it is taken and until when, from the open stays.
const desk = defineCustomDoc("desk:", {
  watch: ["rooms", "stays"],
  parse: (id: string) => id,
  recompute: (db: Database) => ({
    rooms: Object.fromEntries((db.query(`
      SELECT r.id, r.name, s.id IS NOT NULL AS taken, s.until
        FROM rooms r LEFT JOIN stays s ON s.room = r.id AND s.left IS NULL
       ORDER BY r.id`).all() as any[]).map((r) => [r.id, { ...r, taken: !!r.taken }])),
  }),
});

function setup() {
  const db = new Database(":memory:");
  createTables(db, schema);
  db.run("INSERT INTO rooms (id, name) VALUES (1, 'attic'), (2, 'garden')");
  db.run("INSERT INTO guests (id, name) VALUES (1, 'ann')");
  const local = createLocal();
  const told: any[] = [];
  local.onPublish((channel, data) => { if (channel === "desk:") told.push(data); });
  registerDocs(local.server, db, schema, [rooms, guest], [desk]);
  return { local, told };
}

describe("a fact from another parent's rows, worked out", () => {
  test("a room booked is taken, until its date, on the desk; left, it is free", async () => {
    const { local, told } = setup();
    expect((await local.call("open", { doc: "desk:" })).result.rooms[1]).toEqual({ id: 1, name: "attic", taken: false, until: null });
    await local.call("open", { doc: "guest:1" });
    const booked = await local.call("delta", { doc: "guest:1", ops: [{ op: "add", path: "/stays/-", value: { room: 1, until: "2026-11-01" } }] });
    expect(booked.error).toBeUndefined();
    const taken = told.at(-1).ops[0];
    expect(taken.op).toBe("replace");
    expect(taken.value.rooms[1]).toEqual({ id: 1, name: "attic", taken: true, until: "2026-11-01T00:00:00+00:00" });
    expect(taken.value.rooms[2].taken).toBe(false);

    const [stay] = Object.keys((await local.call("open", { doc: "guest:1" })).result.stays);
    await local.call("delta", { doc: "guest:1", ops: [{ op: "replace", path: `/stays/${stay}/left`, value: "2026-10-20" }] });
    expect(told.at(-1).ops[0].value.rooms[1].taken).toBe(false);
  });

  test("a room taken is refused a second stay, 409, and the desk does not change", async () => {
    const { local, told } = setup();
    await local.call("open", { doc: "desk:" });
    await local.call("open", { doc: "guest:1" });
    await local.call("delta", { doc: "guest:1", ops: [{ op: "add", path: "/stays/-", value: { room: 1, until: "2026-11-01" } }] });
    const again = await local.call("delta", { doc: "guest:1", ops: [{ op: "add", path: "/stays/-", value: { room: 1, until: "2026-12-01" } }] });
    expect(again.error?.code).toBe(409);
    expect(told.at(-1).ops[0].value.rooms[1].until).toBe("2026-11-01T00:00:00+00:00");
  });

  test("a renamed room is renamed on the desk: the list is the rooms' own rows", async () => {
    const { local, told } = setup();
    await local.call("open", { doc: "desk:" });
    await local.call("open", { doc: "rooms:" });
    await local.call("delta", { doc: "rooms:", ops: [{ op: "replace", path: "/rooms/2/name", value: "garden suite" }] });
    expect(told.at(-1).ops[0].value.rooms[2].name).toBe("garden suite");
  });
});
