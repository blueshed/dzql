export type Listener<T> = (payload: T) => void;

/** A minimal typed pub/sub channel, so concepts can react to each other without importing each other. */
export function createEvent<T>() {
  const listeners: Listener<T>[] = [];
  return {
    on(listener: Listener<T>): void {
      listeners.push(listener);
    },
    emit(payload: T): void {
      for (const listener of listeners) listener(payload);
    },
  };
}
