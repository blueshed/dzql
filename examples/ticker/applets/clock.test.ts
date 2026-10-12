import { describe, expect, test } from "bun:test";
import { SWEEP_S, cityOf, clockSvg, handsAt, partsIn, timeSaid, tzAfter } from "./clock";

describe("clock", () => {
  test("the hands: the hour hand between hours, the minute hand on the minute, the seconds hand sweeping the dial in SWEEP_S and waiting at the top", () => {
    expect(handsAt(3, 0, 0)).toEqual({ hour: 90, minute: 0, second: 0 });
    expect(handsAt(15, 30, 0).hour).toBe(105); // half past three, on a twelve-hour dial
    expect(handsAt(0, 45, SWEEP_S / 2)).toEqual({ hour: 22.5, minute: 270, second: 180 });
    expect(handsAt(0, 0, SWEEP_S).second).toBe(360);
    expect(handsAt(0, 0, 59.9).second).toBe(360); // the stop: held at twelve until the minute
  });

  test("the face has sixty marks, twelve of them large, and three hands; the city is the cell's to say, not the face's", () => {
    const svg = clockSvg();
    expect((svg.match(/<rect/g) ?? []).length).toBe(60 + 3);
    expect((svg.match(/height="12"/g) ?? []).length).toBe(12);
    expect(svg).toContain('class="hand second"');
    expect(svg).not.toContain("<text");
    expect(svg).toContain('role="img" aria-label="the time"'); // until the applet says it
  });

  test("the time as a reader hears it, on a twenty-four-hour clock", () => {
    expect(timeSaid(14, 5)).toBe("14:05");
    expect(timeSaid(0, 0)).toBe("00:00");
  });

  test("the city is the zone's last segment, spoken; the zone after the clock's ops is its last replace", () => {
    expect(cityOf("America/New_York")).toBe("New York");
    expect(cityOf("UTC")).toBe("UTC");
    expect(tzAfter("Europe/Zurich", [{ op: "replace", path: "/tz", value: "Asia/Tokyo" }, { op: "replace", path: "", value: { tz: "Asia/Seoul" } }, { op: "replace", path: "/tz", value: 9 }, { op: "remove", path: "/tz" }])).toBe("Asia/Tokyo");
    expect(tzAfter("Europe/Zurich", [])).toBe("Europe/Zurich");
  });

  test("the wall-clock parts in a time zone", () => {
    const t = partsIn("Europe/Zurich", new Date("2026-09-15T10:30:45.250Z"));
    expect(t).toEqual({ hour: 12, minute: 30, second: 45, ms: 250 }); // CEST is two hours ahead
    expect(partsIn("UTC", new Date("2026-01-01T00:00:00.000Z")).hour).toBe(0);
  });
});
