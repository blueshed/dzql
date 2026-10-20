// Type-only fixture (never executed). It exercises the documented consumer
// surface so `tsc -p` here fails if any of it stops type-checking under a real
// downstream config. Imports come from the bare package name on purpose, so the
// root barrel (and thus logger.ts's env access) is type-checked without
// @types/bun present.
import {
  signal,
  computed,
  effect,
  when,
  list,
  mount,
  routes,
  route,
  navigate,
  key,
  provide,
  inject,
  createLogger,
  collection,
  resolved,
} from "@blueshed/railroad";
import type { Dispose, JSX, Row } from "@blueshed/railroad";
import type { JSX as RuntimeJSX } from "@blueshed/railroad/jsx-runtime";

const count = signal(0);
const doubled = computed(() => count.get() * 2);
const label = count.map((n) => `count: ${n}`);
effect(() => void count.get());

const detail = signal<{ id: string } | null>(null);

type Item = { id: number; text: string };
const rows = signal<Item[]>([{ id: 1, text: "a" }]);
type Job = { id: number; name: string };
const jobs = collection((j: Job) => j.id, [{ id: 1, name: "build" }]);
jobs.patch(1, { name: "built" });
const was: Job | undefined = jobs.put({ id: 2, name: "test" });
void was;

const STORE = key<{ name: string }>("store");
provide(STORE, { name: "x" });
void inject(STORE).name;

const log = createLogger("[consumer]");
log.info("typechecks");

// Data that comes later is a signal: the component stays synchronous, and the
// branch is handed what the promise settled as, its fields narrowed by `in`.
function Profile(props: { id: number }) {
  return when(resolved(Promise.resolve({ name: "ada" })), (r) => (
    "error" in r ? <p>no profile</p> : <div data-id={props.id}>{r.value.map((u) => u.name)}</div>
  ), () => <p>loading</p>);
}

// An async component doesn't compile: a component returns a Node.
async function AsyncProfile(props: { id: number }) {
  await Promise.resolve();
  return () => <div>{props.id}</div>;
}

function App(): JSX.Element {
  return (
    <div class={label}>
      <span>{count}</span>
      <span>{doubled}</span>
      <span>{() => (count.get() > 5 ? "high" : "low")}</span>
      <ul>
        {/* bare-arrow keyFn — must infer `r` as Item, no annotation; the row is its fields */}
        {list(rows, (r) => r.id, ({ id, text }) => (
          <li data-id={id}>{text}</li>
        ))}
        {/* index$ and the row's own signal come after the fields */}
        {list(rows, (r) => r.id, (_, i$, row$) => (
          <li class={i$.map((i) => (i % 2 ? "odd" : "even"))}>{row$.map((r) => r.text)}</li>
        ))}
        {/* a collection is a list's source, its key the keyFn; at(key) follows one row */}
        {list(jobs, jobs.key, (job: Row<Job>) => <li>{job.name}</li>)}
        {/* when() hands an object as list() hands a row: its fields */}
        {when(jobs.at(1), ({ name }) => <li>{name}</li>)}
      </ul>
      {/* index-based overload — `item` is raw Item */}
      {list(rows, (item, i) => (
        <li>
          {i}: {item.text}
        </li>
      ))}
      {when(count.map((c) => c > 0), () => (
        <p>positive</p>
      ))}
      {/* the truthy value, narrowed (no `!`): its fields, then v$, its own signal */}
      {when(detail, ({ id }, d$) => <p title={d$.map((d) => d.id)}>{id}</p>, () => <p>none</p>)}
      {/* a primitive is its signal */}
      {when(count, (n$) => <p>{n$.map((n) => n + 1)}</p>)}
      <Profile id={1} />
      {/* @ts-expect-error -- an async component is not a JSX tag */}
      <AsyncProfile id={1} />
    </div>
  );
}

// Tags are typed from the DOM's element types: refs and events know their
// element, and a typo or React's casing doesn't compile.
const typed: JSX.Element[] = [
  <input
    ref={(el) => void el.valueAsNumber}
    oninput={(e) => void e.currentTarget.value}
    value={count}
    readonly
    aria-label="count"
    data-id={count}
  />,
  <label for="n" class={() => (count.get() > 1 ? "many" : null)}>n</label>,
  <svg viewBox="0 0 4 4"><circle r={count} stroke-width={1} /></svg>,
  <my-widget some-prop="x" />,
  // @ts-expect-error -- React's casing: railroad's handlers are lowercase
  <button onClick={() => {}} />,
  // @ts-expect-error -- a typo
  <div clas="x" />,
];
void typed;

// railroad JSX is a DOM Node, typed from the runtime's JSX namespace even with
// React's global JSX beside it (react-global.d.ts).
const node: Node = <App />;
const el: RuntimeJSX.Element = node;
void el;

const user = route<{ id: string }>("/users/:id");
void user.get();

const root = document.getElementById("root");
if (root) {
  const disposeApp: Dispose = mount(root, () => <App />);
  void disposeApp;
  routes(root, {
    "/": () => <App />,
    // keyed (the default): the handler re-runs when the params change; params are inferred
    "/sites/:id": ({ id }) => <p>{id}</p>,
    "/said/:id": { keyed: true, handler: ({ id }) => <p>{id}</p> },
    "/load/:id": ({ id }) => when(resolved(Promise.resolve(id)), (r) => <p>{"error" in r ? "?" : r.value}</p>),
    // @ts-expect-error -- an async handler is not a route handler
    "/async/:id": async ({ id }) => {
      await Promise.resolve();
      return () => <p>{id}</p>;
    },
    // keyed: false, a layout: runs once, and follows its params through params$
    "/users/:id": { keyed: false, handler: (_p, params$) => {
      const span = document.createElement("span");
      effect(() => {
        span.textContent = params$.get().id ?? "";
      });
      return span;
    } },
  });
}
navigate("/");
