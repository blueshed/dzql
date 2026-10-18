import type { Resource } from "dzql/rendering/resources/resource";

// The door's resource: read by anyone, written by nobody.
export const door: Resource = {
  docType: "door",
  resolveDoc: () => "",
  permit: () => false,
};
