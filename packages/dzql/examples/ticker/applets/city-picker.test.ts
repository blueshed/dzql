import { describe, expect, test } from "bun:test";
import { SHOWN, cityIn, matches, step, type Zone } from "./city-picker";

const zone = (tz: string, offset: string): Zone => {
  const parts = tz.split("/");
  const city = (parts.pop() ?? tz).replaceAll("_", " ");
  const region = parts.length > 1 ? parts[1]!.replaceAll("_", " ") : "";
  const label = `${city}${region ? `, ${region}` : ""} (UTC${offset})`;
  return { tz, city: cityIn(label), label };
};
const zones = [
  zone("America/Blanc-Sablon", "-04:00"),
  zone("America/Miquelon", "-02:00"),
  zone("Arctic/Longyearbyen", "+02:00"),
  zone("Europe/London", "+01:00"),
  zone("Asia/Tokyo", "+09:00"),
  zone("America/New_York", "-04:00"),
  zone("America/Argentina/Buenos_Aires", "-03:00"),
  zone("UTC", "+00:00"),
];

describe("city picker", () => {
  test("the city in a label is what comes before the region or the offset", () => {
    expect(cityIn("London (UTC+01:00)")).toBe("London");
    expect(cityIn("Buenos Aires, Argentina (UTC-03:00)")).toBe("Buenos Aires");
    expect(cityIn("UTC")).toBe("UTC");
  });

  test("a city that starts with the query comes before one that merely contains it, the shortest first, whatever the list's order", () => {
    expect(matches(zones, "lon").map((z) => z.tz)).toEqual(["Europe/London", "Arctic/Longyearbyen", "America/Blanc-Sablon", "America/Miquelon"]);
    expect(matches(zones, "New").map((z) => z.tz)).toEqual(["America/New_York"]);
    expect(matches(zones, "argent").map((z) => z.tz)).toEqual(["America/Argentina/Buenos_Aires"]); // the region matches too, after cities
    expect(matches(zones, "+09").map((z) => z.tz)).toEqual(["Asia/Tokyo"]); // and the offset
    expect(matches(zones, "america")).toEqual([]); // a continent is not a place to show the time of
    expect(matches(zones, "  ")).toEqual([]);
    expect(matches(zones, "zzz")).toEqual([]);
  });

  test("the arrow keys move the highlight within the list and no further", () => {
    expect(step(0, 4, "ArrowDown")).toBe(1);
    expect(step(3, 4, "ArrowDown")).toBe(3);
    expect(step(2, 4, "ArrowUp")).toBe(1);
    expect(step(0, 4, "ArrowUp")).toBe(0);
    expect(step(2, 0, "ArrowDown")).toBe(0);
    expect(step(2, 4, "Tab")).toBe(2);
  });

  test("no more than SHOWN", () => {
    const many = Array.from({ length: 20 }, (_, i) => zone(`Area/Town${i}`, "+00:00"));
    expect(matches(many, "town")).toHaveLength(SHOWN);
  });
});
