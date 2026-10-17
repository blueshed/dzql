import { activeDocuments, settled } from "dzql/rendering/documents";
import type { PatchOp } from "dzql/rendering/json-patch";
import * as boardDoc from "./documents/board";
import * as householdDoc from "./documents/household";
import * as weddingDoc from "./documents/wedding";
import { whose } from "./documents/session";

// For tests and scripts, with a server running: a write as the couple or a household would make
// it from the wire, shaped the same way, written as nobody's session (so no one's Undo walks it),
// and told to every open page like any other change. And the documents as they are now.

const documents = () => {
  const d = activeDocuments();
  if (!d) throw new Error("no documents: start the wedding's server first");
  return d;
};

/** Writes `ops` as the couple would. */
export async function asCouple(ops: PatchOp[]): Promise<void> {
  const shaped = await settled(documents(), () => boardDoc.shape(boardDoc.held(), ops));
  if (shaped.length > 0) await documents().write(`board:${weddingDoc.WEDDING}`, shaped as never, { identity: "setup", cursor: "setup" });
}

/** Writes `ops` as the household with this code would. */
export async function asHousehold(code: string, ops: PatchOp[]): Promise<void> {
  const id = whose(code)!.id;
  const shaped = await settled(documents(), () =>
    householdDoc.shape(householdDoc.read(id)!, { courses: weddingDoc.courses(), gifts: weddingDoc.gifts().map(({ id, shared }) => ({ id, shared })) }, ops),
  );
  if (shaped.length > 0) await documents().write(`household:${id}`, shaped as never, { identity: "setup", cursor: "setup" });
}

/** The board, now. */
export const board = (): Promise<boardDoc.BoardDocument> => settled(documents(), () => boardDoc.read()!);

/** The household with this code, now. */
export const household = (code: string): Promise<householdDoc.HouseholdDocument> => settled(documents(), () => householdDoc.read(whose(code)!.id)!);
