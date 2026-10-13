import { drawnOption, radiosOf } from "./morph";

/** What a form holds a value in: typed, chosen, or ticked. */
export type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** Is it a field: an input, a textarea or a select. */
export const isField = (el: Element): el is Field => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;

/** What a write never carries: a button's value, a file. */
const NOT_A_VALUE = new Set(["submit", "button", "reset", "image", "file"]);

/** Is it a box, which holds a tick, not its value. */
export const isBox = (field: Field): field is HTMLInputElement & { type: "checkbox" } => field instanceof HTMLInputElement && field.type === "checkbox";

/** Is it a radio, one of a group that holds one value between them. */
export const isRadio = (field: Field): field is HTMLInputElement & { type: "radio" } => field instanceof HTMLInputElement && field.type === "radio";

/** A radio's group: the radios of its name in its form. A radio with no name is a group alone. */
export const groupOf = (radio: HTMLInputElement): HTMLInputElement[] => (radio.name ? radiosOf(radio.form, radio.name) : [radio]);

/**
 * What a field holds, of one type whatever form it is in: a box, whether it is ticked, whatever its
 * value attribute says; a radio, its group's value chosen, or null when none is (the group is one
 * field); a select that takes several, its last choice, or null; anything else, its value.
 */
export function held(field: Field): string | boolean | null {
  if (isBox(field)) return field.checked;
  if (isRadio(field)) return groupOf(field).find((r) => r.checked)?.value ?? null;
  if (field instanceof HTMLSelectElement && field.multiple) return [...field.selectedOptions].at(-1)?.value ?? null;
  return field.value;
}

/** A form's named fields, in its order, that a write carries: none disabled, nor a button or a file; each radio of a group among them. */
export const namedFields = (form: HTMLFormElement): Field[] =>
  [...form.elements].filter((el): el is Field => isField(el) && el.name !== "" && !el.matches(":disabled") && !(el instanceof HTMLInputElement && NOT_A_VALUE.has(el.type)));

/**
 * A form's value on submit: its one named field's value, or a record of all its named fields if
 * it has more than one, each there whatever it holds (a box unticked is false, a group of radios
 * none of which is chosen is null), so a value keeps one shape. No named fields at all is
 * undefined. A disabled field is none, nor is a button. The single-field case stays a scalar
 * rather than a one-key object, since that's what every form up to now has sent.
 */
export function formValue(form: HTMLFormElement): unknown {
  const fields = new Map<string, unknown>();
  for (const el of namedFields(form)) fields.set(el.name, held(el)); // a name again is its last
  if (fields.size === 0) return undefined;
  if (fields.size === 1) return [...fields.values()][0];
  return Object.fromEntries(fields);
}

/**
 * What a field was drawn holding, which a person has not changed until it differs: a box, whether it
 * was drawn `checked`; a group of radios, the value of the last drawn `checked`, or null; a select,
 * the option it was drawn showing (drawnOption); a textarea, its text as parsed (`defaultValue`);
 * anything else, its `value` attribute.
 */
export function rendered(field: Field): string | boolean | null {
  if (isBox(field)) return field.defaultChecked;
  if (isRadio(field)) return groupOf(field).findLast((r) => r.defaultChecked)?.value ?? null;
  if (field instanceof HTMLSelectElement) return drawnOption(field)?.value ?? "";
  return field instanceof HTMLTextAreaElement ? field.defaultValue : (field.getAttribute("value") ?? "");
}
