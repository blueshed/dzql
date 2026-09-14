/**
 * A form's value on submit: its one field's raw value, unchanged, or a
 * record of all its named fields if it has more than one. No named fields
 * at all is undefined. The single-field case stays a scalar rather than a
 * one-key object, since that's what every form up to now has sent.
 */
export function formValue(form: HTMLFormElement): unknown {
  const entries = [...new FormData(form).entries()];
  if (entries.length === 0) return undefined;
  if (entries.length === 1) return entries[0]![1];
  return Object.fromEntries(entries);
}
