// The marks beside words: our names for them, and lucide's outlines behind each; the kernel's
// `svg` (src/icons.ts) does the drawing.
import { Activity, ChevronRight, Clock, Eye, EyeOff, List, Pencil, Plus, Redo2, Search, Trash2, TrendingUp, Undo2, X } from "lucide";
import { svg, type IconNode } from "dzql/rendering/icons";

const ICONS = {
  "chevron-right": ChevronRight,
  pencil: Pencil,
  x: X,
  undo: Undo2,
  redo: Redo2,
  search: Search,
  eye: Eye,
  "eye-off": EyeOff,
  plus: Plus,
  trash: Trash2,
  board: TrendingUp,
  market: Activity,
  list: List,
  clock: Clock,
} satisfies Record<string, IconNode>;

export type IconName = keyof typeof ICONS;

export const icon = (name: IconName, size = 16, label?: string): string => svg(ICONS[name], { size, name, label });
