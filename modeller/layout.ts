// The entities' tree, laid out: shared by heart.ts's tests and the page's script (heart.client.ts),
// which lays it out again when the eye hides what doesn't go with the subject. It imports nothing.

export const BOX = { W: 176, H: 46, COL: 236, ROW: 56 };

/**
 * The entities as a tree from their parent links: depth left to right, each leaf on a row of its
 * own, a parent level with the middle of its children, each root's tree a little apart from the
 * next. `visible` keeps some: one whose parent is hidden is a root. The connectors run from a
 * parent's right edge to a spine half a column on, and from it to each child.
 */
export function layout(tables: { name: string; parent: string | null }[], visible?: Set<string>) {
  const { W, H, COL, ROW } = BOX;
  const shown = tables.filter((t) => !visible || visible.has(t.name));
  const on = new Set(shown.map((t) => t.name));
  const kidsOf = (n: string) => shown.filter((t) => t.parent === n).map((t) => t.name);
  const pos: Record<string, { x: number; y: number }> = {};
  let slot = 0;
  const place = (n: string, depth: number) => {
    const kids = kidsOf(n);
    if (kids.length === 0) {
      pos[n] = { x: depth * COL, y: slot * ROW };
      slot++;
      return;
    }
    kids.forEach((k) => place(k, depth + 1));
    const ys = kids.map((k) => pos[k]!.y);
    pos[n] = { x: depth * COL, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  };
  for (const t of shown) {
    if (t.parent && on.has(t.parent)) continue;
    place(t.name, 0);
    slot += 0.4;
  }
  const segs: { left: number; top: number; width: number; height: number }[] = [];
  for (const [n, p] of Object.entries(pos)) {
    const kids = kidsOf(n);
    if (kids.length === 0) continue;
    const spine = p.x + W + (COL - W) / 2;
    const ys = [...kids.map((k) => pos[k]!.y + H / 2), p.y + H / 2];
    segs.push({ left: p.x + W, top: p.y + H / 2 - 1, width: spine - p.x - W, height: 2 });
    segs.push({ left: spine - 1, top: Math.min(...ys) - 1, width: 2, height: Math.max(...ys) - Math.min(...ys) + 2 });
    for (const k of kids) segs.push({ left: spine, top: pos[k]!.y + H / 2 - 1, width: pos[k]!.x - spine, height: 2 });
  }
  const all = Object.values(pos);
  return { pos, segs, width: Math.max(0, ...all.map((p) => p.x + W)), height: Math.max(0, ...all.map((p) => p.y + H)) };
}
