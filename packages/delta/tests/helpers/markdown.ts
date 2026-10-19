/** The fenced block that follows `marker` in a document, as a reader copies it; `name` says the document in the error. */
export function blockAfter(text: string, marker: string, name: string): string {
  const at = text.indexOf(marker);
  if (at < 0) throw new Error(`${name} has no ${JSON.stringify(marker)}`);
  const open = text.indexOf("```", at);
  const start = text.indexOf("\n", open) + 1;
  return text.slice(start, text.indexOf("\n```", start) + 1);
}
