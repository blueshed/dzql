// The marks leave draws, by our names for them, and lucide's outlines behind each. The kernel's
// bento (src/bento.ts) asks for its own marks by these names too.
import { CalendarCheck, CalendarRange, ChevronLeft, ChevronRight, List, LogOut, Pencil, Plus, Redo2, Trash2, Undo2, X } from "lucide";
import { svg, type IconNode } from "dzql/rendering/icons";

const ICONS = {
  "chevron-right": ChevronRight,
  "chevron-left": ChevronLeft,
  today: CalendarCheck,
  list: List,
  pencil: Pencil,
  x: X,
  undo: Undo2,
  redo: Redo2,
  plus: Plus,
  trash: Trash2,
  "log-out": LogOut,
  month: CalendarRange,
} satisfies Record<string, IconNode>;

export type IconName = keyof typeof ICONS;

export const icon = (name: IconName, size = 16): string => svg(ICONS[name], { size, name });
