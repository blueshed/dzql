// The city picker's ranking logic: a typeahead over every zone, ranking a city that starts with
// what was typed above one that merely contains it -- which a native datalist cannot do. Pure
// functions, tested here without a browser; the mounting that reads the server-rendered <option>s
// at mount and turns a choice into a write is city-picker-applet.ts, imported only by
// client/main.ts (docs/dzql/rendering/change-request.md item 4).

export interface Zone {
  tz: string;
  /** "London (UTC+01:00)", or "Buenos Aires, Argentina (UTC-03:00)" */
  label: string;
  city: string;
}

/** The city in a label: what comes before the region's comma or the offset's bracket. */
export const cityIn = (label: string): string => /^[^,(]+/.exec(label)?.[0]?.trim() ?? label;

export const SHOWN = 8;

/**
 * The zones matching `query`: cities that start with it first -- the shortest first, since
 * "lon" is nearer London than Longyearbyen -- then any label that contains it, up to SHOWN.
 */
export function matches(zones: Zone[], query: string): Zone[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const starts = zones.filter((z) => z.city.toLowerCase().startsWith(q)).sort((a, b) => a.city.length - b.city.length || a.city.localeCompare(b.city));
  const contains = zones.filter((z) => !z.city.toLowerCase().startsWith(q) && z.label.toLowerCase().includes(q));
  return [...starts, ...contains].slice(0, SHOWN);
}

/** The highlighted suggestion after an arrow key: down and up, within the list. */
export function step(active: number, count: number, key: string): number {
  if (count === 0) return 0;
  if (key === "ArrowDown") return Math.min(active + 1, count - 1);
  if (key === "ArrowUp") return Math.max(active - 1, 0);
  return active;
}
