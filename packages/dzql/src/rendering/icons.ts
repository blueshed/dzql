// A mark beside a word, as SVG. The kernel knows the shape of an icon -- a list of nodes, each a
// tag and its attributes, the way lucide exports one -- and renders it at a size with a label;
// it does not know any particular icon, and imports no icon set. An example brings its own
// (the wedding's come from the `lucide` package) and names them as it likes.

/** One icon: a list of SVG nodes, each a tag and its attributes, drawn on a 24-unit grid -- the
 * shape lucide exports (its attribute values may be undefined; those are left out). */
export type IconNode = [tag: string, attrs: Record<string, string | number | undefined>][];

export interface IconOptions {
  /** In CSS pixels; the viewBox is always 24. */
  size?: number;
  /** Adds `icon-<name>` to the class, so a stylesheet can pick one out. */
  name?: string;
  /** A mark that stands alone says what it is; one beside a word is decorative and hidden from readers. */
  label?: string;
}

function attributes(attrs: Record<string, string | number | undefined>): string {
  return Object.entries(attrs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${v}"`)
    .join("");
}

/** The icon as SVG markup: stroke-drawn in the current colour, as lucide's outlines are meant to be. */
export function svg(node: IconNode, { size = 16, name, label }: IconOptions = {}): string {
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
  const cls = name ? `icon icon-${name}` : "icon";
  const body = node.map(([tag, attrs]) => `<${tag}${attributes(attrs)}/>`).join("");
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${a11y}>${body}</svg>`;
}
