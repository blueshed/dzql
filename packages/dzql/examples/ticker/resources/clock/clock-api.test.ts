import { describe, expect, test } from "bun:test";
import { DEFAULT_TZ, ZONES, after, cityOf, offsetOf } from "./clock-api";

describe("clock document", () => {
  test("the default city is Zurich; the zones are the runtime's own", () => {
    expect(DEFAULT_TZ).toBe("Europe/Zurich");
    expect(ZONES).toContain("Asia/Tokyo");
    expect(ZONES.length).toBeGreaterThan(300);
  });

  test("a city is the zone's last segment, spoken; an offset is the zone's, now", () => {
    expect(cityOf("America/New_York")).toBe("New York");
    expect(cityOf("UTC")).toBe("UTC");
    expect(offsetOf("Asia/Tokyo")).toBe("+09:00");
    expect(offsetOf("Asia/Kolkata")).toBe("+05:30");
    expect(offsetOf("UTC")).toBe("+00:00");
    expect(offsetOf("America/New_York", new Date("2026-01-15T12:00:00Z"))).toBe("-05:00");
  });

  test("replace /tz with a zone the runtime knows applies, trimmed; anything else is nothing", () => {
    expect(after(DEFAULT_TZ, [{ op: "replace", path: "/tz", value: " Asia/Tokyo " }])).toBe("Asia/Tokyo");
    expect(after(DEFAULT_TZ, [{ op: "replace", path: "/tz", value: "Mars/Base" }, { op: "remove", path: "/tz" }, { op: "replace", path: "/city", value: "Tokyo" }])).toBe(DEFAULT_TZ);
  });
});
