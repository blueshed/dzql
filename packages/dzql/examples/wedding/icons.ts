// The marks beside words: our names for them, and lucide's outlines behind each (the `lucide`
// package, ISC). The kernel's `svg` (src/rendering/icons.ts) does the drawing; this file only says which
// outline a name means. Decorative by default; give one a `label` when it stands alone.
import {
  ArrowDown,
  ArrowUp,
  Bed,
  Calendar,
  Camera,
  Eye,
  EyeOff,
  ChevronLeft,
  ChevronRight,
  Frown,
  Gift,
  House,
  ImagePlus,
  LayoutGrid,
  List,
  LogOut,
  Mail,
  MapPin,
  Meh,
  MessageCircleQuestionMark,
  Pencil,
  Plus,
  Redo2,
  Search,
  Smile,
  Trash2,
  Undo2,
  Users,
  Utensils,
  X,
} from "lucide";
import { svg, type IconNode } from "dzql/rendering/icons";

const ICONS = {
  "chevron-right": ChevronRight,
  "chevron-left": ChevronLeft,
  pencil: Pencil,
  users: Users,
  gift: Gift,
  calendar: Calendar,
  bed: Bed,
  camera: Camera,
  home: House,
  utensils: Utensils,
  question: MessageCircleQuestionMark,
  plus: Plus,
  "log-out": LogOut,
  mail: Mail,
  trash: Trash2,
  image: ImagePlus,
  list: List,
  smile: Smile,
  meh: Meh,
  frown: Frown,
  undo: Undo2,
  redo: Redo2,
  search: Search,
  up: ArrowUp,
  down: ArrowDown,
  x: X,
  "map-pin": MapPin,
  eye: Eye,
  "eye-off": EyeOff,
  grid: LayoutGrid,
} satisfies Record<string, IconNode>;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, size = 16, label?: string): string {
  return svg(ICONS[name], { size, name, label });
}
