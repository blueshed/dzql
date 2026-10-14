/**
 * Strip an entity's hidden columns from a row before it is pushed to clients.
 *
 * The realtime path stores the full row in the events table (routing needs it),
 * but what is broadcast to subscribers must match what the getter would return:
 * a hidden column (e.g. users.password_hash) must never ride out on a live
 * update even though it is present in the stored event data.
 */
export function projectVisible<T extends Record<string, unknown>>(
  data: T | null | undefined,
  hidden: string[] | undefined,
): T | null | undefined {
  if (!data || !hidden || hidden.length === 0) return data;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!hidden.includes(key)) out[key] = value;
  }
  return out as T;
}
