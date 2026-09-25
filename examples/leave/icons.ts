// The marks leave draws, by our names for them, and lucide's outlines behind each. The kernel's
// bento (src/bento.ts) asks for its own marks by these names too.
import { CalendarCheck, CalendarDays, CalendarRange, ChevronLeft, ChevronRight, LogOut, Pencil, Plus, Redo2, Trash2, Undo2, Users, X } from "lucide";
import { svg, type IconNode } from "../../src/icons";

const ICONS = {
  "chevron-right": ChevronRight,
  "chevron-left": ChevronLeft,
  today: CalendarCheck,
  pencil: Pencil,
  x: X,
  undo: Undo2,
  redo: Redo2,
  plus: Plus,
  trash: Trash2,
  "log-out": LogOut,
  calendar: CalendarDays,
  month: CalendarRange,
  users: Users,
} satisfies Record<string, IconNode>;

export type IconName = keyof typeof ICONS;

export const icon = (name: IconName, size = 16): string => svg(ICONS[name], { size, name });
