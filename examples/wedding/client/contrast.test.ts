// The wedding's colours against WCAG 2.2: text at 4.5:1 (1.4.3); large text, a control's edge and a
// mark that means something at 3:1 (1.4.3, 1.4.11). Each pair is read from the tokens styles.css
// says on :root, so changing a token there is checked here. The wedding has one palette, the
// save-the-date's paper: it says `color-scheme: light` and nothing for a reader who prefers dark,
// so they read these same pairs. A dark palette would need its own pairs here.
//
// A bright fill -- the invitation's gold on Open, maybe's amber -- keeps its colour and carries ink,
// which is what is read on it. Where a bright fill is a mark that means something on its own (the dot
// beside maybe, the mark at a guest's feet), its edge is the deeper shade, and the edge is what is checked.
import { describe, expect, test } from "bun:test";

const css = await Bun.file(`${import.meta.dir}/styles.css`).text();

const tokens = new Map([...css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {"))).matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));

type Rgba = [r: number, g: number, b: number, a: number];

/** A token (its name) or a colour, resolved through var() to what the browser paints. */
function colour(of: string): Rgba {
  const value = tokens.has(of) ? tokens.get(of)! : of;
  const ref = /^var\(--([\w-]+)\)$/.exec(value);
  if (ref) return colour(ref[1]!);
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1]!.slice(i, i + 2), 16)).concat(1) as Rgba;
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value);
  if (rgba) return rgba.slice(1).map(Number) as Rgba;
  throw new Error(`not a colour: ${of} (${value})`);
}

const luminance = ([r, g, b]: Rgba): number => {
  const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

/** The contrast of `fg` painted over `bg`: a see-through `fg` (the edge) is laid over it first. */
function contrast(fg: string, bg: string): number {
  const back = colour(bg);
  const [r, g, b, a] = colour(fg);
  const front: Rgba = [r * a + back[0] * (1 - a), g * a + back[1] * (1 - a), b * a + back[2] * (1 - a), 1];
  const [hi, lo] = [luminance(front), luminance(back)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT = 4.5;
const LARGE = 3; // large text (24px, or 18.66px bold), a control's edge, a mark that means something

const pairs: [fg: string, bg: string, min: number, what: string][] = [
  ["ink", "paper", TEXT, "the words on the paper"],
  ["ink", "card", TEXT, "the words on a card"],
  ["muted", "card", TEXT, "a note, a tally, a state"],
  ["muted", "paper", TEXT, "a note on the welcome"],
  ["accent", "card", TEXT, "a tool, a link, a drawer's heading"],
  ["navy", "paper", TEXT, "the welcome's message"],
  ["royal", "paper", LARGE, "the couple's names, the top of their gradient"],
  ["card", "accent", TEXT, "a pressed tool"],
  ["card", "leaf", TEXT, "a pressed Yes"],
  ["card", "burgundy", TEXT, "a pressed No"],
  ["add", "card", TEXT, "a tool that makes"],
  ["danger", "card", TEXT, "a tool that removes"],
  ["leaf", "card", TEXT, "a gift claimed by us"],
  ["red-deep", "card", TEXT, "a gift another household took"],
  ["ink", "gold", TEXT, "Open: ink on the invitation's gold"],
  ["paper", "navy", TEXT, "a chosen dish; the count on a family's figure"],
  ["gold-deep", "paper", LARGE, "the ampersand between the names"],
  ["gold-deep", "card", LARGE, "the ampersand in the welcome's drawer"],
  ["mark", "card", LARGE, "the pencil on a thing and a row"],
  ["edge", "card", LARGE, "a control's edge: a field, a stack, a pill, a swatch"],
  ["edge", "paper", LARGE, "a pill's edge, inside it"],
  ["leaf", "card", LARGE, "yes: the dot beside the word, the face's disc"],
  ["amber-deep", "card", LARGE, "maybe: the edge of its dot"],
  ["red", "card", LARGE, "no: the dot, the face's disc"],
  ["#FFFFFF", "leaf", LARGE, "the face on yes's disc"],
  ["ink", "amber", LARGE, "the face on maybe's disc"],
  ["#FFFFFF", "red", LARGE, "the face on no's disc"],
  ["leaf", "well", LARGE, "yes: the mark at a guest's feet in the photo"],
  ["amber-deep", "well", LARGE, "maybe: the edge of the mark at a guest's feet"],
  ["red", "well", LARGE, "no: the mark at a guest's feet"],
  ["muted", "well", LARGE, "no answer: the dashed mark at a guest's feet; a ghost's outline"],
];

describe("the wedding's colours", () => {
  for (const [fg, bg, min, what] of pairs) {
    test(`${what}: ${fg} on ${bg} at ${min}:1`, () => {
      expect(Number(contrast(fg, bg).toFixed(2))).toBeGreaterThanOrEqual(min);
    });
  }

  test("one palette, whatever the reader prefers: light, and nothing said for dark", () => {
    expect(css).toContain("html { color-scheme: light; }");
    expect(css).not.toContain("prefers-color-scheme");
  });
});
