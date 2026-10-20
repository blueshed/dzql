import type { Resource } from "dzql/rendering/resources/resource";

/** What a household reads of the wedding (`wedding:<id>`): written by the couple, through the board, and by nobody from the wire. */
export const wedding: Resource = { docType: "wedding", resolveDoc: () => undefined };
