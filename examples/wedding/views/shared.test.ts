import { describe, expect, test } from "bun:test";
import { runNames, timetableRows } from "./shared";

describe("say a thing once (CLAUDE.md)", () => {
  test("a family's names as a run: the surname shared with the name before, or with the code they stand under, is said once", () => {
    expect(runNames(["Ada Okafor", "Femi Okafor", "Kemi Okafor"], "OKAFOR")).toEqual(["Ada", "Femi", "Kemi"]);
    expect(runNames(["Ben Achterberg", "Mara Achterberg", "Tolu Adebayo", "Cher"], "BEN")).toEqual(["Ben Achterberg", "Mara", "Tolu Adebayo", "Cher"]);
    expect(runNames([])).toEqual([]);
  });

  test("the timetable says where an event is only where it moves: from the day's own place, or from the event before", () => {
    const event = (id: number, where_at: string | null) => ({ id, name: `E${id}`, when_at: null, where_at, notes: null, seq: id });
    const notes = (html: string) => [...html.matchAll(/<span class="note">([^<]*)<\/span>/g)].map((m) => m[1]);
    const day = [event(1, "The Mount Without"), event(2, "The Mount Without"), event(3, "The Old Vic"), event(4, null), event(5, "The Old Vic")];
    expect(notes(timetableRows(day, { at: "The Mount Without, Bristol" }))).toEqual(["The Old Vic"]);
    expect(notes(timetableRows(day))).toEqual(["The Mount Without", "The Old Vic"]);
  });
});
