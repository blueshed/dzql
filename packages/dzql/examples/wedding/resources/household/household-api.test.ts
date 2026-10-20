import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDocuments, setActiveDocuments } from "dzql/rendering/documents";
import type { PatchOp } from "dzql/rendering/json-patch";
import { db, delta } from "../../store";
import { householdFrom, read, shape, whatItDid, type HouseholdDocument } from "./household-api";
import * as weddingDoc from "../wedding/wedding-api";

let offer: Parameters<typeof shape>[1];
let documents: ReturnType<typeof createDocuments>;

beforeAll(async () => {
  documents = createDocuments(delta);
  setActiveDocuments(documents);
  for (const doc of ["household:1", "household:nope", "wedding:1", "everyone:1"]) await documents.load(doc);
  offer = { courses: weddingDoc.courses(), gifts: weddingDoc.gifts().map(({ id, shared }) => ({ id, shared })) };
});

afterAll(() => setActiveDocuments(undefined));

const NOW = "2026-09-24T12:00:00Z";
const okafors = (): HouseholdDocument => read("1")!;
const shaped = (h: HouseholdDocument, ...ops: PatchOp[]) => shape(h, offer, ops, NOW);

describe("a household", () => {
  test("reads whole: the row, the guests wearing their figures with their choices, the asks, the claims in the order made", () => {
    const h = okafors();
    expect(h).toMatchObject({ id: 1, code: "OKAFOR", plus_ones: 1, answer: "yes", message: "Cannot wait." });
    expect(h.guests[1]).toMatchObject({ id: 2, name: "Femi Okafor", named_by: "couple", coming: 1, choices: {} });
    expect(h.guests[1]!.minifigure).toMatchObject({ hair: "short", face: "grin", built_at: "2026-09-01T09:00:00Z" });
    expect(h.asks).toEqual([{ id: 1, name: "Kemi Okafor", asked_at: "2026-09-01T08:00:00Z", reply: null, guest_id: null }]);
    expect(read("nope")).toBeUndefined();
  });

  test("its claims come in the order they were made, whichever gift", () => {
    const claim = (id: number, gift: number, at: string) => ({ id, households_id: 1, gift_id: gift, claimed_at: at });
    const h = householdFrom({ id: 1, code: "X", email: "x@y", plus_ones: 0 } as never, { claims: { "1": claim(1, 3, "2026-02-01"), "2": claim(2, 1, "2026-01-01"), "3": { ...claim(3, 2, "2025-01-01"), households_id: 9 } } as never });
    expect(h.claims).toEqual([1, 3]);
  });
});

describe("what a household's write becomes", () => {
  test("the answer and the message: a valid value, a change, or nothing", () => {
    expect(shaped(okafors(), { op: "replace", path: "/answer", value: "maybe" }, { op: "remove", path: "/message" })).toEqual([
      { op: "replace", path: "/households/answer", value: "maybe" },
      { op: "replace", path: "/households/message", value: null },
    ]);
    expect(shaped(okafors(), { op: "replace", path: "/answer", value: "yes" }, { op: "replace", path: "/answer", value: "perhaps" }, { op: "replace", path: "/message", value: " Cannot wait. " })).toEqual([]);
    expect(shaped({ ...okafors(), answer: "no" }, { op: "remove", path: "/answer" })).toEqual([{ op: "replace", path: "/households/answer", value: null }]);
  });

  test("a plus-one, by name, while one is owed; an ask, by name, never answered", () => {
    const [plus, ...rest] = shaped(okafors(), { op: "add", path: "/guests/-", value: { name: " Tolu ", named_by: "couple", coming: 1 } }, { op: "add", path: "/guests/-", value: "Two" });
    expect(plus!.value).toEqual({ name: "Tolu", named_by: "household" });
    expect(rest).toEqual([]); // one owed, one taken
    expect(shaped(okafors(), { op: "add", path: "/guests/-", value: " " }, { op: "replace", path: "/guests/-", value: "X" })).toEqual([]);
    const [ask] = shaped(okafors(), { op: "add", path: "/asks/-", value: { name: "Ngozi", reply: "yes" } });
    expect(ask!.value).toEqual({ name: "Ngozi", asked_at: NOW, reply: null, guest_id: null });
    expect(shaped(okafors(), { op: "add", path: "/asks/-", value: "" }, { op: "remove", path: "/asks/1" })).toEqual([]);
  });

  test("a guest's coming, look and choices: each checked, each a change or nothing", () => {
    expect(shaped(okafors(), { op: "replace", path: "/guests/2/coming", value: "no" }, { op: "replace", path: "/guests/2/coming", value: "no" }, { op: "remove", path: "/guests/2/coming" })).toEqual([
      { op: "replace", path: "/guests/2/coming", value: 0 },
      { op: "replace", path: "/guests/2/coming", value: null },
    ]);
    expect(shaped(okafors(), { op: "replace", path: "/guests/2/coming", value: "perhaps" }, { op: "replace", path: "/guests/9/coming", value: 1 }, { op: "replace", path: "/guests/2/name", value: "x" })).toEqual([]);

    // a look: Femi's is built, so only the field moves; Ada's is blank, so her first touch builds it, once
    expect(shaped(okafors(), { op: "replace", path: "/guests/2/minifigure/top", value: "#7FAE4E" })).toEqual([{ op: "replace", path: "/guests/2/top", value: "#7FAE4E" }]);
    expect(shaped(okafors(), { op: "replace", path: "/guests/1/minifigure/top", value: "#7FAE4E" }, { op: "replace", path: "/guests/1/minifigure/hair", value: "bob" })).toEqual([
      { op: "replace", path: "/guests/1/top", value: "#7FAE4E" },
      { op: "replace", path: "/guests/1/built_at", value: NOW },
      { op: "replace", path: "/guests/1/hair", value: "bob" },
    ]);
    expect(
      shaped(
        okafors(),
        { op: "replace", path: "/guests/2/minifigure/top", value: "#123456" }, // not on the palette
        { op: "replace", path: "/guests/2/minifigure/hair", value: "short" }, // the same
        { op: "remove", path: "/guests/2/minifigure/hair" },
        { op: "replace", path: "/guests/2/minifigure/built_at", value: NOW },
        { op: "replace", path: "/guests/2/minifigure/hair/x", value: "bob" },
      ),
    ).toEqual([]);

    // a choice: a dish or a drink the course offers; two in one message are one write of where they end
    expect(shaped(okafors(), { op: "replace", path: "/guests/2/choices/2/dish", value: "5" }, { op: "replace", path: "/guests/2/choices/2/drink", value: 3 })).toEqual([
      { op: "replace", path: "/guests/2/choices", value: { "2": { dish: 5, drink: 3 } } },
    ]);
    const chosen = okafors();
    chosen.guests[1]!.choices = { "2": { dish: 5, drink: null } };
    expect(shaped(chosen, { op: "remove", path: "/guests/2/choices/2/dish" })).toEqual([{ op: "replace", path: "/guests/2/choices", value: { "2": { dish: null, drink: null } } }]);
    expect(
      shaped(
        chosen,
        { op: "replace", path: "/guests/2/choices/2/dish", value: 5 }, // the same
        { op: "replace", path: "/guests/2/choices/2/dish", value: 1 }, // the starter's, not the main's
        { op: "replace", path: "/guests/2/choices/2/drink", value: "lots" },
        { op: "remove", path: "/guests/2/choices/2/drink" }, // not chosen
        { op: "replace", path: "/guests/2/choices/9/dish", value: 5 },
        { op: "replace", path: "/guests/2/choices/2/pudding", value: 5 },
      ),
    ).toEqual([]);
  });

  test("a claim: a gift there, not already theirs, and not taken unless shared, a row the store numbers; given back only if theirs, by its row's number", async () => {
    expect(shaped(okafors(), { op: "add", path: "/claims/-", value: "1" }, { op: "add", path: "/claims/-", value: 1 })).toEqual([
      { op: "add", path: "/claims/-", value: { gift_id: 1, claimed_at: NOW } },
    ]);
    expect(shaped(okafors(), { op: "add", path: "/claims/-", value: 99 }, { op: "replace", path: "/claims/-", value: 1 }, { op: "remove", path: "/claims/1" }, { op: "remove", path: "/claims/1/x" })).toEqual([]);
    const as = { identity: "test", cursor: "household-test" };
    await documents.write("household:1", [{ op: "add", path: "/claims/-", value: { gift_id: 2, claimed_at: NOW } }], as);
    const { id } = db.query<{ id: number }, []>("SELECT id FROM wedding_claims WHERE households_id = 1 AND gift_id = 2").get()!;
    const giveBack = shaped(okafors(), { op: "remove", path: "/claims/2" });
    expect(giveBack).toEqual([{ op: "remove", path: `/claims/${id}` }]);
    await documents.write("household:1", giveBack as never, as);
    expect(okafors().claims).toEqual([]);
  });
});

describe("what a household's write did, for Undo to say it took it back and Redo that it did it again", () => {
  test("in the household's words, from the rows it left and the rows as they were: an answer, a note, a guest's coming, choices or look, a plus-one, an ask, a claim", () => {
    const h = okafors();
    const gifts = [{ id: 1, name: "Le Creuset casserole" }];
    const row = (path: string, value: object): PatchOp => ({ op: "replace", path, value });
    const said = (left: PatchOp[], was: PatchOp[] = []) => whatItDid(left, was, h, gifts);
    const us = { answer: "yes", message: "Cannot wait." };
    expect(said([row("/households", { ...us, answer: "maybe" })], [row("/households", us)])).toEqual(["your answer"]);
    expect(said([row("/households", { answer: null, message: "Soon." })], [row("/households", us)])).toEqual(["your answer", "your note"]);
    const femi = { name: "Femi Okafor", coming: 1, top: "#1E3F8F", choices: null };
    expect(said([row("/guests/2", { ...femi, coming: 0 })], [row("/guests/2", femi)])).toEqual(["whether Femi Okafor is coming"]);
    expect(said([row("/guests/2", { ...femi, choices: { "2": { dish: 5, drink: null } } })], [row("/guests/2", femi)])).toEqual(["Femi Okafor's choices"]);
    expect(said([row("/guests/2", { ...femi, top: "#7FAE4E" })], [row("/guests/2", femi)])).toEqual(["Femi Okafor's look"]);
    expect(said([{ op: "add", path: "/guests/9", value: { name: "Tolu Adebayo", named_by: "household" } }])).toEqual(["bringing Tolu Adebayo"]);
    expect(said([{ op: "add", path: "/asks/4", value: { name: "Ngozi Okafor", reply: null } }])).toEqual(["asking for Ngozi Okafor"]);
    expect(said([{ op: "add", path: "/claims/5", value: { gift_id: 1 } }])).toEqual(["claiming “Le Creuset casserole”"]);
    expect(said([{ op: "remove", path: "/claims/5" }], [row("/claims/5", { gift_id: 1 })])).toEqual(["giving back “Le Creuset casserole”"]);
  });
});
