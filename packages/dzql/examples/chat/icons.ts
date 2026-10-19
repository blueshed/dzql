// The marks chat draws, by our names for them, and lucide's outlines behind each. The kernel's
// `svg` (src/rendering/icons.ts) does the drawing, and the kernel's bento (src/rendering/bento.ts) asks for its own
// marks by these names: the chevron in the trail, undo and redo.
import { ChevronRight, LogOut, Redo2, Undo2 } from "lucide";
import { svg, type IconNode } from "dzql/rendering/icons";

const ICONS = { "chevron-right": ChevronRight, undo: Undo2, redo: Redo2, "log-out": LogOut } satisfies Record<string, IconNode>;

export type IconName = keyof typeof ICONS;

export const icon = (name: IconName, size = 16): string => svg(ICONS[name], { size, name });
