import type { Resource } from "dzql/rendering/resources/resource";

/** Who stands in the photo and how many have claimed each gift (`everyone:<id>`): live, kept by the server (../../everyone.ts). */
export const everyone: Resource = { docType: "everyone", kind: "memory", resolveDoc: () => undefined };
