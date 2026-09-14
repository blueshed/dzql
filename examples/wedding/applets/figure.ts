// A minifigure drawn from its look as SVG, and a group photo arranged from many. Strings, not DOM,
// so the same module draws on the server (every page) and could in a browser. Coordinates are the
// figure's own: a 100 x 140 box, feet at y = 140. The attitude is a class that styles.css animates.

import type { Attitude, Face, Hair, Look } from "../looks";
import { esc } from "../views/html";

/** What the drawing takes: a look, and the name to print on the chest when the caller may show one. */
export type Spec = Omit<Look, "built_at"> & { name?: string };
/** Which edge a photo-bomber lunges in from, or from below. */
export type Side = "left" | "right" | "below";

/**
 * The face is the person's; the attitude is the moment -- and the two are independent. The face owns
 * the expression: eyes, mouth, brows. The attitude owns the body: the arms, the tilt, the movement,
 * and cool's glasses, a prop. No attitude opens the mouth; a laugh is a face.
 *
 * Each attitude's rest: the arms in degrees clockwise about the shoulder, and a tilt of the whole figure about its feet.
 */
export const POSE: Record<Attitude, { armL: number; armR: number; tilt: number }> = {
  waving: { armL: 9, armR: -150, tilt: 0 },
  nodding: { armL: 9, armR: -9, tilt: 0 },
  laughing: { armL: 25, armR: -25, tilt: 0 },
  cool: { armL: 9, armR: -9, tilt: 0 },
  "photo-bombing": { armL: 160, armR: -160, tilt: -15 },
};

/** Which figures do not stand in the line: they lunge in from an edge. */
export const isBomber = (spec: Pick<Spec, "attitude">): boolean => spec.attitude === "photo-bombing";

const INK = "#2B2B33";

type Attrs = Record<string, string | number | undefined>;

function tag(name: string, attrs: Attrs = {}, ...children: (string | null | false | undefined)[]): string {
  const a = Object.entries(attrs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${esc(v)}"`)
    .join("");
  return `<${name}${a}>${children.filter((c): c is string => typeof c === "string").join("")}</${name}>`;
}

/** Mouths a person can tell apart: a smile is a curve, a grin shows teeth, a wry one lifts a corner, an open one is dark. */
const MOUTH = {
  smile: () => tag("path", { d: "M41 34 Q50 41 59 34", fill: "none", stroke: INK, "stroke-width": 2.2, "stroke-linecap": "round", class: "mouth mouth-smile" }),
  grin: () => tag("path", { d: "M37 31 Q50 47 63 31 Z", fill: "#FBF9F4", stroke: INK, "stroke-width": 2, "stroke-linejoin": "round", class: "mouth mouth-grin" }),
  wry: () => tag("path", { d: "M41 35 Q50 37 59 31", fill: "none", stroke: INK, "stroke-width": 2.2, "stroke-linecap": "round", class: "mouth mouth-wry" }),
  open: () => tag("path", { d: "M39 31 Q50 49 61 31 Z", fill: INK, stroke: INK, "stroke-width": 1.5, "stroke-linejoin": "round", class: "mouth mouth-open" }),
};
/** The mouth each face wears. Exasperated is happy and ironic: the brows raised over a smile. Laugh is the open mouth. */
const FACE_MOUTH: Record<Face, keyof typeof MOUTH> = { smile: "smile", grin: "grin", wink: "smile", wry: "wry", exasperated: "smile", laugh: "open" };

function hair(spec: Spec): string | null {
  const c = spec.hair_color;
  const shapes: Record<Hair, () => string | null> = {
    none: () => null,
    short: () => tag("path", { d: "M31 21 Q31 4 50 4 Q69 4 69 21 Q69 14 50 13 Q31 14 31 21 Z", fill: c, class: "hair" }),
    bob: () => tag("path", { d: "M30 22 Q30 3 50 3 Q70 3 70 22 L70 40 Q66 43 64 37 L64 23 Q50 15 36 23 L36 37 Q34 43 30 40 Z", fill: c, class: "hair" }),
    long: () => tag("path", { d: "M30 22 Q30 3 50 3 Q70 3 70 22 L72 58 Q65 61 64 52 L64 23 Q50 15 36 23 L36 52 Q35 61 28 58 Z", fill: c, class: "hair" }),
    curls: () =>
      tag(
        "g",
        { class: "hair" },
        ...[[33, 15], [41, 8], [50, 5], [59, 8], [67, 15], [31, 25], [69, 25]].map(([x, y]) => tag("circle", { cx: x, cy: y, r: 7, fill: c })),
      ),
  };
  return shapes[spec.hair]();
}

function arm(side: "l" | "r", spec: Spec, rest: number): string {
  const x = side === "l" ? 30 : 70;
  const swing = tag(
    "g",
    { class: "swing" },
    tag("rect", { x: x - 7, y: 50, width: 14, height: 42, rx: 7, fill: spec.top }),
    tag("circle", { cx: x, cy: 94, r: 6, fill: spec.skin }),
  );
  return tag("g", { class: `arm arm-${side}`, transform: `rotate(${rest} ${x} 54)` }, swing);
}

export type FigureOptions = {
  from?: Side;
  /** Classes beside `fig att-<attitude>`: `out` (faded, still), `ghost` (a maybe, or a waiting ask). */
  classes?: string[];
  /** Printed on the chest: `print(name, top)`, when the caller may show a name. */
  print?: string;
  style?: string;
};

/**
 * The figure as a group: `.fig.att-<attitude>` > `.tilt` (attribute) > `.body` (animated) > arms,
 * torso, legs, `.head` (animated). Rest poses are attributes on outer groups; the CSS animates the
 * inner ones, so the two never fight.
 */
export function figure(spec: Spec, opts: FigureOptions = {}): string {
  const pose = POSE[spec.attitude];
  const from: Side = opts.from ?? "right";
  // A bomber leans toward the middle of the photo, so the lean follows the edge they come from; one
  // popping up from below stands straight. The arm nearest the line stays low, so nothing of theirs
  // crosses a face: from the right the left arm is the inner one.
  const bomber = isBomber(spec);
  const tilt = bomber ? (from === "left" ? -pose.tilt : from === "below" ? 0 : pose.tilt) : pose.tilt;
  const armL = bomber ? (from === "right" ? 30 : from === "left" ? 160 : 40) : pose.armL;
  const armR = bomber ? (from === "right" ? -160 : from === "left" ? -30 : -40) : pose.armR;
  const head = tag(
    "g",
    { class: "head" },
    tag("rect", { x: 44, y: 0, width: 12, height: 9, rx: 2, fill: spec.skin, class: "stud" }),
    tag("rect", { x: 32, y: 8, width: 36, height: 36, rx: 10, fill: spec.skin }),
    tag("rect", { x: 44, y: 44, width: 12, height: 7, fill: spec.skin }),
    hair(spec),
    // eyes: the face's, whatever the moment
    tag("circle", { cx: 42, cy: 25, r: 2.6, fill: INK, class: "eye" }),
    spec.face === "wink"
      ? tag("path", { d: "M54 25 h8", stroke: INK, "stroke-width": 2.2, "stroke-linecap": "round", class: "eye wink" })
      : tag("circle", { cx: 58, cy: 25, r: 2.6, fill: INK, class: "eye" }),
    // brows: raised at the inner ends when exasperated -- the "oh, you" look
    spec.face === "exasperated" && tag("path", { d: "M37 18 L46 20 M63 18 L54 20", stroke: INK, "stroke-width": 2, "stroke-linecap": "round", class: "brows" }),
    // the mouth: the face's, whatever the moment
    MOUTH[FACE_MOUTH[spec.face]](),
    spec.attitude === "cool" &&
      tag(
        "g",
        { class: "glasses" },
        tag("rect", { x: 35, y: 21, width: 13, height: 8, rx: 2, fill: INK }),
        tag("rect", { x: 52, y: 21, width: 13, height: 8, rx: 2, fill: INK }),
        tag("rect", { x: 48, y: 23, width: 4, height: 2, fill: INK }),
      ),
  );
  const body = tag(
    "g",
    { class: "body" },
    arm("l", spec, armL),
    arm("r", spec, armR),
    tag("path", { d: "M28 50 L72 50 L78 96 L22 96 Z", fill: spec.top, class: "torso" }),
    tag("rect", { x: 26, y: 96, width: 48, height: 9, fill: INK, class: "hips" }),
    tag("rect", { x: 26, y: 105, width: 22, height: 34, rx: 3, fill: spec.legs, class: "leg leg-l" }),
    tag("rect", { x: 52, y: 105, width: 22, height: 34, rx: 3, fill: spec.legs, class: "leg leg-r" }),
    head,
    opts.print,
  );
  const tiltG = tag("g", { class: "tilt", transform: `rotate(${tilt} 50 140)` }, body);
  const classes = ["fig", `att-${spec.attitude}`, bomber ? `from-${from}` : "", ...(opts.classes ?? [])].filter(Boolean).join(" ");
  return tag("g", { class: classes, style: opts.style }, tiltG);
}

/** A whole `<svg>` of one figure, for a stage or an icon. */
export function figureSvg(spec: Spec, size = 220, opts: { viewBox?: string; height?: number; classes?: string; print?: string } = {}): string {
  return tag(
    "svg",
    {
      class: opts.classes,
      viewBox: opts.viewBox ?? "0 0 100 140",
      width: size,
      height: opts.height ?? Math.round(size * 1.4),
      "aria-label": `a minifigure, ${spec.attitude}`,
    },
    figure(spec, { print: opts.print }),
  );
}

/** Light print on a dark top, dark on a light one, so the chest print reads against every colour the palette offers. */
export function inkFor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6 ? INK : "#F3EDE0";
}

/** The name across the chest, like a t-shirt print: first name over surname (or alone), sized to the torso. */
export function print(name: string, top: string, classes = "print"): string {
  const parts = name.trim().split(/\s+/);
  const lines = parts.length > 1 ? [parts[0]!, parts.slice(1).join(" ")] : [parts[0]!];
  const size = Math.min(11, 48 / (0.6 * Math.max(...lines.map((l) => l.length))));
  const y0 = lines.length > 1 ? 70 : 76;
  return tag(
    "g",
    { class: classes },
    ...lines.map((line, i) =>
      tag("text", { x: 50, y: y0 + i * (size + 2), "text-anchor": "middle", "font-size": size.toFixed(1), fill: inkFor(top) }, esc(line)),
    ),
  );
}

// ───────────────────────────── the group photo ─────────────────────────────

export interface Slot {
  x: number;
  y: number;
  s: number;
  /** Which entry of the input this slot holds. */
  k: number;
  /** Depth, for draw order: back rows first, so the front draws on top. */
  d: number;
  /** Set on a photo-bomber: where they come from. */
  from?: Side;
}
export interface Box { x: number; y: number; w: number; h: number }
/** A laid-out photo: everyone's place in scene units (a front-row figure is 100 wide, its feet at y = 0), and the frame that holds them all. */
export interface Scene { slots: Slot[]; box: Box }

const FIG_W = 100;
const FIG_H = 140;
/** Spacing along a row as a fraction of a figure's width there: shoulders nearly touching, never overlapping. */
const GAP = 0.76;
/** Each row behind is this much smaller. */
const SHRINK = 0.87;
/** The narrowest frame: one person is a portrait, not a giant. */
const MIN_W = 330;
/** Rows behind hold a larger share of the crowd, so the crowd is a pyramid seen from the front. */
const ROW_SHARE = (r: number) => 1 + 0.35 * r;
/** The crowd's box is chosen nearest this width to height. */
const PLEASING = 1.618;

/** Split n across R rows by their shares, largest remainder taking the odd ones. */
function split(n: number, R: number): number[] {
  const shares = Array.from({ length: R }, (_, r) => ROW_SHARE(r));
  const total = shares.reduce((a, b) => a + b, 0);
  const exact = shares.map((sh) => (n * sh) / total);
  const counts = exact.map(Math.floor);
  let left = n - counts.reduce((a, b) => a + b, 0);
  const byRemainder = exact.map((e, r) => ({ r, rem: e - counts[r]! })).sort((a, b) => b.rem - a.rem);
  for (const { r } of byRemainder) {
    if (left <= 0) break;
    counts[r]!++;
    left--;
  }
  return counts;
}

/** Place the line in rows: each row behind smaller, higher, staggered into the gaps, curving with its ends nearer. */
function placeRows(counts: number[], line: { k: number }[]): Slot[] {
  const out: Slot[] = [];
  let idx = 0;
  let feet = 0;
  let prevScale = 1;
  counts.forEach((k, r) => {
    const sc = Math.pow(SHRINK, r);
    const w = FIG_W * sc;
    const sp = w * GAP;
    if (r > 0) feet -= 52 * prevScale;
    const stagger = r > 0 && k % 2 === counts[r - 1]! % 2 ? sp / 2 : 0;
    for (let i = 0; i < k; i++) {
      const mid = (i - (k - 1) / 2) * sp + stagger;
      const t = k > 1 ? (i - (k - 1) / 2) / ((k - 1) / 2) : 0;
      out.push({ d: r + 1 - i * 1e-4, s: sc, x: mid - w / 2, y: feet - FIG_H * sc + 10 * sc * t * t, k: line[idx]!.k });
      idx++;
    }
    prevScale = sc;
  });
  return out;
}

/** How much of a figure shows: one popping up from below stops at the waist. */
export const shown = (p: Pick<Slot, "from">): number => (p.from === "below" ? 0.5 : 1);

function bounds(slots: Slot[]): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of slots) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x + FIG_W * p.s);
    y1 = Math.max(y1, p.y + FIG_H * p.s * shown(p));
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Arrange a group photo. The line stands in rows chosen by proportion: for the people present, every
 * count of rows is tried, each row behind taking a larger share, and the one whose crowd is nearest
 * the golden ratio is kept; rows behind are smaller, stand high enough for their heads to show above
 * the shoulders in front, and are offset into the gaps. Photo-bombers have a row of their own in
 * front of everything, spread evenly from over the left shoulder to over the right, the span widening
 * only when they would touch; where each comes from follows from where they stand. The frame is the
 * box around everyone, so the camera zooms out as the crowd grows and nobody is cut off. Back rows
 * first, so the front draws on top.
 */
export function arrange(who: number | Pick<Spec, "attitude">[]): Scene {
  const specs = typeof who === "number" ? Array.from({ length: who }, () => ({ attitude: "nodding" as Attitude })) : who;
  const line = specs.map((s, k) => ({ s, k })).filter((x) => !isBomber(x.s));
  const bombers = specs.map((s, k) => ({ s, k })).filter((x) => isBomber(x.s));

  // the rows: the most pleasing of every possible count
  let slots: Slot[] = [];
  let best = Infinity;
  let counts: number[] = [];
  for (let R = 1; R <= Math.min(6, line.length); R++) {
    const c = split(line.length, R);
    if (c.some((k) => k < 1)) continue;
    const placed = placeRows(c, line);
    const b = bounds(placed);
    const score = Math.abs(Math.log(b.w / b.h / PLEASING));
    if (score < best) {
      best = score;
      slots = placed;
      counts = c;
    }
  }

  // the bombers' row, in front of everything
  if (bombers.length) {
    const sb = 1.06;
    const wb = FIG_W * sb;
    const feetB = 16;
    const n = bombers.length;
    const front = counts[0] ?? 0;
    const frontHalf = front > 0 ? ((front - 1) / 2) * FIG_W * GAP + FIG_W / 2 : FIG_W / 2;
    const overShoulder = frontHalf + wb / 2 - 0.15 * wb; // over the last shoulder by a little, not across it
    const end = Math.max(overShoulder, n > 1 ? ((n - 1) * 0.8 * wb) / 2 : 0); // wider only when they would touch
    bombers.forEach((b, i) => {
      const c = n === 1 ? end : -end + (i * 2 * end) / (n - 1);
      const from: Side = c > end / 3 ? "right" : c < -end / 3 ? "left" : "below";
      // from the sides they stand at full height; from below they rise to the waist and no further
      const y = from === "below" ? feetB - FIG_H * sb * shown({ from }) : feetB - FIG_H * sb;
      slots.push({ d: -1 - Math.abs(c) * 1e-4, s: sb, from, k: b.k, x: c - wb / 2, y });
    });
  }
  slots.sort((a, b) => b.d - a.d);

  // the frame: everyone, a margin, never narrower than a portrait
  if (!slots.length) return { slots, box: { x: -MIN_W / 2, y: -200, w: MIN_W, h: 200 } };
  const b = bounds(slots);
  const m = 16;
  let w = b.w + 2 * m;
  let x = b.x - m;
  if (w < MIN_W) {
    x -= (MIN_W - w) / 2;
    w = MIN_W;
  }
  return { slots, box: { x, y: b.y - m - 8, w, h: b.h + m + 8 + 6 } };
}
