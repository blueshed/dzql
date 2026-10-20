import type { Resource } from "dzql/rendering/resources/resource";

/** Which rooms there are: live, kept by the server (../../presence.ts), seen by the pages that show it (the rooms). */
export const lobby: Resource = {
  docType: "lobby",
  kind: "memory",
  resolveDoc: () => undefined,
};
