// Made by `delta migrations make` from the definitions: what they say beyond the migrations before it.
// By hand: items: text gone and title new: one is the other renamed, so it is a renameColumn (a drop loses its values)
import { renameColumn } from "@blueshed/delta/migrations";

export const changes = [
  renameColumn("items", "text", "title"),
];
