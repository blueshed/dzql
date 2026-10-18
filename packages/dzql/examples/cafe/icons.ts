// The marks the app draws, by our names for them, and lucide's outlines behind each: lucide alone,
// never another set or an inline SVG. The kernel's `svg` does the drawing, and the bento asks for
// its own marks by these names (the trail's chevron, undo and redo, the pencil, the plus, the close,
// the bin, and leaving). The rest are the cafe's own: its tables, what is ready, the kitchen, the
// menu, the invoice, saying ready, placing, paying, the door.
import { Armchair, Check, ChefHat, ChevronRight, Coffee, ConciergeBell, CreditCard, HandPlatter, LogOut, Pencil, Plus, Receipt, Redo2, Trash2, Undo2, Utensils, X } from "lucide";
import { svg, type IconNode } from "dzql/rendering/icons";

const ICONS = {
  "chevron-right": ChevronRight, undo: Undo2, redo: Redo2, pencil: Pencil, plus: Plus, x: X, trash: Trash2, "log-out": LogOut,
  armchair: Armchair, bell: ConciergeBell, "chef-hat": ChefHat, utensils: Utensils, receipt: Receipt, check: Check, platter: HandPlatter, "credit-card": CreditCard, coffee: Coffee,
} satisfies Record<string, IconNode>;

export type IconName = keyof typeof ICONS;

export const icon = (name: IconName, size = 16): string => svg(ICONS[name], { size, name });
