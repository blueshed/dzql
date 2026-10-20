import { signal } from "@blueshed/railroad";
import type { Status } from "./status-api";

/** What the server said about itself; null until the first load. */
export const status = signal<Status | null>(null);

export async function load() {
  const res = await fetch("/api/status");
  if (!res.ok) throw new Error(`GET /api/status answered ${res.status}`);
  status.set((await res.json()) as Status);
}
