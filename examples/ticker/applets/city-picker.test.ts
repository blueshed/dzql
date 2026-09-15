import { describe, expect, test } from "bun:test";
import { SHOWN, matches, step, type Zone } from "./city-picker";

const zone = (tz: string, offset: string): Zone => {
  const city = (tz.split("/").pop() ?? tz).replaceAll("_", " ");
  const area = tz.includes("/") ? tz.slice(0, tz.indexOf("/")) : "";
  return { tz, city, label: `${city}${area ? `, ${area}` : ""} (UTC${offset})` };
};
const zones = [
  zone("America/Blanc-Sablon", "-04:00"),
  zone("America/Miquelon", "-02:00"),
  zone("Arctic/Longyearbyen", "+02:00"),
  zone("Europe/London", "+01:00"),
  zone("Asia/Tokyo", "+09:00"),
  zone("America/New_York", "-04:00"),
  zone("UTC", "+00:00"),
];

describe("city picker", () => {
  test("a city that starts with the query comes before one that merely contains it, whatever the list's order", () => {
    expect(matches(zones, "lon").map((z) => z.tz)).toEqual(["Europe/London", "Arctic/Longyearbyen", "America/Blanc-Sablon", "America/Miquelon"]);
    expect(matches(zones, "New").map((z) => z.tz)).toEqual(["America/New_York"]);
    expect(matches(zones, "asia").map((z) => z.tz)).toEqual(["Asia/Tokyo"]); // the area matches too, after cities
    expect(matches(zones, "+09").map((z) => z.tz)).toEqual(["Asia/Tokyo"]); // and the offset
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
