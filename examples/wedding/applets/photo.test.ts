import { describe, expect, test } from "bun:test";
import { photoSvg, type PhotoEntry } from "./photo";

const look = { skin: "#F2C86A", hair: "bob", hair_color: "#2B2B33", top: "#1E3F8F", legs: "#2B2B33", face: "smile", attitude: "nodding" } as const;

describe("photoSvg", () => {
  test("draws each entry in its slot, keyed for a tap when it carries one, the frame around them all", () => {
    const entries: PhotoEntry[] = [
      { key: "1", spec: { ...look, name: "Ada" }, tap: { doc: "session", op: { op: "replace", path: "/page", value: "guests?guest=1" } } },
      { key: "2", spec: look, ghost: true },
      { key: "3", spec: look, out: true, mark: "yes", count: 3 },
    ];
    const svg = photoSvg(entries, "the family");
    expect(svg).toStartWith('<svg class="photo" viewBox="');
    expect(svg).toContain('aria-label="the family"');
    expect(svg).toContain('role="button" tabindex="0" data-key="1" aria-pressed="false"');
    expect(svg).toContain('class="fig att-nodding ghost"');
    expect(svg).toContain('class="fig att-nodding out"');
    expect(svg).toContain('class="mark mark-yes"');
    expect(svg).toContain('<g class="count"><circle cx="82" cy="46" r="10"/><text x="82" y="49.5" text-anchor="middle">3</text></g>');
    expect(svg).toContain('<g class="print">');
    expect(svg).not.toContain("walk");
    expect(svg).not.toContain("descend");
    expect(svg).not.toContain("data-reveal");
    expect(svg).not.toContain('class="ring"');
  });

  test("a chosen figure rings, is marked pressed, and scrolls into the clear (K2, rule 13)", () => {
    const entries: PhotoEntry[] = [
      { key: "1", spec: { ...look, name: "Ada" }, tap: { doc: "session", op: { op: "replace", path: "/page", value: "guests?guest=1" } }, chosen: true },
      { key: "2", spec: look },
    ];
    const svg = photoSvg(entries, "the family");
    expect(svg).toContain('role="button" tabindex="0" data-key="1" aria-pressed="true"');
    expect(svg).toContain(" data-reveal>");
    expect(svg).toContain('<g class="slot chosen"');
    expect(svg).toContain('<ellipse class="ring" cx="50" cy="72" rx="58" ry="80"/>');
    // the unchosen figure carries neither
    expect(svg).toContain('<g class="slot" transform');
  });

  test("a figure the word misses hushes, never hides (rule 17)", () => {
    const entries: PhotoEntry[] = [
      { key: "1", spec: { ...look, name: "Ada" } },
      { key: "2", spec: { ...look, name: "Femi" }, hushed: true },
    ];
    const svg = photoSvg(entries, "the family");
    expect(svg).toContain('<g class="slot" transform');
    expect(svg).toContain('<g class="slot hushed" transform');
  });

  test("a newcomer walks in from the nearest side; a bomber lunges from beyond the frame; a count of one is no count", () => {
    const entries: PhotoEntry[] = [
      { key: "a", spec: look, count: 1 },
      { key: "b", spec: look },
      { key: "c", spec: { ...look, attitude: "photo-bombing" } },
      // a second bomber, so one lunges from the left and the other from the right (arrange.ts
      // puts a lone bomber only ever at the right)
      { key: "d", spec: { ...look, attitude: "photo-bombing" } },
    ];
    const svg = photoSvg(entries, "x", new Set(["b", "c"]));
    expect(svg).toContain('<g class="walk" style="--walk-from: ');
    expect(svg).toContain("walking");
    expect(svg.match(/style="--lunge-from: /g)?.length).toBe(2);
    expect(svg).not.toContain('class="count"');
    // a marked photo leaves room at the feet for the marks
    const plain = photoSvg([{ key: "a", spec: look }], "x");
    const marked = photoSvg([{ key: "a", spec: look, mark: "no" }], "x");
    const h = (s: string) => Number(s.match(/viewBox="[^"]* ([0-9]+)"/)![1]);
    expect(h(marked)).toBe(h(plain) + 12);
  });

  test("on the day the names come down, one after another", () => {
    const svg = photoSvg([{ key: "1", spec: { ...look, name: "Ada" } }, { key: "2", spec: { ...look, name: "Femi" } }], "x", new Set(), true);
    expect(svg).toContain('class="print descend" style="--drop: ');
    expect(svg).toContain("--i: 0");
    expect(svg).toContain("--i: 1");
  });
});
