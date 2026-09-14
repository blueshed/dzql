import { describe, expect, test } from "bun:test";
import { history, prefixDoc } from "../../../src/ledger";
import * as householdDoc from "./household";
import { patch, read } from "./board";

const DOC = prefixDoc("board", "DASH");
const last = () => history(DOC, 1)[0]!;

let n = 0;
const email = () => `b${Date.now()}-${n++}@example.com`;

describe("board document", () => {
  test("an unknown code reads as nothing, and a patch on it applies nothing", () => {
    expect(read("NOBODY")).toBeUndefined();
    expect(patch("NOBODY", [{ op: "replace", path: "/name1", value: "X" }], "s").applied).toEqual([]);
  });

  test("reads the wedding whole, with every household, the lists, and the totals", () => {
    const b = read("DASH")!;
    expect(b).toMatchObject({ code: "DASH", name1: "Rowena", name2: "Dashiell", day: "2027-04-02" });
    expect(b.households.map((h) => h.code)).toContain("OKAFOR");
    expect(b.courses.map((c) => c.name)).toEqual(["Starter", "Main", "Dessert", "The toast"]);
    expect(b.gifts[1]).toMatchObject({ name: "Honeymoon fund", shared: true });
    expect(b.events).toHaveLength(3);
    expect(b.places).toHaveLength(2);
    expect(b.totals.households).toBeGreaterThanOrEqual(2);
  });

  test("the totals count guests coming in households that said yes, and their dishes, drinks and dietary marks", () => {
    const e = email();
    patch("DASH", [{ op: "add", path: "/households/-", value: { email: e, names: "One, Two" } }], "s");
    const h = read("DASH")!.households.find((x) => x.email === e)!;
    const [g1, g2] = h.guests.map((g) => g.id);
    householdDoc.patch(h.code, [
      { op: "replace", path: "/answer", value: "yes" },
      { op: "replace", path: `/guests/${g1}/coming`, value: 1 },
      { op: "replace", path: `/guests/${g1}/choices/2/dish`, value: 6 }, // risotto: v, gf
      { op: "replace", path: `/guests/${g1}/choices/2/drink`, value: 3 },
      { op: "replace", path: `/guests/${g2}/coming`, value: 0 },
      { op: "replace", path: `/guests/${g2}/choices/2/dish`, value: 4 }, // not coming: not counted
    ], "s");
    const before = read("DASH")!.totals;
    expect(before.dishes["6"]).toBeGreaterThanOrEqual(1);
    expect(before.dietary.v).toBeGreaterThanOrEqual(1);
    expect(before.dietary.gf).toBeGreaterThanOrEqual(1);
    expect(before.drinks["3"]).toBeGreaterThanOrEqual(1);
    // a household that said maybe counts for nothing
    householdDoc.patch(h.code, [{ op: "replace", path: "/answer", value: "maybe" }], "s");
    const after = read("DASH")!.totals;
    expect(after.coming).toBe(before.coming - 1);
    expect((after.dishes["6"] ?? 0)).toBe(before.dishes["6"]! - 1);
  });

  test("the wedding's own fields: names must not be blank, the day must be a date, the rest may be removed", () => {
    patch("DASH", [{ op: "replace", path: "/venue", value: " Somewhere " }, { op: "replace", path: "/deadline", value: "2027-03-01" }], "s");
    expect(read("DASH")).toMatchObject({ venue: "Somewhere", deadline: "2027-03-01" });
    expect(last().inverse).toEqual([{ op: "remove", path: "/deadline" }, { op: "replace", path: "/venue", value: "The Mount Without, Bristol" }]);
    expect(
      patch("DASH", [
        { op: "replace", path: "/name1", value: "  " },
        { op: "remove", path: "/name1" },
        { op: "replace", path: "/day", value: "someday" },
        { op: "replace", path: "/deadline", value: "never" },
        { op: "replace", path: "/venue", value: "Somewhere" }, // the same again
        { op: "replace", path: "/nope", value: 1 },
        { op: "replace", path: "/name1/x", value: 1 },
      ], "s").applied,
    ).toEqual([]);
    patch("DASH", [{ op: "remove", path: "/deadline" }, { op: "replace", path: "/venue", value: "The Mount Without, Bristol" }, { op: "replace", path: "/day", value: "2027-04-02" }], "s");
    expect(read("DASH")!.deadline).toBeNull();
  });

  test("an invitation makes a household with a minted code and its named guests; the inverse takes it all back and puts it all back", () => {
    const e = email();
    const r = patch("DASH", [{ op: "add", path: "/households/-", value: { email: e, names: "Grace Hopper, \n Ada Lovelace", plus_ones: "2" } }], "s");
    expect(r.applied).toHaveLength(1);
    const h = read("DASH")!.households.find((x) => x.email === e)!;
    expect(h.code).toMatch(/^B\d+/);
    expect(h.plus_ones).toBe(2);
    expect(h.guests.map((g) => [g.name, g.named_by])).toEqual([["Grace Hopper", "couple"], ["Ada Lovelace", "couple"]]);
    expect(last().inverse).toEqual([{ op: "remove", path: `/households/${h.id}` }]);

    householdDoc.patch(h.code, [{ op: "replace", path: "/answer", value: "yes" }, { op: "add", path: "/asks/-", value: "A Friend" }, { op: "add", path: "/claims/-", value: 2 }], "s");
    patch("DASH", [{ op: "remove", path: `/households/${h.id}` }], "s");
    expect(householdDoc.read(h.code)).toBeUndefined();
    const inverse = last().inverse;
    expect(inverse[0]).toMatchObject({ op: "add", path: "/households/-", value: { id: h.id, code: h.code, answer: "yes" } });
    patch("DASH", inverse, "s");
    const back = householdDoc.read(h.code)!;
    expect(back).toMatchObject({ id: h.id, email: e, answer: "yes", plus_ones: 2, claims: [2] });
    expect(back.guests.map((g) => g.name)).toEqual(["Grace Hopper", "Ada Lovelace"]);
    expect(back.asks.map((a) => a.name)).toEqual(["A Friend"]);
  });

  test("an invitation needs an email; a bare email string will do", () => {
    expect(patch("DASH", [{ op: "add", path: "/households/-", value: { names: "X" } }, { op: "add", path: "/households/-", value: "nope" }, { op: "remove", path: "/households/-" }], "s").applied).toEqual([]);
    const e = email();
    patch("DASH", [{ op: "add", path: "/households/-", value: e }], "s");
    expect(read("DASH")!.households.find((x) => x.email === e)!.guests).toEqual([]);
  });

  test("a household's email and plus-ones are the couple's to change", () => {
    const e = email();
    patch("DASH", [{ op: "add", path: "/households/-", value: e }], "s");
    const h = read("DASH")!.households.find((x) => x.email === e)!;
    patch("DASH", [{ op: "replace", path: `/households/${h.id}/email`, value: "new@example.com" }, { op: "replace", path: `/households/${h.id}/plus_ones`, value: "3" }], "s");
    expect(householdDoc.read(h.code)).toMatchObject({ email: "new@example.com", plus_ones: 3 });
    expect(last().inverse).toEqual([{ op: "replace", path: `/households/${h.id}/plus_ones`, value: 0 }, { op: "replace", path: `/households/${h.id}/email`, value: e }]);
    expect(
      patch("DASH", [
        { op: "replace", path: `/households/${h.id}/email`, value: "not-an-email" },
        { op: "replace", path: `/households/${h.id}/plus_ones`, value: -1 },
        { op: "replace", path: `/households/${h.id}/plus_ones`, value: 3 },
        { op: "replace", path: `/households/${h.id}/code`, value: "X" },
        { op: "replace", path: `/households/${h.id}`, value: "X" },
        { op: "remove", path: "/households/999999" },
        { op: "remove", path: "/households/x" },
      ], "s").applied,
    ).toEqual([]);
  });

  test("a yes to an ask makes a guest; taking the yes back takes the guest with it; the inverse puts them back whole, linked to the ask", () => {
    const e = email();
    patch("DASH", [{ op: "add", path: "/households/-", value: e }], "s");
    const h = read("DASH")!.households.find((x) => x.email === e)!;
    householdDoc.patch(h.code, [{ op: "add", path: "/asks/-", value: "Kemi" }], "s");
    const ask = householdDoc.read(h.code)!.asks[0]!;
    const at = `/households/${h.id}/asks/${ask.id}/reply`;

    patch("DASH", [{ op: "replace", path: at, value: "yes" }], "s");
    let now = householdDoc.read(h.code)!;
    expect(now.guests.map((g) => [g.name, g.named_by, g.coming])).toEqual([["Kemi", "ask", 1]]);
    expect(now.asks[0]!.guest_id).toBe(now.guests[0]!.id);
    expect(last().inverse).toEqual([{ op: "remove", path: at }]);
    // yes again: no second guest
    expect(patch("DASH", [{ op: "replace", path: at, value: "yes" }], "s").applied).toEqual([]);

    householdDoc.patch(h.code, [{ op: "replace", path: `/guests/${now.guests[0]!.id}/minifigure/hair`, value: "bob" }], "s");
    patch("DASH", [{ op: "replace", path: at, value: "no" }], "s");
    now = householdDoc.read(h.code)!;
    expect(now.guests).toEqual([]);
    expect(now.asks[0]).toMatchObject({ reply: "no", guest_id: null });
    const inverse = last().inverse;
    expect(inverse).toHaveLength(2);
    expect(inverse[0]).toMatchObject({ op: "add", path: `/households/${h.id}/guests/-`, value: { name: "Kemi", ask_id: ask.id, minifigure: { hair: "bob" } } });
    expect(inverse[1]).toEqual({ op: "replace", path: at, value: "yes" });
    patch("DASH", inverse, "s");
    now = householdDoc.read(h.code)!;
    expect(now.guests.map((g) => g.minifigure.hair)).toEqual(["bob"]);
    expect(now.asks[0]).toMatchObject({ reply: "yes", guest_id: now.guests[0]!.id });

    // the reply can be unsaid (a remove), and only yes/no otherwise; an ask that is not theirs is ignored
    patch("DASH", [{ op: "remove", path: at }], "s");
    expect(householdDoc.read(h.code)!.asks[0]!.reply).toBeNull();
    expect(patch("DASH", [{ op: "replace", path: at, value: "maybe" }, { op: "remove", path: at }, { op: "replace", path: `/households/${h.id}/asks/1/reply`, value: "no" }, { op: "replace", path: `/households/${h.id}/asks/${ask.id}`, value: "no" }], "s").applied).toEqual([]);
  });

  test("the couple may name a guest on an invitation, and remove one, whole either way", () => {
    const e = email();
    patch("DASH", [{ op: "add", path: "/households/-", value: e }], "s");
    const h = read("DASH")!.households.find((x) => x.email === e)!;
    patch("DASH", [{ op: "add", path: `/households/${h.id}/guests/-`, value: " Late Addition " }], "s");
    const g = householdDoc.read(h.code)!.guests[0]!;
    expect(g).toMatchObject({ name: "Late Addition", named_by: "couple" });
    expect(last().inverse).toEqual([{ op: "remove", path: `/households/${h.id}/guests/${g.id}` }]);
    patch("DASH", [{ op: "remove", path: `/households/${h.id}/guests/${g.id}` }], "s");
    expect(householdDoc.read(h.code)!.guests).toEqual([]);
    expect(last().inverse[0]).toMatchObject({ op: "add", path: `/households/${h.id}/guests/-`, value: { id: g.id, name: "Late Addition" } });
    expect(patch("DASH", [{ op: "add", path: `/households/${h.id}/guests/-`, value: "" }, { op: "remove", path: `/households/${h.id}/guests/1` }, { op: "replace", path: `/households/${h.id}/guests/-`, value: "x" }, { op: "replace", path: `/households/${h.id}/nope`, value: "x" }], "s").applied).toEqual([]);
  });

  test("a list row is added by name, its fields replaced or removed, and removed whole with its children and claims", () => {
    patch("DASH", [{ op: "add", path: "/courses/-", value: "Cheese" }], "s");
    const course = read("DASH")!.courses.find((c) => c.name === "Cheese")!;
    expect(course.seq).toBe(5);
    expect(last().inverse).toEqual([{ op: "remove", path: `/courses/${course.id}` }]);
    patch("DASH", [
      { op: "add", path: `/courses/${course.id}/dishes/-`, value: { name: "Stilton", dietary: "v" } },
      { op: "add", path: `/courses/${course.id}/drinks/-`, value: "Port" },
    ], "s");
    let c = read("DASH")!.courses.find((x) => x.id === course.id)!;
    expect(c.dishes[0]).toMatchObject({ name: "Stilton", dietary: "v", seq: 1 });
    expect(c.drinks[0]).toMatchObject({ name: "Port", seq: 1 });
    const dish = c.dishes[0]!.id;
    patch("DASH", [{ op: "replace", path: `/courses/${course.id}/dishes/${dish}/dietary`, value: "" }, { op: "replace", path: `/courses/${course.id}/name`, value: "The cheese" }], "s");
    c = read("DASH")!.courses.find((x) => x.id === course.id)!;
    expect(c.name).toBe("The cheese");
    expect(c.dishes[0]!.dietary).toBeNull();
    expect(last().inverse).toEqual([{ op: "replace", path: `/courses/${course.id}/name`, value: "Cheese" }, { op: "replace", path: `/courses/${course.id}/dishes/${dish}/dietary`, value: "v" }]);

    patch("DASH", [{ op: "remove", path: `/courses/${course.id}` }], "s");
    expect(read("DASH")!.courses.find((x) => x.id === course.id)).toBeUndefined();
    const inverse = last().inverse;
    expect(inverse[0]).toMatchObject({ op: "add", path: "/courses/-", value: { id: course.id, name: "The cheese", dishes: [{ name: "Stilton" }], drinks: [{ name: "Port" }] } });
    patch("DASH", inverse, "s");
    c = read("DASH")!.courses.find((x) => x.id === course.id)!;
    expect(c.dishes.map((d) => d.name)).toEqual(["Stilton"]);
    expect(c.drinks.map((d) => d.name)).toEqual(["Port"]);
    patch("DASH", [{ op: "remove", path: `/courses/${course.id}` }], "s");
  });

  test("a gift's claims come back with it", () => {
    patch("DASH", [{ op: "add", path: "/gifts/-", value: { name: "A vase", shared: "yes" } }], "s");
    const gift = read("DASH")!.gifts.find((g) => g.name === "A vase")!;
    expect(gift.shared).toBe(true);
    householdDoc.patch("OKAFOR", [{ op: "add", path: "/claims/-", value: gift.id }], "s");
    patch("DASH", [{ op: "replace", path: `/gifts/${gift.id}/shared`, value: "0" }], "s");
    expect(last().inverse).toEqual([{ op: "replace", path: `/gifts/${gift.id}/shared`, value: 1 }]);
    patch("DASH", [{ op: "remove", path: `/gifts/${gift.id}` }], "s");
    const inverse = last().inverse;
    expect(inverse[0]).toMatchObject({ op: "add", path: "/gifts/-", value: { id: gift.id, claims: [1] } });
    patch("DASH", inverse, "s");
    expect(read("DASH")!.gifts.find((g) => g.id === gift.id)!.claimants).toEqual(["OKAFOR"]);
    patch("DASH", [{ op: "remove", path: `/gifts/${gift.id}` }], "s");
  });

  test("a row's seq is a move: the list is renumbered, and the inverse moves it back", () => {
    patch("DASH", [{ op: "replace", path: "/events/3/seq", value: 1 }], "s");
    expect(read("DASH")!.events.map((e) => e.id)).toEqual([3, 1, 2]);
    expect(last().inverse).toEqual([{ op: "replace", path: "/events/3/seq", value: 3 }]);
    patch("DASH", last().inverse, "s");
    expect(read("DASH")!.events.map((e) => [e.id, e.seq])).toEqual([[1, 1], [2, 2], [3, 3]]);
    // beyond the ends it clamps; to its own place, or a remove, applies nothing
    patch("DASH", [{ op: "replace", path: "/events/1/seq", value: 99 }], "s");
    expect(read("DASH")!.events.map((e) => e.id)).toEqual([2, 3, 1]);
    patch("DASH", last().inverse, "s");
    expect(patch("DASH", [{ op: "replace", path: "/events/1/seq", value: 1 }, { op: "remove", path: "/events/1/seq" }, { op: "replace", path: "/events/1/seq", value: "x" }], "s").applied).toEqual([]);
  });

  test("a list refuses what it cannot take: no name, an unknown row or column, a blank required field, a bad op", () => {
    expect(
      patch("DASH", [
        { op: "add", path: "/events/-", value: "" },
        { op: "add", path: "/events/-", value: { notes: "no name" } },
        { op: "replace", path: "/events/-", value: "x" },
        { op: "remove", path: "/events/999" },
        { op: "remove", path: "/events/x" },
        { op: "replace", path: "/events/1", value: "x" },
        { op: "replace", path: "/events/1/colour", value: "x" },
        { op: "replace", path: "/events/1/name", value: " " },
        { op: "remove", path: "/events/1/name" },
        { op: "replace", path: "/events/1/name", value: "Ceremony" }, // the same again
        { op: "replace", path: "/events/1/notes/x", value: "x" },
        { op: "replace", path: "/courses/1/dishes/1/name/x", value: "x" },
        { op: "replace", path: "/courses/1/puddings/-", value: "x" },
        { op: "replace", path: "/gifts/1/shared", value: "sometimes" },
        { op: "replace", path: "", value: 1 },
      ], "s").applied,
    ).toEqual([]);
  });
});
