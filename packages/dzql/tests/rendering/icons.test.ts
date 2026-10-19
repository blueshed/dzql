import { describe, expect, test } from "bun:test";
import { svg, type IconNode } from "../../src/rendering/icons";

const cross: IconNode = [
  ["path", { d: "M18 6 6 18" }],
  ["path", { d: "m6 6 12 12" }],
];

describe("svg", () => {
  test("renders a node list as a stroked, 24-grid SVG at the size asked, decorative by default", () => {
    const out = svg(cross, { size: 20, name: "x" });
    expect(out).toContain('<svg class="icon icon-x" width="20" height="20" viewBox="0 0 24 24"');
    expect(out).toContain('stroke="currentColor"');
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>');
  });

  test("a label makes it an image that says what it is; no name means the plain class", () => {
    const out = svg([["circle", { cx: 12, cy: 12, r: 10 }]], { label: "Close" });
    expect(out).toContain('class="icon"');
    expect(out).toContain('role="img" aria-label="Close"');
    expect(out).toContain('<circle cx="12" cy="12" r="10"/>');
    expect(svg(cross)).toContain('width="16" height="16"');
  });

  test("an attribute lucide leaves undefined is left out, not written as the word", () => {
    expect(svg([["path", { d: "M5 12h14", key: undefined }]])).toContain('<path d="M5 12h14"/>');
  });
});
