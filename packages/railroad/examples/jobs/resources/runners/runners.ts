/** The runners, the client's handle: looked up when wanted, never watched. */
import type { Runner } from "./runners-api";

async function read<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.url} answered ${res.status}`);
  return (await res.json()) as T;
}

/** Every runner. */
export const runners = () => fetch("/api/runners").then((r) => read<Runner[]>(r));

/** One runner; `signal` aborts the request. */
export const runner = (name: string, signal?: AbortSignal) =>
  fetch(`/api/runners/${encodeURIComponent(name)}`, { signal }).then((r) => read<Runner>(r));
