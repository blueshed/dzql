import { allOpenSockets } from "../../src/compartments/audience";
import { activeDocuments, read, serverWrite, settled } from "../../src/documents";
import type { PatchOp } from "../../src/json-patch";
import { db } from "./delta";
import * as sessionDoc from "./documents/session";

// Who is in a room, and which rooms there are, are live (../delta.ts): the server keeps them true
// from what is -- the open connections, and each one's session -- computed whole each time
// something moves, not nudged by increments that could drift. A room is there while someone is
// in it or something has been said in it.

const pointer = (key: string): string => key.replaceAll("~", "~0").replaceAll("/", "~1");

/** Rooms this server has written presence into, so an emptied one is emptied. */
const kept = new Set<string>();

/** Who is where now: each open connection's session, one name per room however many tabs. */
async function whoIsWhere(): Promise<Map<string, Set<string>>> {
  const documents = activeDocuments()!;
  const rooms = new Map<string, Set<string>>();
  for (const ws of allOpenSockets()) {
    const { name, room } = await settled(documents, () => sessionDoc.read(ws.data.sessionId));
    if (name && room) rooms.set(room, (rooms.get(room) ?? new Set()).add(name));
  }
  return rooms;
}

/** The keys of a live document's map, as held. */
async function keys(doc: string, field: string): Promise<string[]> {
  const value = await settled(activeDocuments(), () => read<Record<string, Record<string, true>>>(doc));
  return Object.keys(value?.[field] ?? {});
}

/** The ops that make `have` into `want`: the gone taken out, the new added at the end. */
function between(field: string, have: string[], want: Set<string>): PatchOp[] {
  return [
    ...have.filter((k) => !want.has(k)).map((k): PatchOp => ({ op: "remove", path: `/${field}/${pointer(k)}` })),
    ...[...want].filter((k) => !have.includes(k)).map((k): PatchOp => ({ op: "add", path: `/${field}/${pointer(k)}`, value: true })),
  ];
}

/** Makes every room's people what they are, then the list of rooms. */
export async function keepPresence(): Promise<void> {
  if (!activeDocuments()) return;
  const where = await whoIsWhere();
  for (const room of new Set([...kept, ...where.keys()])) {
    const want = where.get(room) ?? new Set<string>();
    const ops = between("people", await keys(`here:${room}`, "people"), want);
    if (ops.length > 0) await serverWrite(`here:${room}`, ops);
    if (want.size > 0) kept.add(room);
    else kept.delete(room);
  }
  await keepLobby(where);
}

const roomsSpokenIn = db.query<{ room: string }, []>("SELECT DISTINCT rooms_id AS room FROM chat_messages");

/** Makes the list of rooms what it is: where something has been said, and where someone is. */
export async function keepLobby(where?: Map<string, Set<string>>): Promise<void> {
  if (!activeDocuments()) return;
  const rooms = new Set([...roomsSpokenIn.all().map((r) => r.room), ...(where ?? (await whoIsWhere())).keys()]);
  const ops = between("rooms", await keys("lobby:all", "rooms"), rooms);
  if (ops.length > 0) await serverWrite("lobby:all", ops);
}
