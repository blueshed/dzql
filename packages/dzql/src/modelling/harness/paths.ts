import { escapeSegment, joinPath, splitPath } from "@blueshed/delta/core";

// The paths in a document, as JSON Pointers, for the stories (src/modelling/harness.ts): every path
// in one, what is there, and a path with each member of a collection as any one -- what a hidden
// verb is asked of, and what a control the wire refuses is held to.

/** Every path in a document, as JSON Pointers: the whole (""), each member of each object and array, and an array's end (`-`), where an append goes. */
export function pathsIn(value: unknown, at = ""): string[] {
  if (typeof value !== "object" || value === null) return [at];
  if (Array.isArray(value)) return [at, ...value.flatMap((v, i) => pathsIn(v, `${at}/${i}`)), `${at}/-`];
  return [at, ...Object.entries(value).flatMap(([key, v]) => pathsIn(v, `${at}/${escapeSegment(key)}`))];
}

/** A JSON Pointer's keys, as delta reads them (`splitPath`); undefined for one that is no pointer. */
export function keysOf(path: string): string[] | undefined {
  try {
    return splitPath(path);
  } catch {
    return undefined;
  }
}

/** What is at a JSON Pointer in a document, if anything; at an array's end (`-`), its first member, the shape an append takes. */
export function valueAt(value: unknown, path: string): unknown {
  const keys = keysOf(path);
  if (!keys) return undefined;
  for (const key of keys) {
    if (typeof value !== "object" || value === null) return undefined;
    value = Array.isArray(value) && key === "-" ? value[0] : (value as Record<string, unknown>)[key];
  }
  return value;
}

/**
 * A path as the document holds it, as delta takes one: a single document's root row named by its id
 * (`/messages/1/text`, through `message:1`, whose root is the row `{ id: 1, text }`) is the root the
 * document holds (`/messages/text`). Any other path is as it is.
 */
export function asHeld(doc: unknown, path: string): string {
  const keys = keysOf(path);
  if (!keys || keys.length < 2) return path;
  const root = valueAt(doc, joinPath(keys[0]!));
  const byId = typeof root === "object" && root !== null && !Array.isArray(root) && Object.hasOwn(root, "id") && String((root as { id: unknown }).id) === keys[1];
  return byId ? joinPath(keys[0]!, ...keys.slice(2)) : path;
}

/** Does a document hold something at a JSON Pointer: each step a key of what is there, an array's by its index? */
export function holds(value: unknown, path: string): boolean {
  const keys = keysOf(path);
  if (!keys) return false;
  for (const key of keys) {
    if (typeof value !== "object" || value === null || !Object.hasOwn(value, key) || (Array.isArray(value) && !/^(0|[1-9]\d*)$/.test(key))) return false;
    value = (value as Record<string, unknown>)[key];
  }
  return true;
}

/**
 * A path with each member of a collection in it as any one (`*`, as an applet names one): an id (a
 * run of digits), or a key of an object `doc` keeps rows under, objects of the same fields.
 * `/guests/0/coming` and `/guests/2/coming` are one verb, and so are the market's `/ALPH/price`
 * and `/BRVO/price`.
 */
export function anyOne(path: string, doc?: unknown): string {
  let at = doc;
  return path
    .split("/")
    .map((key, i) => {
      if (i === 0) return key;
      const shapes = typeof at === "object" && at !== null && !Array.isArray(at) ? Object.values(at).map((v) => (typeof v === "object" && v !== null && !Array.isArray(v) ? Object.keys(v).sort().join() : undefined)) : [];
      // every member an object of the same fields; fields, not ids: a list document's one table, its rows by number, is a table, not a row
      const rows = shapes.length > 0 && shapes.every((s) => s !== undefined && s === shapes[0]) && shapes[0]!.split(",").some((f) => f !== "" && !/^\d+$/.test(f));
      at = valueAt(at, `/${key}`);
      return key !== "-" && (rows || /^\d+$/.test(key)) ? "*" : key; // the end of a list is where an append goes, not a member
    })
    .join("/");
}
