import { activeDocuments, read, serverWrite, settled } from "dzql/rendering/documents";
import type { PatchOp } from "dzql/rendering/json-patch";
import { db } from "./delta";
import { LOOK_FIELDS, type Look } from "./looks";
import { inPhoto, namesRevealed, WEDDING, type Everyone, type Figure } from "./documents/wedding";

// What households see of each other (`everyone:<wedding>`, ../delta.ts), kept true by the server:
// who stands in the photo -- each figure's look, its family, a ghost or not, and a name only once
// the names have come down -- and how many households have claimed each gift, never which. It is
// computed whole from the tables each time a household or the board changes, not nudged by
// increments that could drift, and written as the difference.

const guestsStmt = db.query<Record<string, unknown> & { id: string; name: string; coming: number | null; households_id: string; answer: "yes" | "maybe" | "no" | null }, []>(`
  SELECT g.*, h.answer FROM current_wedding_guests g JOIN current_wedding_households h ON h.id = g.households_id
`);
const takenStmt = db.query<{ gift_id: string; n: number }, []>("SELECT gift_id, COUNT(*) AS n FROM current_wedding_claims GROUP BY gift_id");
const dayStmt = db.query<{ day: string }, [string]>("SELECT day FROM current_wedding_weddings WHERE id = ?");

/** Everyone, as it is now. */
export function everyoneNow(): Everyone {
  const names = namesRevealed(dayStmt.get(WEDDING)?.day ?? "");
  const figures: Record<string, Figure> = {};
  for (const g of guestsStmt.all()) {
    const state = inPhoto(g);
    if (!state) continue;
    const look = Object.fromEntries([...LOOK_FIELDS, "built_at"].map((f) => [f, g[f] ?? null])) as Look;
    figures[g.id] = { household: g.households_id, ghost: state === "ghost", look, ...(names ? { name: g.name } : {}) };
  }
  return { figures, taken: Object.fromEntries(takenStmt.all().map((t) => [t.gift_id, t.n])) };
}

/** The ops that make one map into another: the gone taken out, the changed replaced, the new added. */
function between(field: string, have: Record<string, unknown>, want: Record<string, unknown>): PatchOp[] {
  const ops: PatchOp[] = [];
  for (const key of Object.keys(have)) if (!(key in want)) ops.push({ op: "remove", path: `/${field}/${key}` });
  for (const [key, value] of Object.entries(want)) {
    if (!(key in have)) ops.push({ op: "add", path: `/${field}/${key}`, value });
    else if (JSON.stringify(have[key]) !== JSON.stringify(value)) ops.push({ op: "replace", path: `/${field}/${key}`, value });
  }
  return ops;
}

// One run at a time: each diffs the document as held, so two at once would both take out what has
// gone, and delta refuses the second remove (404), with the rest of its write. A run waits for the
// one before it, and so reads what it wrote.
let running: Promise<unknown> = Promise.resolve();

/** Makes `everyone` what it is. */
export function keepEveryone(): Promise<void> {
  const now = running.then(everyoneKept);
  running = Promise.allSettled([now]); // a run that fails holds up none after it
  return now;
}

async function everyoneKept(): Promise<void> {
  const documents = activeDocuments();
  if (!documents) return;
  const doc = `everyone:${WEDDING}`;
  const have = await settled(documents, () => read<Everyone>(doc));
  const want = everyoneNow();
  const ops = [...between("figures", have.figures, want.figures), ...between("taken", have.taken, want.taken)];
  if (ops.length > 0) await serverWrite(doc, ops);
}
