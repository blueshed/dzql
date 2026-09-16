// The tray: where a box's compartments sit, computed from what the box declares rather than drawn
// by hand. A box says its compartments in its own order and how much of the tray each deserves --
// its span in columns and in rows ("bigger for what matters more", apples.md) -- and the tray
// places them first-fit, left to right, top to bottom, in as many rows as they need. The result is
// a CSS grid: its template areas, and for each compartment its area and which corners of the tray
// it touches, since a compartment is cut into the tray -- square where its walls meet another,
// curved only where it sits in a corner of the tray. Pure and viewport-free: a view computes one
// tray per column count it lays out for (three across, one on a phone) and lets CSS pick.

export interface Compartment {
  /** Names the grid area; letters, digits and hyphens only (a view slugs its labels). */
  key: string;
  /** Columns it spans; clamped to the tray's. Default 1. */
  span?: number;
  /** Rows it spans. Default 1. */
  rows?: number;
}

export type Corner = "tl" | "tr" | "br" | "bl";

export interface Placed {
  key: string;
  column: number;
  row: number;
  span: number;
  rows: number;
  /** The tray's corners this compartment sits in, so it may take the tray's curve there. */
  corners: Corner[];
}

export interface Tray {
  columns: number;
  rows: number;
  /** `grid-template-areas`, one quoted row per line; an empty cell is `.`. */
  areas: string;
  cells: Placed[];
}

const KEY = /^[A-Za-z][A-Za-z0-9-]*$/;

/** A label as a grid-area name: lower case, hyphens for anything else, never empty. */
export function slug(label: string): string {
  const s = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return /^[a-z]/.test(s) ? s : `c-${s || "x"}`;
}

/** Places the compartments in a tray `columns` wide. */
export function tray(compartments: Compartment[], columns: number): Tray {
  if (!Number.isInteger(columns) || columns < 1) throw new Error(`a tray needs at least one column, not ${columns}`);
  const grid: (string | null)[][] = []; // rows of columns; null is free
  const rowAt = (r: number): (string | null)[] => (grid[r] ??= Array<string | null>(columns).fill(null));
  const free = (r: number, c: number, span: number, rows: number): boolean => {
    for (let dr = 0; dr < rows; dr++) for (let dc = 0; dc < span; dc++) if (rowAt(r + dr)[c + dc] !== null) return false;
    return true;
  };

  const cells: Placed[] = [];
  const seen = new Set<string>();
  let fromRow = 0; // the box's order is kept: nothing is placed above the row the last one started on
  for (const { key, span: wanted = 1, rows = 1 } of compartments) {
    if (!KEY.test(key)) throw new Error(`"${key}" is not a grid-area name; slug() it first`);
    if (seen.has(key)) throw new Error(`two compartments called "${key}"`);
    seen.add(key);
    const span = Math.max(1, Math.min(Math.floor(wanted), columns));
    const tall = Math.max(1, Math.floor(rows));
    // first fit from that row on: the earliest row, and within it the leftmost run of free columns wide enough
    let placed = false;
    for (let r = fromRow; !placed; r++) {
      for (let c = 0; c + span <= columns; c++) {
        if (!free(r, c, span, tall)) continue;
        for (let dr = 0; dr < tall; dr++) for (let dc = 0; dc < span; dc++) rowAt(r + dr)[c + dc] = key;
        cells.push({ key, column: c, row: r, span, rows: tall, corners: [] });
        fromRow = r;
        placed = true;
        break;
      }
    }
  }

  // a gap at the end of the last row is nobody's; the compartment before it grows across it, so
  // the tray's bottom edge is whole and its corner belongs to someone
  const rows = grid.length;
  if (rows > 0) {
    const last = grid[rows - 1]!;
    const filled = last.lastIndexOf(last.findLast((k) => k !== null) ?? null);
    const tail = cells.findLast((c) => c.row + c.rows === rows && c.rows === 1 && c.column + c.span === filled + 1);
    if (tail && filled < columns - 1) {
      for (let c = filled + 1; c < columns; c++) last[c] = tail.key;
      tail.span = columns - tail.column;
    }
  }
  for (const cell of cells) {
    const top = cell.row === 0;
    const bottom = cell.row + cell.rows === rows;
    const left = cell.column === 0;
    const right = cell.column + cell.span === columns;
    if (top && left) cell.corners.push("tl");
    if (top && right) cell.corners.push("tr");
    if (bottom && right) cell.corners.push("br");
    if (bottom && left) cell.corners.push("bl");
  }

  const areas = grid.map((row) => `"${row.map((k) => k ?? ".").join(" ")}"`).join("\n");
  return { columns, rows, areas, cells };
}
