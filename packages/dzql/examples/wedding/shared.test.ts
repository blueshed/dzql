import { describe, expect, test } from "bun:test";
import { runNames, timetableRows } from "./shared";

describe("say a thing once (CLAUDE.md)", () => {
  test("a family's names as a run: the surname shared with the name before, or with the code they stand under, is said once", () => {
    expect(runNames(["Ada Okafor", "Femi Okafor", "Kemi Okafor"], "OKAFOR")).toEqual(["Ada", "Femi", "Kemi"]);
    expect(runNames(["Ben Achterberg", "Mara Achterberg", "Tolu Adebayo", "Cher"], "BEN")).toEqual(["Ben Achterberg", "Mara", "Tolu Adebayo", "Cher"]);
    expect(runNames([])).toEqual([]);
  });

  test("the timetable names where an event is only where it moves from the row above (or the day's own place); keeping the list, a repeat says so", () => {
    const event = (id: number, where_at: string | null) => ({ id, name: `E${id}`, when_at: null, where_at, notes: null, seq: id });
    const notes = (html: string) => [...html.matchAll(/<span class="(?:what|note)">([^<]*)<\/span>/g)].map((m) => m[1]).join(" ");
    const day = [event(1, "The Mount Without"), event(2, "The Mount Without"), event(3, "The Old Vic"), event(4, null), event(5, "The Old Vic")];
    // a guest reads it under the day's place: only a move is named, and a place not set breaks the run
    expect(notes(timetableRows(day, { at: "The Mount Without, Bristol" }))).toBe("E1 E2 E3 The Old Vic E4 E5 The Old Vic");
    // the couple keep it: a repeat says "same place", so E4, with no place yet, is not read as the Old Vic
    expect(notes(timetableRows(day, { open: (id) => ` data-id="${id}"` }))).toBe("E1 The Mount Without E2 same place E3 The Old Vic E4 E5 The Old Vic");
  });
});
