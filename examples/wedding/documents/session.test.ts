import { describe, expect, test } from "bun:test";
import { history, prefixDoc } from "../../../src/ledger";
import { patch, read } from "./session";

describe("session document (a visit)", () => {
  test("a fresh visit has no code, no kind, no ui", () => {
    expect(read(crypto.randomUUID())).toEqual({ code: null, kind: null, ui: {}, note: null });
  });

  test("entering a household's code, however spelt, opens it as a household; the couple's opens the board", () => {
    const id = crypto.randomUUID();
    expect(patch(id, [{ op: "replace", path: "/code", value: " okafor " }]).applied).toHaveLength(1);
    expect(read(id)).toMatchObject({ code: "OKAFOR", kind: "household", note: null });
    patch(id, [{ op: "replace", path: "/code", value: "dash" }]);
    expect(read(id)).toMatchObject({ code: "DASH", kind: "couple" });
  });

  test("an unknown code does not apply, and leaves a note for the welcome to say", () => {
    const id = crypto.randomUUID();
    expect(patch(id, [{ op: "replace", path: "/code", value: "NOPE" }]).applied).toEqual([]);
    expect(read(id)).toMatchObject({ code: null, note: "That code was not recognised." });
    // a blank is the same refusal
    expect(patch(id, [{ op: "replace", path: "/code", value: "  " }]).applied).toEqual([]);
  });

  test("leaving forgets the code, the ui and the note", () => {
    const id = crypto.randomUUID();
    patch(id, [{ op: "replace", path: "/code", value: "OKAFOR" }, { op: "replace", path: "/page", value: "gifts" }]);
    expect(patch(id, [{ op: "remove", path: "/code" }]).applied).toHaveLength(1);
    expect(read(id)).toEqual({ code: null, kind: null, ui: {}, note: null });
  });

  test("a resend is acknowledged the same way whether or not the address is known; a blank one is ignored", () => {
    const id = crypto.randomUUID();
    expect(patch(id, [{ op: "replace", path: "/resend", value: "" }]).applied).toEqual([]);
    expect(patch(id, [{ op: "replace", path: "/resend", value: "nobody@example.com" }]).applied).toHaveLength(1);
    expect(read(id).note).toBe("Sent, if we know that address.");
  });

  test("going to a page closes every drawer but keeps how collections are read", () => {
    const id = crypto.randomUUID();
    patch(id, [
      { op: "replace", path: "/code", value: "OKAFOR" },
      { op: "replace", path: "/reading/guests", value: "list" },
      { op: "replace", path: "/focus", value: "2" },
      { op: "replace", path: "/gift", value: 1 },
      { op: "replace", path: "/keep", value: "gifts/1" },
      { op: "replace", path: "/answering", value: "1" },
    ]);
    expect(read(id).ui).toEqual({ reading: { guests: "list" }, focus: 2, gift: 1, keep: "gifts/1", answering: true });
    patch(id, [{ op: "replace", path: "/page", value: "asks" }]);
    expect(read(id).ui).toEqual({ page: "asks", reading: { guests: "list" } });
  });

  test("a drawer closes by a remove; a focus or gift that is not a number is ignored", () => {
    const id = crypto.randomUUID();
    patch(id, [{ op: "replace", path: "/code", value: "OKAFOR" }]);
    expect(patch(id, [{ op: "replace", path: "/focus", value: "two" }]).applied).toEqual([]);
    expect(patch(id, [{ op: "replace", path: "/gift", value: true }]).applied).toEqual([]);
    patch(id, [{ op: "replace", path: "/focus", value: 2 }, { op: "replace", path: "/gift", value: "3" }, { op: "replace", path: "/keep", value: "courses/1" }, { op: "replace", path: "/answering", value: "1" }]);
    patch(id, [{ op: "remove", path: "/focus" }, { op: "remove", path: "/gift" }, { op: "remove", path: "/keep" }, { op: "remove", path: "/answering" }]);
    expect(read(id).ui).toEqual({});
  });

  test("find opens, closes and forgets its own word -- one key of several, then the last one, then a close with nothing open at all", () => {
    const id = crypto.randomUUID();
    patch(id, [{ op: "replace", path: "/code", value: "OKAFOR" }]);
    // closing find before it was ever open does nothing
    expect(patch(id, [{ op: "remove", path: "/filter/guests" }]).applied).toEqual([]);
    patch(id, [
      { op: "replace", path: "/filter/guests", value: "" },
      { op: "replace", path: "/filter/gifts", value: "Ok" },
    ]);
    expect(read(id).ui.filter).toEqual({ guests: "", gifts: "Ok" });
    // closing one leaves the other's word alone -- find is per collection, not one switch
    patch(id, [{ op: "remove", path: "/filter/guests" }]);
    expect(read(id).ui.filter).toEqual({ gifts: "Ok" });
    // and closing the last one forgets find altogether, not an empty filter object
    patch(id, [{ op: "remove", path: "/filter/gifts" }]);
    expect(read(id).ui).toEqual({});
  });

  test("an unknown path, or a reading without a key, is ignored", () => {
    const id = crypto.randomUUID();
    expect(patch(id, [{ op: "replace", path: "/nope", value: 1 }, { op: "remove", path: "/reading" }]).applied).toEqual([]);
  });

  test("nothing a visit does goes on the ledger", () => {
    const id = crypto.randomUUID();
    const result = patch(id, [{ op: "replace", path: "/code", value: "OKAFOR" }, { op: "replace", path: "/page", value: "gifts" }]);
    expect(result.version).toBe(0);
    expect(history(prefixDoc("session", id))).toEqual([]);
  });

  test("a code that has since stopped existing reads as no code", () => {
    const id = crypto.randomUUID();
    // written straight into the row, as a household deleted from under a tab would leave it
    const { db } = require("../db");
    db.run("INSERT INTO visits (id, code, ui, note, created_at) VALUES (?, 'GONE', '{}', NULL, 0)", [id]);
    expect(read(id)).toMatchObject({ code: null, kind: null });
  });
});
