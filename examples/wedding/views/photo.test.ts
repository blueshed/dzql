import { describe, expect, test } from "bun:test";
import { familiesPhoto, type Family } from "./photo";

const look = { skin: "#F2C86A", hair: "bob", hair_color: "#2B2B33", top: "#1E3F8F", legs: "#2B2B33", face: "smile", attitude: "nodding" } as const;
const family = (key: string, names: (string | undefined)[], label?: string): Family => ({ key, label, members: names.map((name, i) => ({ key: `${key}-${i}`, spec: { ...look, name } })) });

describe("familiesPhoto", () => {
  test("beyond sixteen, one figure a family, each named for a screen reader: a family of one by the person", () => {
    const crowd = family("crowd", Array.from({ length: 17 }, (_, i) => `Guest${i} Crowd`), "CROWD");
    const names = (families: Family[]) => familiesPhoto(families, null).entries.map((e) => e.name);
    // the couple's photo: the code on the chest, or the one person
    expect(names([family("ben", ["Ben Achterberg"], "BEN"), crowd])).toEqual(["Ben Achterberg", "CROWD, a family of 17"]);
    // everyone's photo, before the day: no code and no names, so a family of one is "a guest"
    expect(names([family("ben", [undefined]), family("crowd", Array(17).fill(undefined))])).toEqual(["a guest", "a family of 17"]);
  });
});
