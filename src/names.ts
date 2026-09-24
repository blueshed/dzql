// A document's whole name, `<docType>:<docId>` (`room:general`, `month:2026-09`): how delta names
// it, and how the wire does, but for a session's own (src/compartments/audience.ts).

export function prefixDoc(docType: string, docId: string): string {
  return `${docType}:${docId}`;
}

export function splitDoc(doc: string): { docType: string; docId: string } {
  const separator = doc.indexOf(":");
  return { docType: doc.slice(0, separator), docId: doc.slice(separator + 1) };
}
