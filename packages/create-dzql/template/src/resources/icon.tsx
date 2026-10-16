/**
 * Icon — a lucide icon as a real SVG node, which railroad renders like any other.
 *
 * import { Save } from "lucide";
 * <Icon icon={Save} />                  beside a text label: hidden from screen readers
 * <Icon icon={Save} label="Save" />     on its own: read out as its label
 */
import { createElement } from "lucide";

export function Icon({ icon, label }: { icon: Parameters<typeof createElement>[0]; label?: string }) {
  return createElement(icon, {
    class: "icon",
    width: "1em", // sized by the text around it
    height: "1em",
    ...(label ? { role: "img", "aria-label": label } : { "aria-hidden": "true" }),
  });
}
