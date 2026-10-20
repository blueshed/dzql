# Signals

```ts
import { signal, computed, effect, batch, untrack, collection } from "@blueshed/railroad";

const count = signal(0);
const doubled = computed(() => count.get() * 2);   // ReadonlySignal: no .set
const label = count.map((n) => `Count: ${n}`);     // ReadonlySignal too

const dispose = effect(() => {
  console.log(label.get(), doubled.get());         // re-runs when count changes
  return () => console.log("cleanup");             // before the next run, and on dispose
});

count.set(1);
count.update((n) => n + 1);
count.peek();                                      // read, no tracking
untrack(() => count.get());                        // the same, as a function

const filter = signal({ color: "all", done: false });
filter.update((f) => ({ ...f, color: "blue" }));  // a new object: one field changed

const todos = signal([{ id: 1, text: "Buy milk" }]);
todos.mutate((arr) => arr.push({ id: 2, text: "Walk dog" }));  // structuredClone, mutate, notify

const jobs = collection((j: { id: number; status: string }) => j.id);   // rows by key
jobs.put({ id: 1, status: "queued" });            // add, or replace the row with its key
jobs.patch(1, { status: "running" });             // { ...row, ...fields }: a new object
const one = jobs.at(1);                           // ReadonlySignal: told when row 1 changes, no other
jobs.remove(1);                                   // one.peek() is null

const coords = signal({ x: 1, y: 2 }, { equals: (a, b) => a.x === b.x && a.y === b.y });

batch(() => { count.set(10); count.set(20); });    // the effect runs once
dispose();
```

The methods and options are typed in `signals.ts` (`Signal`, `ReadonlySignal`, `SignalOptions`); its header is the contract. What a body creates, and when it is disposed: [scopes](scopes.md).

Working: [examples/jobs](https://github.com/blueshed/dzql/tree/main/packages/railroad/examples/jobs), a `computed` beside what reads it, `.update` and `.mutate`
on a small object, `batch` for two writes and `.peek` for a key (`resources/jobs/jobs-view.tsx`);
a `collection` the feed puts each job in (`resources/jobs/jobs.ts`); an effect's cleanup
(`resources/runners/runners-view.tsx`).

- `effect(fn)` returns its disposer. Only a returned function is a cleanup; any other return is ignored (tsc still rejects an expression body that returns a value: use a block).
- `fn` must be synchronous. `effect(async () => …)` logs an error in development: its Promise is no cleanup and nothing after the first `await` is tracked. Start the async work from the effect and write the result to a signal.
- `set()` notifies at once; railroad is synchronous.
- Propagation is topologically ordered: one write, or one `batch()`, runs each affected computed or effect at most once per settled pass, upstream first, so a diamond never sees half-updated state, even when a computed switches what it reads. A true cycle throws.
- Other effects see an effect's writes, its first run's included, after its body returns. An effect that writes its own dependency (a clamp, a default) runs again after its current run, never inside it.
- An effect that writes a signal, then reads a computed of it that it read before, sees the old value and re-runs once the write settles; a computed it reads for the first time in the pass is brought up to date first.
- A computed whose value is `Object.is` the last one notifies no one: an object signal is changed by a new object (`.update`, `.mutate`), never in place.
- Rows that change one at a time are a `collection`: each change replaces the row it names, `.get()` is a fresh array, and `at(key)` is told only of its own row. With `list()`: [when-list](when-list.md), [realtime](realtime.md).
- `.mutate()` uses `structuredClone`: plain data only, no functions, class instances or DOM nodes.
