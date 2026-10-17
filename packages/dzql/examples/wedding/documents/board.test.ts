import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDocuments, setActiveDocuments } from "dzql/rendering/documents";
import type { PatchOp } from "dzql/rendering/json-patch";
import { delta } from "../delta";
import { held, read, shape, totals } from "./board";
import type { HouseholdDocument } from "./household";

let documents: ReturnType<typeof createDocuments>;

beforeAll(async () => {
  documents = createDocuments(delta);
  setActiveDocuments(documents);
  await documents.load("board:1");
  await documents.load("board:nope");
});

afterAll(() => setActiveDocuments(undefined));

/** What the couple's write becomes, against the seed as the board holds it. */
const shaped = (...ops: PatchOp[]) => shape(held(), ops, "2026-09-24T12:00:00Z");

describe("the board", () => {
  test("reads the wedding whole: households by code, each whole, the lists in their order", () => {
    const b = read()!;
    expect(b.name1).toBe("Nick");
    const codes = b.households.map((h) => h.code);
    expect(codes).toEqual([...codes].sort()); // by code
    expect(codes).toEqual(expect.arrayContaining(["BEN", "OKAFOR"]));
    expect(b.households.find((h) => h.code === "OKAFOR")!.guests.map((g) => g.name)).toEqual(["Ada Okafor", "Femi Okafor"]);
    expect(b.courses.map((c) => c.name)).toEqual(["Starter", "Main", "Dessert", "The toast"]);
    expect(b.gifts.find((g) => g.id === 2)).toMatchObject({ shared: true, taken: 0, claimants: [] });
    expect(read("nope")).toBeUndefined(); // no such wedding
  });

  test("a gift's claimants are the households' codes, in the order they claimed", async () => {
    const claim = (hid: string, at: string) =>
      documents.write(`household:${hid}`, [{ op: "add", path: `/claims/2-${hid}`, value: { gift_id: "2", claimed_at: at } }], { identity: "test", cursor: "board-test" });
    await claim("1", "2026-01-02");
    await claim("2", "2026-01-01");
    expect(read()!.gifts.find((g) => g.id === 2)).toMatchObject({ taken: 2, claimants: ["BEN", "OKAFOR"] });
    for (const hid of ["1", "2"]) await documents.write(`household:${hid}`, [{ op: "remove", path: `/claims/2-${hid}` }], { identity: "test", cursor: "board-test" });
    expect(read()!.gifts.find((g) => g.id === 2)!.claimants).toEqual([]);
  });

  test("the totals count the coming guests of households that said yes, their dishes and drinks, and each dish's marks", () => {
    const guest = (coming: number | null, dish: number | null, drink: number | null) => ({ coming, choices: { "1": { dish, drink } } });
    const households = [
      { answer: "yes", guests: [guest(1, 2, 1), guest(1, null, 2), guest(0, 2, 1)], asks: [{ reply: null }] },
      { answer: "maybe", guests: [guest(1, 2, 1)], asks: [{ reply: "yes" }] },
      { answer: null, guests: [], asks: [] },
    ] as unknown as HouseholdDocument[];
    const courses = read()!.courses;
    expect(totals(households, courses)).toEqual({ households: 3, answered: 2, coming: 2, asksWaiting: 1, dishes: { "2": 1 }, drinks: { "1": 1, "2": 1 }, dietary: { v: 1, gf: 1 } });
  });
});

describe("what a couple's write becomes", () => {
  test("the wedding's own fields: text kept, blanks and bad dates refused, an optional one cleared by a remove", () => {
    expect(shaped({ op: "replace", path: "/name1", value: " Ro " })).toEqual([{ op: "replace", path: "/weddings/name1", value: "Ro" }]);
    expect(shaped({ op: "replace", path: "/name1", value: " " }, { op: "remove", path: "/name1" }, { op: "replace", path: "/day", value: "soon" }, { op: "replace", path: "/name1", value: "Nick" }, { op: "replace", path: "/nope", value: 1 }, { op: "replace", path: "", value: 1 })).toEqual([]);
    expect(shaped({ op: "replace", path: "/deadline", value: "2027-03-01" }, { op: "remove", path: "/venue" })).toEqual([
      { op: "replace", path: "/weddings/deadline", value: "2027-03-01" },
      { op: "replace", path: "/weddings/venue", value: null },
    ]);
  });

  test("an invitation: a household with a code from its email, and the guests named on it", () => {
    const [household, ...guests] = shaped({ op: "add", path: "/households/-", value: { email: "grace@example.com", names: "Grace Hopper,\n Ada ", plus_ones: 2 } });
    const hid = household!.path.split("/")[2]!;
    expect(household).toEqual({ op: "add", path: `/households/${hid}`, value: { code: "GRACE1", email: "grace@example.com", plus_ones: 2, answer: null, message: null } });
    expect(Number(hid)).toBeGreaterThan(Date.now()); // past any id delta's serial has handed out: its guests name it
    expect(guests.map((g) => g.path)).toEqual(["/guests/-", "/guests/-"]);
    expect(guests.map((g) => g.value)).toEqual([
      { households_id: hid, name: "Grace Hopper", named_by: "couple" },
      { households_id: hid, name: "Ada", named_by: "couple" },
    ]);
    expect(shaped({ op: "add", path: "/households/-", value: "solo@example.com" })[0]!.value).toMatchObject({ email: "solo@example.com", plus_ones: 0 });
    const several = shaped({ op: "add", path: "/households/-", value: "grace@example.com" }, { op: "add", path: "/households/-", value: "grace@elsewhere.example" }, { op: "add", path: "/households/-", value: "grace@third.example" });
    expect(several.map((op) => (op.value as { code: string }).code)).toEqual(["GRACE1", "GRACE2", "GRACE3"]); // several in one message: a code each
    expect(shaped({ op: "add", path: "/households/-", value: { email: "no at sign" } }, { op: "replace", path: "/households/-", value: "x@y" }, { op: "add", path: "/households/-/guests", value: "x@y" })).toEqual([]);
  });

  test("a household's email and plus-ones, and the guests the couple name or take off", () => {
    expect(shaped({ op: "replace", path: "/households/2/email", value: "ben@new.example" }, { op: "replace", path: "/households/2/plus_ones", value: "1" })).toEqual([
      { op: "replace", path: "/households/2/email", value: "ben@new.example" },
      { op: "replace", path: "/households/2/plus_ones", value: 1 },
    ]);
    expect(
      shaped(
        { op: "replace", path: "/households/2/email", value: "ben@example.com" }, // the same
        { op: "replace", path: "/households/2/email", value: "nobody" },
        { op: "replace", path: "/households/2/plus_ones", value: -1 },
        { op: "replace", path: "/households/2/plus_ones", value: 0 }, // the same
        { op: "replace", path: "/households/99/email", value: "x@y" },
        { op: "add", path: "/households/2/guests/-", value: " " },
        { op: "replace", path: "/households/2/guests/-", value: "Mara" },
        { op: "remove", path: "/households/2/guests/1" }, // the Okafors', not Ben's
        { op: "replace", path: "/households/2/guests/3", value: "x" },
        { op: "remove", path: "/households/2/nope" },
      ),
    ).toEqual([]);
    const [added] = shaped({ op: "add", path: "/households/2/guests/-", value: { name: "Mara" } });
    expect(added!.value).toEqual({ households_id: 2, name: "Mara", named_by: "couple" });
    expect(shaped({ op: "remove", path: "/households/2/guests/3" })).toEqual([{ op: "remove", path: "/guests/3" }]);
  });

  test("a new row's id is past every id delta has handed out, so one taken off is never named again", async () => {
    const by = { identity: "test", cursor: "board-test" };
    const pathOf = (written: Awaited<ReturnType<typeof documents.write>>): string => ("error" in written ? written.error.message : written.ops[0]!.path);
    const gone = pathOf(await documents.write("board:1", [{ op: "add", path: "/guests/-", value: { households_id: 2, name: "Lou" } }], by)); // delta's serial names it
    await documents.write("board:1", [{ op: "remove", path: gone }], by);
    const named = pathOf(await documents.write("board:1", shaped({ op: "add", path: "/households/2/guests/-", value: "Mara" }) as never, by));
    expect(named).toStartWith("/guests/");
    expect(named).not.toBe(gone);
    await documents.write("board:1", [{ op: "remove", path: named }], by);
  });

  test("a yes to an ask makes its guest, remembered on the ask; a no takes them back out; a reply not given cannot be withdrawn", () => {
    const yes = shaped({ op: "replace", path: "/households/1/asks/1/reply", value: "yes" });
    const gid = yes[1]!.path.split("/")[2]!;
    expect(yes).toEqual([
      { op: "replace", path: "/asks/1/reply", value: "yes" },
      { op: "add", path: `/guests/${gid}`, value: { households_id: 1, name: "Kemi Okafor", named_by: "ask", coming: 1 } },
      { op: "replace", path: "/asks/1/guest_id", value: gid },
    ]);
    // the same message, the yes and then the no: the guest made, then taken out, and the ask let go of them
    const [, made, , ...no] = shaped({ op: "replace", path: "/households/1/asks/1/reply", value: "yes" }, { op: "replace", path: "/households/1/asks/1/reply", value: "no" });
    expect(no).toEqual([
      { op: "replace", path: "/asks/1/reply", value: "no" },
      { op: "replace", path: "/asks/1/guest_id", value: null },
      { op: "remove", path: made!.path },
    ]);
    expect(made!.path).not.toBe(`/guests/${gid}`); // each yes its own guest, its id climbing
    expect(shaped({ op: "remove", path: "/households/1/asks/1/reply" }, { op: "replace", path: "/households/1/asks/1/reply", value: "perhaps" }, { op: "replace", path: "/households/2/asks/1/reply", value: "yes" })).toEqual([]);
  });

  test("the lists: added with the next place, a field of its kind, moved and renumbered, taken off with what hangs on them", () => {
    const [course] = shaped({ op: "add", path: "/courses/-", value: "Cheese" });
    expect(course).toEqual({ op: "add", path: "/courses/-", value: { name: "Cheese", seq: 5 } }); // delta names it
    expect(shaped({ op: "add", path: "/courses/-", value: "Cheese" }, { op: "add", path: "/courses/-", value: "Fruit" }, { op: "add", path: "/courses/-", value: "Nuts" }).map((op) => (op.value as { seq: number }).seq)).toEqual([5, 6, 7]); // each counted
    const [dish] = shaped({ op: "add", path: "/courses/2/dishes/-", value: { name: "Tagine", dietary: "vg", seq: 1, nope: 1 } });
    expect(dish!.value).toEqual({ name: "Tagine", dietary: "vg", seq: 4, courses_id: 2 });
    const next = read()!.gifts.length + 1; // the seed's three, and any another test file has added
    expect(shaped({ op: "add", path: "/gifts/-", value: { name: "A tree", shared: "yes" } })[0]!.value).toEqual({ name: "A tree", shared: 1, seq: next });
    expect(shaped({ op: "add", path: "/gifts/-", value: { name: "A kettle" } })[0]!.value).toEqual({ name: "A kettle", shared: 0, seq: next });
    expect(shaped({ op: "add", path: "/courses/-", value: { dietary: "no name" } }, { op: "replace", path: "/courses/-", value: "x" }, { op: "add", path: "/courses/-/name", value: "x" })).toEqual([]);

    expect(shaped({ op: "replace", path: "/courses/4/seq", value: "2" })).toEqual([
      { op: "replace", path: "/courses/4/seq", value: 2 },
      { op: "replace", path: "/courses/2/seq", value: 3 },
      { op: "replace", path: "/courses/3/seq", value: 4 },
    ]);
    expect(shaped({ op: "replace", path: "/courses/1/seq", value: 0 }, { op: "replace", path: "/courses/1/seq", value: "x" }, { op: "remove", path: "/courses/1/seq" })).toEqual([]); // already first
    expect(shaped({ op: "replace", path: "/courses/2/dishes/4/dietary", value: "" }, { op: "remove", path: "/courses/1/dishes/3/dietary" })).toEqual([{ op: "replace", path: "/dishes/4/dietary", value: null }]);
    expect(shaped({ op: "replace", path: "/courses/2/name", value: "Main" }, { op: "replace", path: "/courses/2/dishes/1/name", value: "x" }, { op: "replace", path: "/courses/9/name", value: "x" }, { op: "replace", path: "/courses/2/nope", value: "x" }, { op: "replace", path: "/courses/2/name/x", value: "x" }, { op: "replace", path: "/courses/2", value: "x" })).toEqual([]);

    expect(shaped({ op: "remove", path: "/courses/4" })).toEqual([{ op: "remove", path: "/courses/4" }]);
  });

  test("what hangs on a row goes with it: a gift's claims, and every choice of a course, a dish or a drink", () => {
    const b = held();
    const doc = structuredClone(b);
    doc.claims = { "1-1": { id: "1-1", households_id: "1", gift_id: "1" }, "3-2": { id: "3-2", households_id: "2", gift_id: "3" } };
    for (const g of Object.values(doc.guests!)) g.choices = {}; // what other tests chose is not this one's
    doc.guests!["1"]!.choices = { "1": { dish: 2, drink: 1 }, "2": { dish: 5, drink: null } };
    const now = "2026-09-24T12:00:00Z";
    expect(shape(doc, [{ op: "remove", path: "/gifts/1" }], now)).toEqual([{ op: "remove", path: "/claims/1-1" }, { op: "remove", path: "/gifts/1" }]);
    expect(shape(doc, [{ op: "remove", path: "/courses/1/dishes/2" }], now)).toEqual([
      { op: "replace", path: "/guests/1/choices", value: { "1": { dish: null, drink: 1 }, "2": { dish: 5, drink: null } } },
      { op: "remove", path: "/dishes/2" },
    ]);
    expect(shape(doc, [{ op: "remove", path: "/courses/1/drinks/1" }], now)[0]).toEqual({ op: "replace", path: "/guests/1/choices", value: { "1": { dish: 2, drink: null }, "2": { dish: 5, drink: null } } });
    expect(shape(doc, [{ op: "remove", path: "/courses/1" }], now)).toEqual([
      { op: "replace", path: "/guests/1/choices", value: { "2": { dish: 5, drink: null } } },
      { op: "remove", path: "/courses/1" },
    ]);
  });
});
