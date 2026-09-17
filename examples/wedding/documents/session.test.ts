import { describe, expect, test } from "bun:test";
import { history, prefixDoc } from "../../../src/ledger";
import { closeAnswered, over, patch, read } from "./session";

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

  test("where a visit is, is one address: going anywhere puts away what was open, and keeps how collections are read", () => {
    const id = crypto.randomUUID();
    patch(id, [{ op: "replace", path: "/code", value: "OKAFOR" }, { op: "replace", path: "/reading/guests", value: "list" }, { op: "replace", path: "/page", value: "guests?guest=2" }]);
    expect(read(id).ui).toEqual({ page: "guests?guest=2", reading: { guests: "list" } });
    patch(id, [{ op: "replace", path: "/page", value: "asks" }]);
    expect(read(id).ui).toEqual({ page: "asks", reading: { guests: "list" } });
    patch(id, [{ op: "remove", path: "/page" }]);
    expect(read(id).ui).toEqual({ page: "", reading: { guests: "list" } });
  });

  test("what is open over the page is read out of the address: at most one of a guest, a gift, a row to keep, the answer, a new thing, a removal", () => {
    const at = (page?: string) => over({ page });
    expect(at()).toEqual({ path: "" });
    expect(at("households/3/asks")).toEqual({ path: "households/3/asks" });
    expect(at("guests?guest=2")).toEqual({ path: "guests", focus: 2 });
    expect(at("guests?guest=two")).toEqual({ path: "guests", focus: undefined }); // not a guest: no drawer
    expect(at("gifts?gift=3")).toEqual({ path: "gifts", gift: 3 });
    expect(at("courses?keep=courses/1")).toEqual({ path: "courses", keep: "courses/1" });
    expect(at("?answer")).toEqual({ path: "", answering: true });
    expect(at("asks?new=asks")).toEqual({ path: "asks", new: "asks" });
    expect(at("courses?confirm=courses/4")).toEqual({ path: "courses", confirm: "courses/4" });
    expect(at("gifts?attic=1")).toEqual({ path: "gifts" });
  });

  test("a modal is put away by the write that answers it: an add answers the ask, a removal the asking-first; anything else leaves it", () => {
    const id = crypto.randomUUID();
    patch(id, [{ op: "replace", path: "/code", value: "DASH" }, { op: "replace", path: "/page", value: "courses?new=courses" }]);
    closeAnswered(id, [{ op: "replace", path: "/courses/1/name" }]);
    expect(read(id).ui.page).toBe("courses?new=courses");
    closeAnswered(id, [{ op: "add", path: "/courses/-" }]);
    expect(read(id).ui.page).toBe("courses");
    patch(id, [{ op: "replace", path: "/page", value: "courses?confirm=courses/4" }]);
    closeAnswered(id, [{ op: "remove", path: "/courses/4" }]);
    expect(read(id).ui.page).toBe("courses");
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

  test("the eye hides what find misses, per collection, and closing find forgets it too", () => {
    const id = crypto.randomUUID();
    patch(id, [{ op: "replace", path: "/code", value: "OKAFOR" }]);
    // an eye with nothing to lower does nothing
    expect(patch(id, [{ op: "remove", path: "/hide/guests" }]).applied).toEqual([]);
    patch(id, [
      { op: "replace", path: "/filter/guests", value: "Ok" },
      { op: "replace", path: "/filter/gifts", value: "toast" },
      { op: "replace", path: "/hide/guests", value: true },
      { op: "replace", path: "/hide/gifts", value: true },
    ]);
    expect(read(id).ui.hide).toEqual({ guests: true, gifts: true });
    // pressed again, one eye lowers and the other stays
    patch(id, [{ op: "remove", path: "/hide/gifts" }]);
    expect(read(id).ui.hide).toEqual({ guests: true });
    // going to a page keeps the eye, as it keeps find's word
    patch(id, [{ op: "replace", path: "/page", value: "guests" }]);
    expect(read(id).ui.hide).toEqual({ guests: true });
    // closing find forgets the eye with the word; the last eye gone forgets the object
    patch(id, [{ op: "replace", path: "/hide/gifts", value: true }]);
    patch(id, [{ op: "remove", path: "/filter/guests" }]);
    expect(read(id).ui.hide).toEqual({ gifts: true });
    patch(id, [{ op: "remove", path: "/filter/gifts" }]);
    expect(read(id).ui.hide).toBeUndefined();
    expect(read(id).ui.filter).toBeUndefined();
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
