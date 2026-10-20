// The marks the app draws, by our names for them, and lucide's outlines behind each: lucide alone,
// never another set or an inline SVG. The kernel's `svg` does the drawing, and the bento asks for
// its own marks by these names (the trail's chevron, undo and redo, the pencil, the plus, the close,
// and leaving). Add the app's own here as its stories need them.
import { ChevronRight, LogOut, Pencil, Plus, Redo2, Sprout, Undo2, X } from "lucide";
import { svg, type IconNode } from "dzql/rendering/icons";

const ICONS = { "chevron-right": ChevronRight, undo: Undo2, redo: Redo2, pencil: Pencil, plus: Plus, x: X, "log-out": LogOut, sprout: Sprout } satisfies Record<string, IconNode>;

export type IconName = keyof typeof ICONS;

export const icon = (name: IconName, size = 16): string => svg(ICONS[name], { size, name });
