# when() and list()

```tsx
import { signal, when, list, mount } from "@blueshed/railroad";

type Todo = { id: number; text: string };
const todos = signal<Todo[]>([{ id: 1, text: "Buy milk" }]);
const selected = signal<Todo | null>(null);

function Todos() {
  return (
    <div>
      <ul>
        {list(todos, (t) => t.id, ({ text }, idx$, todo$) => (
          <li class={idx$.map((i) => i % 2 ? "odd" : "even")}
              onclick={() => selected.set(todo$.peek())}>
            {text}
          </li>
        ))}
      </ul>
      {when(selected, (t$) => <p>{t$.map((t) => t.text)}</p>, () => <p>none</p>)}
    </div>
  );
}

mount(document.getElementById("root")!, () => <Todos />);
```

Both are typed in `jsx.ts`. Both render synchronously (in the DOM when `mount()` or the append returns), keep their content between bracket comments, need a [scope](scopes.md), and never rebuild after disposal.

Working: [examples/jobs](https://github.com/blueshed/dzql/tree/main/packages/railroad/examples/jobs), a keyed `list()` whose row is taken apart into its fields,
`when()` over one job (`jobs.at(id)`), over a count and over a function, and a static `.map`
(`resources/jobs/jobs-view.tsx`); `when()` following its value through `v$`, and rows keyed by
name (`resources/runners/runners-view.tsx`).

## when(condition, truthy, falsy?)

- `condition` is a signal or a function.
- The branch rebuilds only when **truthiness** flips; `"a"` → `"b"` doesn't. Read the value through `v$`, the current truthy value (`NonNullable<T>`, no `!`), which notifies on every change while truthy. `when(x, () => <A id={x.get()!.id} />)` stays on the first value.
- One row of a [collection](realtime.md): `when(jobs.at(id), (j$) => …, () => <p>gone</p>)`, told when that row changes and no other.
- Each branch has its own dispose scope; a branch that throws keeps nothing and builds again on the next change.

## list(items, keyFn, render)

- `render(row, index$, row$)`. A keyed row is its fields, each a `ReadonlySignal` (`Row<T>`), so destructuring is right: `({ name, status }) => …` binds each where it shows. `id.peek()` for a key or attribute that never changes; `row$`, the whole row's signal, to hand the row on. A row that is a string or a number is its signal.
- A row is pushed on with `Object.is`: a changed row must be a new object, as a [collection](realtime.md) and delta's client make it. A row that is the same object runs none of its projections, so a change costs the rows it changed.
- Keys must be unique and stable: duplicates collapse into one row (and warn).
- Rows move, never rebuild. A reorder moves only the rows out of order, so a row being typed in keeps its focus, selection and scroll.
- The index form, `list(items, (item, i) => …)`, passes raw values and rebuilds every row on every change: static lists only.
- Any array derived from a signal goes through `list()`. A plain `.map()` bakes its rows in once; it is right only for a static array (`COLUMNS.map(c => <Column col={c} />)`).
