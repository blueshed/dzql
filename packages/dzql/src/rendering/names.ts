import type { Example } from "./example";
import { existsSync } from "node:fs";

// A document's whole name, `<docType>:<docId>` (`room:general`, `month:2026-09`): how delta names
// it, and how the wire does, but for a session's own (src/resources/audience.ts).

export function prefixDoc(docType: string, docId: string): string {
  return `${docType}:${docId}`;
}

export function splitDoc(doc: string): { docType: string; docId: string } {
  const separator = doc.indexOf(":");
  return { docType: doc.slice(0, separator), docId: doc.slice(separator + 1) };
}

/**
 * The app in a folder: an example's `index.ts`, its `example`; else its `routes.ts` (routes and
 * resources, as `bun create dzql` lays an app out), whose `app` the page is drawn by. Undefined
 * while there is neither: stories come first.
 */
export async function appIn(dir: string): Promise<Example | undefined> {
  for (const [file, name] of [["index.ts", "example"], ["routes.ts", "app"]] as const)
    if (await Bun.file(`${dir}/${file}`).exists()) return (await import(`${dir}/${file}`))[name] as Example;
  return undefined;
}

/**
 * An app's stories: beside its code (an example's folder), or at its project's root, beside `src/`
 * (an app made with `bun create dzql` or `bun create blueshed` keeps them there).
 */
export function storiesIn(dir: string): string {
  return existsSync(`${dir}/stories.ts`) ? `${dir}/stories.ts` : `${dir}/../stories.ts`;
}

/**
 * Where an app lives, as `ETA_EXAMPLE` names it: one of eta's examples by its name (`chat`, the
 * default: `examples/chat`), or an app's own folder, a path (`./src`, in a project made with `bun
 * create blueshed/eta`), from where the command runs.
 */
export function appDir(named = "chat"): string {
  if (named.startsWith("/")) return named.replace(/\/$/, ""); // a whole path: the model's page, from dzql model
  return named.includes("/") ? `${process.cwd()}/${named}`.replace(/\/\.\//g, "/").replace(/\/$/, "") : `${import.meta.dir}/../../examples/${named}`;
}
