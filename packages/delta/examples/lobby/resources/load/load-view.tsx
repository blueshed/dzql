/** The load's part of the page: one line, the reading and how old it is, or that it is stale. */
import type { JSX } from "@blueshed/railroad";
import { load } from "./load";

export function LoadView(): JSX.Element {
  const line = load.data.map((d) =>
    !d || d.reading === null ? "server load: no reading"
    : `server load ${d.reading}${d.stale ? " (stale: no reading for a while)" : ""}`);
  return <p class="load">{line}</p>;
}
