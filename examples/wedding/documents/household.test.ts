import { describe, expect, test } from "bun:test";
import { history, prefixDoc } from "../../../src/ledger";
import * as boardDoc from "./board";
import { patch, read, type HouseholdDocument } from "./household";

let n = 0;
/** A household of its own for a test, invited through the board: two named guests and one plus-one. */
function invite(plusOnes = 1, names = "Tess Test, Tom Test"): HouseholdDocument {
  const email = `t${Date.now()}-${n++}@example.com`;
  boardDoc.patch("DASH", [{ op: "add", path: "/households/-", value: { email, names, plus_ones: plusOnes } }], "setup");
  const code = boardDoc.read("DASH")!.households.find((h) => h.email === email)!.code;
  return read(code)!;
}

const doc = (h: HouseholdDocument) => prefixDoc("household", h.code);

describe("household document", () => {
  test("an unknown code reads as nothing, and a patch on it applies nothing", () => {
    expect(read("NOBODY")).toBeUndefined();
    expect(patch("NOBODY", [{ op: "replace", path: "/answer", value: "yes" }], "s")).toEqual({ version: 0, applied: [] });
  });

  test("reads the seed's household whole: guests with minifigures and choices, asks, claims", () => {
    const h = read("OKAFOR")!;
    expect(h).toMatchObject({ id: 1, code: "OKAFOR", email: "ada@example.com", plus_ones: 1, answer: "yes" });
    expect(h.guests.map((g) => g.name)).toEqual(["Ada Okafor", "Femi Okafor"]);
    expect(h.guests[1]!.minifigure).toMatchObject({ face: "grin", attitude: "cool" });
    expect(h.guests[0]!.minifigure.built_at).toBeNull();
    expect(h.asks).toEqual([{ id: 1, name: "Kemi Okafor", asked_at: "2026-09-01T08:00:00Z", reply: null, guest_id: null }]);
    expect(h.claims).toEqual([]);
  });

  test("the answer and the message are replaced, removed, and put back by their inverses", () => {
    const h = invite();
    let r = patch(h.code, [{ op: "replace", path: "/answer", value: "maybe" }, { op: "replace", path: "/message", value: "  We hope so  " }], "s1");
    expect(r.version).toBe(1);
    expect(read(h.code)).toMatchObject({ answer: "maybe", message: "We hope so" });
    // the inverse restores "no value" as a remove, never a replace with null
    expect(history(doc(h))[0]!.inverse).toEqual([{ op: "remove", path: "/message" }, { op: "remove", path: "/answer" }]);

    r = patch(h.code, [{ op: "remove", path: "/answer" }, { op: "remove", path: "/message" }], "s1");
    expect(read(h.code)).toMatchObject({ answer: null, message: null });
    expect(history(doc(h))[0]!.inverse).toEqual([{ op: "replace", path: "/message", value: "We hope so" }, { op: "replace", path: "/answer", value: "maybe" }]);
  });

  test("an answer that is not yes, maybe or no, or the same again, does not apply", () => {
    const h = invite();
    expect(patch(h.code, [{ op: "replace", path: "/answer", value: "perhaps" }], "s").applied).toEqual([]);
    patch(h.code, [{ op: "replace", path: "/answer", value: "no" }], "s");
    expect(patch(h.code, [{ op: "replace", path: "/answer", value: "no" }], "s").applied).toEqual([]);
    expect(patch(h.code, [{ op: "replace", path: "/message", value: "" }], "s").applied).toEqual([]); // blank on a null message: no change
  });

  test("a plus-one is added by name, comes with a blank minifigure, and is taken back by the inverse (whole)", () => {
    const h = invite();
    const r = patch(h.code, [{ op: "add", path: "/guests/-", value: "  Plus One " }], "s");
    const added = read(h.code)!.guests.find((g) => g.name === "Plus One")!;
    expect(added).toMatchObject({ named_by: "household", coming: null, choices: {} });
    expect(added.minifigure.built_at).toBeNull();
    expect(history(doc(h))[0]!.inverse).toEqual([{ op: "remove", path: `/guests/${added.id}` }]);
    expect(r.applied).toHaveLength(1);

    // dress them and choose for them, then remove: the inverse carries everything back
    patch(h.code, [{ op: "replace", path: `/guests/${added.id}/minifigure/hair`, value: "curls" }, { op: "replace", path: `/guests/${added.id}/choices/2/dish`, value: 5 }], "s");
    patch(h.code, [{ op: "remove", path: `/guests/${added.id}` }], "s");
    expect(read(h.code)!.guests.find((g) => g.id === added.id)).toBeUndefined();
    const inverse = history(doc(h))[0]!.inverse;
    expect(inverse[0]).toMatchObject({ op: "add", path: "/guests/-", value: { id: added.id, name: "Plus One", minifigure: { hair: "curls" }, choices: { "2": { dish: 5, drink: null } } } });
    patch(h.code, inverse, "s");
    const back = read(h.code)!.guests.find((g) => g.id === added.id)!;
    expect(back.minifigure.hair).toBe("curls");
    expect(back.minifigure.built_at).not.toBeNull();
    expect(back.choices).toEqual({ "2": { dish: 5, drink: null } });
  });

  test("a guest with no name, or a remove of a guest that is not theirs, does not apply", () => {
    const h = invite();
    expect(patch(h.code, [{ op: "add", path: "/guests/-", value: "   " }, { op: "add", path: "/guests/-", value: {} }], "s").applied).toEqual([]);
    expect(patch(h.code, [{ op: "remove", path: "/guests/1" }], "s").applied).toEqual([]); // guest 1 is OKAFOR's
    expect(patch(h.code, [{ op: "remove", path: "/guests/x" }], "s").applied).toEqual([]);
    expect(patch(h.code, [{ op: "replace", path: `/guests/${h.guests[0]!.id}` }], "s").applied).toEqual([]);
  });

  test("coming is yes or no however spelt, removed to unsaid, and the same again is ignored", () => {
    const h = invite();
    const g = h.guests[0]!.id;
    expect(patch(h.code, [{ op: "replace", path: `/guests/${g}/coming`, value: "1" }], "s").applied).toHaveLength(1);
    expect(read(h.code)!.guests[0]!.coming).toBe(1);
    expect(patch(h.code, [{ op: "replace", path: `/guests/${g}/coming`, value: true }], "s").applied).toEqual([]);
    expect(patch(h.code, [{ op: "replace", path: `/guests/${g}/coming`, value: "sometimes" }], "s").applied).toEqual([]);
    patch(h.code, [{ op: "replace", path: `/guests/${g}/coming`, value: "no" }], "s");
    expect(read(h.code)!.guests[0]!.coming).toBe(0);
    patch(h.code, [{ op: "remove", path: `/guests/${g}/coming` }], "s");
    expect(read(h.code)!.guests[0]!.coming).toBeNull();
    expect(history(doc(h))[0]!.inverse).toEqual([{ op: "replace", path: `/guests/${g}/coming`, value: 0 }]);
  });

  test("the first touch on a blank minifigure stamps built_at, and its inverse unstamps it", () => {
    const h = invite();
    const g = h.guests[0]!.id;
    patch(h.code, [{ op: "replace", path: `/guests/${g}/minifigure/skin`, value: "#5C3A22" }], "s");
    const after = read(h.code)!.guests[0]!.minifigure;
    expect(after.skin).toBe("#5C3A22");
    expect(after.built_at).not.toBeNull();
    const inverse = history(doc(h))[0]!.inverse;
    expect(inverse).toEqual([{ op: "replace", path: `/guests/${g}/minifigure/skin`, value: "#F2C86A" }, { op: "remove", path: `/guests/${g}/minifigure/built_at` }]);
    patch(h.code, inverse, "s");
    expect(read(h.code)!.guests[0]!.minifigure).toMatchObject({ skin: "#F2C86A", built_at: null });
    // a second touch, once built, leaves the stamp alone
    patch(h.code, [{ op: "replace", path: `/guests/${g}/minifigure/attitude`, value: "waving" }, { op: "replace", path: `/guests/${g}/minifigure/face`, value: "wink" }], "s");
    expect(history(doc(h))[0]!.inverse).toEqual([
      { op: "replace", path: `/guests/${g}/minifigure/face`, value: "smile" },
      { op: "replace", path: `/guests/${g}/minifigure/attitude`, value: "nodding" },
      { op: "remove", path: `/guests/${g}/minifigure/built_at` },
    ]);
  });

  test("a look takes only the model's values: no colour off the palette, no unknown hair, no unknown field, no remove", () => {
    const h = invite();
    const g = h.guests[0]!.id;
    const at = `/guests/${g}/minifigure`;
    expect(
      patch(
        h.code,
        [
          { op: "replace", path: `${at}/skin`, value: "#123456" },
          { op: "replace", path: `${at}/hair`, value: "mohawk" },
          { op: "replace", path: `${at}/hat`, value: "top" },
          { op: "remove", path: `${at}/hair` },
          { op: "replace", path: `${at}/hair`, value: "none" }, // the same again
          { op: "replace", path: `${at}/built_at/x`, value: "1" },
        ],
        "s",
      ).applied,
    ).toEqual([]);
  });

  test("a choice is a dish or a drink the course offers, one per guest per course; let go with a remove", () => {
    const h = invite();
    const g = h.guests[0]!.id;
    const r = patch(h.code, [{ op: "replace", path: `/guests/${g}/choices/2/dish`, value: "5" }, { op: "replace", path: `/guests/${g}/choices/2/drink`, value: 3 }], "s");
    expect(r.applied).toHaveLength(2);
    expect(read(h.code)!.guests[0]!.choices).toEqual({ "2": { dish: 5, drink: 3 } });
    expect(history(doc(h))[0]!.inverse).toEqual([{ op: "remove", path: `/guests/${g}/choices/2/drink` }, { op: "remove", path: `/guests/${g}/choices/2/dish` }]);
    // dish 1 is the starter's, not the main's; drink 6 is the toast's; course 9 does not exist; the same again
    expect(
      patch(
        h.code,
        [
          { op: "replace", path: `/guests/${g}/choices/2/dish`, value: 1 },
          { op: "replace", path: `/guests/${g}/choices/2/drink`, value: 6 },
          { op: "replace", path: `/guests/${g}/choices/9/dish`, value: 1 },
          { op: "replace", path: `/guests/${g}/choices/2/dish`, value: 5 },
          { op: "replace", path: `/guests/${g}/choices/2/dish`, value: "x" },
          { op: "replace", path: `/guests/${g}/choices/2/pudding`, value: 1 },
        ],
        "s",
      ).applied,
    ).toEqual([]);
    patch(h.code, [{ op: "remove", path: `/guests/${g}/choices/2/dish` }], "s");
    expect(read(h.code)!.guests[0]!.choices).toEqual({ "2": { dish: null, drink: 3 } });
    expect(history(doc(h))[0]!.inverse).toEqual([{ op: "replace", path: `/guests/${g}/choices/2/dish`, value: 5 }]);
  });

  test("an ask is added by name, stamped when asked, and taken back whole by the inverse", () => {
    const h = invite();
    patch(h.code, [{ op: "add", path: "/asks/-", value: "Someone Else" }], "s");
    const ask = read(h.code)!.asks[0]!;
    expect(ask).toMatchObject({ name: "Someone Else", reply: null, guest_id: null });
    expect(new Date(ask.asked_at).getTime()).toBeGreaterThan(0);
    expect(history(doc(h))[0]!.inverse).toEqual([{ op: "remove", path: `/asks/${ask.id}` }]);
    patch(h.code, [{ op: "remove", path: `/asks/${ask.id}` }], "s");
    expect(read(h.code)!.asks).toEqual([]);
    expect(history(doc(h))[0]!.inverse).toEqual([{ op: "add", path: "/asks/-", value: ask }]);
    patch(h.code, [{ op: "add", path: "/asks/-", value: ask }], "s");
    expect(read(h.code)!.asks).toEqual([ask]);
    // no name, an ask that is not theirs, a replace on an ask
    expect(patch(h.code, [{ op: "add", path: "/asks/-", value: " " }, { op: "remove", path: "/asks/1" }, { op: "replace", path: `/asks/${ask.id}`, value: 1 }], "s").applied).toEqual([]);
  });

  test("a claim takes a gift; a second household's claim on it is refused by the store; a shared gift takes any number; unclaim gives it back", () => {
    const a = invite();
    const b = invite();
    boardDoc.patch("DASH", [{ op: "add", path: "/gifts/-", value: "A test gift" }], "setup");
    const gift = boardDoc.read("DASH")!.gifts.find((g) => g.name === "A test gift")!.id;
    expect(patch(a.code, [{ op: "add", path: "/claims/-", value: String(gift) }], "s").applied).toHaveLength(1);
    expect(read(a.code)!.claims).toEqual([gift]);
    expect(history(doc(a))[0]!.inverse).toEqual([{ op: "remove", path: `/claims/${gift}` }]);
    expect(patch(b.code, [{ op: "add", path: "/claims/-", value: gift }], "s").applied).toEqual([]); // taken
    expect(patch(a.code, [{ op: "add", path: "/claims/-", value: gift }], "s").applied).toEqual([]); // already ours
    expect(patch(b.code, [{ op: "add", path: "/claims/-", value: 2 }], "s").applied).toHaveLength(1); // the honeymoon fund is shared
    expect(patch(a.code, [{ op: "add", path: "/claims/-", value: 2 }], "s").applied).toHaveLength(1);
    expect(patch(a.code, [{ op: "add", path: "/claims/-", value: 999 }, { op: "add", path: "/claims/-", value: "x" }], "s").applied).toEqual([]);
    expect(patch(a.code, [{ op: "remove", path: `/claims/${gift}` }], "s").applied).toHaveLength(1);
    expect(history(doc(a))[0]!.inverse).toEqual([{ op: "add", path: "/claims/-", value: gift }]);
    expect(patch(a.code, [{ op: "remove", path: `/claims/${gift}` }, { op: "remove", path: "/claims/x" }, { op: "replace", path: `/claims/${gift}`, value: 1 }], "s").applied).toEqual([]);
    expect(patch(b.code, [{ op: "add", path: "/claims/-", value: gift }], "s").applied).toHaveLength(1); // free again
  });

  test("a path the document does not have is ignored", () => {
    const h = invite();
    expect(patch(h.code, [{ op: "replace", path: "/code", value: "X" }, { op: "replace", path: "/guests/1/name", value: "X" }, { op: "replace", path: "", value: 1 }], "s").applied).toEqual([]);
  });
});
