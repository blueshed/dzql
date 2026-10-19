import { read as readDoc } from "dzql/rendering/documents";
import { docs, type DoorDoc } from "../../model/types";
import { register } from "../../store";

// The door: every table, by its name alone (the model's `door`, a list holding only `name`), for
// whoever has come in and not yet scanned a code. Nobody writes it: the floor does, and it is told.
register(docs.filter((d) => d.prefix === "door:"));

/** The tables, by name, as the door lists them. */
export function read(): { id: string; name: string }[] {
  return Object.values(readDoc<DoorDoc>("door:").tables ?? {})
    .map((t) => ({ id: String(t.id), name: t.name ?? "" }))
    .sort((a, b) => Number(a.id) - Number(b.id));
}
