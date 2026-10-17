// What fails while the kernel handles an event -- a message, a drawing, a change being told -- is
// said here and nowhere else: logged, never silent, and heard by whoever listens (the stories
// harness fails the story it happened in). A failure is caught where it happens, so the next event,
// the next connection's drawing and the next listener go ahead.

const listeners = new Set<(what: string, err: unknown) => void>();

/** Says that `what` failed with `err`. */
export function failed(what: string, err: unknown): void {
  console.error(`eta: ${what} failed:`, err);
  for (const fn of listeners) fn(what, err);
}

/** Hears every failure from now on; returns the way to stop hearing. */
export function onFailure(fn: (what: string, err: unknown) => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
