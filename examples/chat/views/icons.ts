// The marks beside words: our names for them, and lucide's outlines behind each. The kernel's
// `svg` (src/icons.ts) does the drawing; this file only says which outline a name means.
import { ChevronRight, Eye, EyeOff, Hash, LogOut, MessageSquare, Pencil, Plus, Redo2, Search, Undo2, Users, X } from "lucide";
import { svg, type IconNode } from "../../../src/icons";

const ICONS = {
  "chevron-right": ChevronRight,
  pencil: Pencil,
  x: X,
  undo: Undo2,
  redo: Redo2,
  "log-out": LogOut,
  search: Search,
  eye: Eye,
  "eye-off": EyeOff,
  plus: Plus,
  users: Users,
  talk: MessageSquare,
  hash: Hash,
} satisfies Record<string, IconNode>;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, size = 16, label?: string): string {
  return svg(ICONS[name], { size, name, label });
}
