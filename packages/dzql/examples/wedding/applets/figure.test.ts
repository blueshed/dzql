import { describe, expect, test } from "bun:test";
import { arrange, figure, figureSvg, inkFor, isBomber, print, type Spec } from "./figure";

const spec: Spec = { skin: "#F2C86A", hair: "bob", hair_color: "#2B2B33", top: "#1E3F8F", legs: "#2B2B33", face: "smile", attitude: "waving" };

describe("figure", () => {
  test("draws the attitude as a class, the rest poses as attributes, the face's own mouth and eyes", () => {
    const g = figure(spec);
    expect(g).toStartWith('<g class="fig att-waving">');
    expect(g).toContain('class="tilt" transform="rotate(0 50 140)"');
    expect(g).toContain('class="arm arm-r" transform="rotate(-150 70 54)"'); // waving: the right arm up
    expect(g).toContain('class="mouth mouth-smile"');
    expect(g).not.toContain("glasses");
  });

  test("every hair, face and attitude draws: a wink is a line, exasperated raises the brows, a laugh opens the mouth, cool wears glasses, a bomber tilts", () => {
    expect(figure({ ...spec, hair: "none" })).not.toContain('class="hair"');
    for (const hair of ["short", "long", "curls"] as const) expect(figure({ ...spec, hair })).toContain('class="hair"');
    expect(figure({ ...spec, face: "wink" })).toContain('class="eye wink"');
    expect(figure({ ...spec, face: "exasperated" })).toContain('class="brows"');
    expect(figure({ ...spec, face: "laugh" })).toContain("mouth-open");
    expect(figure({ ...spec, face: "grin" })).toContain("mouth-grin");
    expect(figure({ ...spec, face: "wry" })).toContain("mouth-wry");
    expect(figure({ ...spec, attitude: "cool" })).toContain('class="glasses"');
    const bomber = figure({ ...spec, attitude: "photo-bombing" });
    expect(bomber).toContain("att-photo-bombing from-right");
    expect(bomber).toContain('transform="rotate(-15 50 140)"');
    expect(figure({ ...spec, attitude: "photo-bombing" }, { from: "left" })).toContain('transform="rotate(15 50 140)"');
    expect(figure({ ...spec, attitude: "photo-bombing" }, { from: "below" })).toContain('transform="rotate(0 50 140)"');
    expect(isBomber({ attitude: "photo-bombing" })).toBe(true);
  });

  test("classes, a chest print and a style ride along; a whole svg wraps one figure", () => {
    const g = figure(spec, { classes: ["ghost", "out"], print: print("Ada Okafor", spec.top), style: "--lunge-from: 5px" });
    expect(g).toStartWith('<g class="fig att-waving ghost out" style="--lunge-from: 5px">');
    expect(g).toContain('<g class="print"><text x="50" y="70"');
    expect(g).toContain(">Ada</text>");
    expect(g).toContain(">Okafor</text>");
    const svg = figureSvg(spec, 100);
    expect(svg).toStartWith('<svg viewBox="0 0 100 140" width="100" height="140"');
    expect(figureSvg(spec, 40, { viewBox: "24 -2 52 52", height: 43, classes: "head" })).toStartWith('<svg class="head" viewBox="24 -2 52 52" width="40" height="43"');
  });

  test("the print is one line for one name, sized to fit, and inked to read against the top", () => {
    expect(print("Ada", "#1E3F8F")).toContain('y="76"');
    expect(print("Ada", "#1E3F8F")).toContain('fill="#F3EDE0"'); // light on navy
    expect(print("Ada", "#FBF9F4")).toContain('fill="#2B2B33"'); // dark on paper
    expect(print("Bartholomew Featherstonehaugh", "#1E3F8F")).toMatch(/font-size="[0-9.]+"/);
    expect(inkFor("#000000")).toBe("#2B2B33".replace("#2B2B33", "#F3EDE0"));
    expect(print("A", "#000000")).toContain("<text"); // esc'd content
    expect(print("<b>", "#000000")).toContain("&lt;b&gt;");
  });
});

describe("arrange", () => {
  test("nobody is a portrait-sized empty frame", () => {
    expect(arrange(0)).toEqual({ slots: [], box: { x: -165, y: -200, w: 330, h: 200 } });
  });

  test("one person stands alone in a frame no narrower than a portrait", () => {
    const { slots, box } = arrange(1);
    expect(slots).toHaveLength(1);
    expect(box.w).toBe(330);
    expect(slots[0]).toMatchObject({ s: 1, k: 0, y: -140 });
  });

  test("a crowd stands in rows, back rows smaller and first in draw order, and the frame grows around them", () => {
    const { slots, box } = arrange(12);
    expect(slots).toHaveLength(12);
    const scales = [...new Set(slots.map((s) => s.s))];
    expect(scales.length).toBeGreaterThan(1);
    expect(slots[0]!.s).toBeLessThan(slots[slots.length - 1]!.s); // back row first
    expect(box.w).toBeGreaterThan(330);
    for (const s of slots) {
      expect(s.x).toBeGreaterThanOrEqual(box.x);
      expect(s.x + 100 * s.s).toBeLessThanOrEqual(box.x + box.w);
    }
  });

  test("bombers get a row of their own in front, lunging in from the sides or from below", () => {
    const one = arrange([{ attitude: "nodding" }, { attitude: "photo-bombing" }]);
    expect(one.slots.find((s) => s.k === 1)).toMatchObject({ from: "right", s: 1.06 });
    expect(one.slots[one.slots.length - 1]!.k).toBe(1); // drawn last: in front of everything
    const three = arrange([{ attitude: "nodding" }, { attitude: "photo-bombing" }, { attitude: "photo-bombing" }, { attitude: "photo-bombing" }]);
    expect(three.slots.filter((s) => s.from).map((s) => s.from).sort()).toEqual(["below", "left", "right"]);
    const below = three.slots.find((s) => s.from === "below")!;
    expect(below.y).toBeGreaterThan(three.slots.find((s) => s.from === "left")!.y); // rises to the waist, no further
    const only = arrange([{ attitude: "photo-bombing" }]);
    expect(only.slots).toHaveLength(1);
    expect(only.slots[0]!.from).toBe("right");
  });
});
