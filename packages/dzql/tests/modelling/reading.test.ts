import { expect, test } from "bun:test";
import { columnOf, fieldOf, knownType, readingOf, refOf, says, touched, typeOf, valueOf } from "../../src/modelling/reading";

// One reading of a model, which the checks, the heart, the definitions, the proof and the guards take.
const f = (name: string, type?: string) => ({ name, ...(type && { type }) });
const cafe = readingOf({
  stories: [
    { id: 2, text: "The manager seats a table", actor: "manager", writes: [{ entity: "tables", op: "replace", path: "seated", to: "true" }] },
    { id: 1, text: "The manager adds a table", actor: "manager", kind: "does", writes: [{ entity: "tables", op: "add" }] },
    { id: 3, text: "The cook cannot seat a table", actor: "cook", kind: "cannot", writes: [{ entity: "tables", op: "replace", path: "seated" }] },
    { id: 4, text: "A customer signs in", actor: "customer", post: "/login", writes: [{ entity: "logins", op: "add" }], touches: ["visits"] },
  ],
  documents: {
    "1": { id: 1, name: "floor", root: "cafes", holds: { cafes: { parent: null }, tables: { parent: "cafes", fields: [f("seated", "boolean"), f("seats", "int")] } }, held_by: ["manager"], stories: [1, 2, 3] },
    "2": { id: 2, name: "table", root: "tables", holds: { tables: { parent: null, fields: [f("seated", "text")] } }, held_by: ["cook"], stories: [3] },
    "3": { id: 3, name: "visit", root: "visits", own: 1, stories: [4] },
    "4": { id: 4, name: "kitchen", root: "orders", holds: { orders: { parent: null }, tables: { parent: "orders" } } },
  },
});

test("the stories in the order told, each a does unless it cannot; a form posted is no one's write on a document", () => {
  expect(cafe.stories.map((s) => [s.id, s.kind])).toEqual([["1", "does"], ["2", "does"], ["3", "cannot"], ["4", "does"]]);
  expect(cafe.doing.map((s) => s.id)).toEqual(["1", "2"]);
  expect(cafe.added).toEqual(new Set(["tables"]));
  expect(touched(cafe.stories[3]!)).toEqual(["visits", "logins"]);
});

test("an entity hangs from the first parent a document gives it, its fields the first type said; a second parent is a clash", () => {
  const tables = cafe.entities.get("tables")!;
  expect(tables.parent).toBe("cafes");
  expect([...tables.fields]).toEqual([["seated", "boolean"], ["seats", "int"]]);
  expect(tables.documents).toEqual(["floor", "table", "kitchen"]);
  expect(cafe.typeOf("tables", "seats")).toBe("integer");
  expect(cafe.typeOf("tables", undefined)).toBeUndefined();
  expect(cafe.above("tables")).toEqual(["tables", "cafes"]);
  expect(cafe.clashes.map(([e, by]) => [e, [...by.keys()]])).toEqual([["tables", ["cafes", "orders"]]]);
  expect(cafe.entities.get("logins")!.documents).toEqual([]); // touched, never held
});

test("a document that hangs from nothing is there before its row; so is each person's own; one that says nothing it holds holds its root", () => {
  expect(cafe.documents.map((d) => [d.name, d.implied])).toEqual([["floor", true], ["table", false], ["visit", true], ["kitchen", true]]);
  expect(["cafes", "tables", "visits", "orders"].map(cafe.there)).toEqual([true, false, true, true]);
  expect(cafe.documents[2]!.holds).toEqual({ visits: { parent: null, fields: [] } });
});

test("a person writes on what they hold, or their own; in front of them is what they hold, and their own where it serves them", () => {
  expect(cafe.writable("manager", "tables").map((d) => d.name)).toEqual(["floor"]);
  expect(cafe.writable("cook", "tables").map((d) => d.name)).toEqual(["table"]);
  expect(cafe.writable("anyone", "visits").map((d) => d.name)).toEqual(["visit"]);
  expect(cafe.inFront("customer").map((d) => d.name)).toEqual(["visit"]);
  expect(cafe.inFront("cook").map((d) => d.name)).toEqual(["table"]);
  expect(cafe.serving(cafe.stories[2]!).map((d) => d.name)).toEqual(["floor", "table"]);
});

test("a word as its field's type has it, and whether a stored value says it", () => {
  expect([valueOf("boolean", "false"), valueOf("boolean", "yes"), valueOf("integer", "2"), valueOf("integer", "two"), valueOf("text", "2")]).toEqual([false, true, 2, "two", "2"]);
  expect([valueOf("integer", undefined), valueOf("boolean", undefined), valueOf("json", undefined), valueOf("text", undefined)]).toEqual([1, true, {}, "changed"]);
  expect([says("boolean", 0, "false"), says("boolean", 1, "yes"), says("boolean", true, "false"), says("boolean", "true", "true")]).toEqual([true, true, false, true]);
  expect([says("integer", 2, "2"), says("real", 2.5, "2.5"), says(undefined, "waiting", "waiting"), says("text", null, "x"), says("boolean", undefined, "false")]).toEqual([true, true, true, false, false]);
  expect([knownType("Bool"), knownType("money"), knownType()]).toEqual([true, false, true]);
});

test("a ref is a path into a list, its id the last step: kept as `<label>_id`, and reached along with the parents", () => {
  expect(refOf("menu:/items")).toEqual({ doc: "menu", collection: "items" });
  expect([refOf("text"), refOf("menu:items"), refOf("menu:/items/3")]).toEqual([undefined, undefined, undefined]);
  expect([columnOf({ name: "dish", type: "menu:/items" }), columnOf({ name: "dish" })]).toEqual(["dish_id", "dish"]);
  expect([knownType("menu:/items"), typeOf("menu:/items")]).toEqual([true, "integer"]);
  const m = readingOf({
    documents: [
      { id: 1, name: "menu", root: "items", list: 1, holds: { items: { parent: null, fields: [f("name")] } } },
      { id: 2, name: "bill", root: "invoices", holds: { invoices: { parent: null }, orders: { parent: "invoices", fields: [f("dish", "menu:/items")] } } },
    ],
  });
  expect(m.refsOf("orders")).toEqual([{ label: "dish", key: "dish_id", doc: "menu", collection: "items" }]);
  expect(m.columnIn("orders", "dish")).toBe("dish_id");
  expect(m.typeOf("orders", "dish")).toBe("integer");
  expect([...m.reach("orders")]).toEqual([["orders", []], ["invoices", [{ entity: "invoices", key: "invoices_id" }]], ["items", [{ entity: "items", key: "dish_id" }]]]);
});

test("a field as the modeller says it: its type is all after the first colon, so a ref keeps its own", () => {
  expect(fieldOf("name")).toEqual({ name: "name", type: "text" });
  expect(fieldOf("price:integer")).toEqual({ name: "price", type: "integer" });
  expect(fieldOf("dish:menu:/items")).toEqual({ name: "dish", type: "menu:/items" });
});

test("a time is the instant it names, however the store writes it; a time no story says is a time", () => {
  expect(says("timestamptz", "2026-10-19 12:00:00+00", "2026-10-19T12:00:00Z")).toBe(true);
  expect(says("timestamptz", "2026-10-19T12:00:01.000Z", "2026-10-19T12:00:00Z")).toBe(false);
  expect(Number.isNaN(Date.parse(String(valueOf("timestamptz", undefined))))).toBe(false);
});
