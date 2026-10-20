import type { Resource } from "dzql/rendering/resources/resource";

/** What a visitor without a code reads (`welcome:<id>`): the wedding's own row. */
export const welcome: Resource = { docType: "welcome", resolveDoc: () => undefined };
