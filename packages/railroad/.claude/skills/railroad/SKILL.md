---
name: railroad
metadata:
  version: 0.17.0
description: "Railroad — reactive UI for the Bun fullstack runtime. Signals, JSX, hash router, DI, logger. Use when writing JSX with signals, when()/list()/routes(), or any import from @blueshed/railroad. Pair with @blueshed/delta for WebSocket document sync."
---

# railroad

Signals bound to real DOM. A component runs **once** and returns real nodes; what changes later is a Signal or a function you bound in the JSX, never a re-render. No virtual DOM, no compiler, no hooks.

The contract is each source file's JSDoc header and its types: `signals.ts`, `jsx.ts` (props typed under "Intrinsic element props"), `routes.ts`, `shared.ts`, `logger.ts`. Where this skill and a header disagree, the header wins.

## Order of work

1. Set up: tsconfig, an HTML route, `mount()` or `routes()` (pages and browser tests: `bun-route`).
2. State as signals; derive with `.map()` or `computed()`.
3. Components bind signals in JSX; `when()` and `list()` for what appears and repeats.
4. Client routes with `routes()`: each draws a resource, its document's handle and view.
5. Server data: `@blueshed/delta`, or your own patch stream. Then type-check with `bun check` (Bun's own: nothing to install, never `tsc`), and test.

## What bites

1. No `.get()` in JSX or a render body (component, `when()` branch, `list()` row, route handler, `mount()`'s render): it reads once and subscribes nothing. Bind `{count}` or `{() => …}`; `.peek()` for a one-shot. → jsx
2. A function child returns text, not a Node: `when()` for an element, `list()` for many. → jsx
3. A keyed `list()` row, or a `when()` value, is its fields, each a signal: `({ name }) => <li>{name}</li>`; a primitive is its signal. Keys unique and stable. → when-list
4. An array that changes needs `list()`; a plain `.map()` is for a static array. → when-list
5. `when()` rebuilds only when truthiness flips; its branch binds what it is handed. A route runs again when its params change, so `({ id }) => …` is right; a layout is `{ keyed: false, handler }`. → when-list, routes
6. Effects, `when()` and `list()` are disposed only inside a scope (component, route handler, branch, row, `mount()`); an event handler is not one. An effect run owns what its body makes: what must outlive it is made outside. → scopes
7. Handlers are lowercase functions: `onclick={() => …}`, never `onClick`, a call, or a Signal. `oninput` per keystroke; `onchange` on commit. → jsx
8. Data that comes later is a signal: `when(resolved(promise), (r) => …, () => <p>wait</p>)`. Components, handlers and effects are never `async`. → async
9. Rows changed one at a time are a `collection(key)`: it replaces the row it changes, so `list()` updates that row alone, and `at(id)` follows one. Never change a row in place. → realtime
10. Routes match in declaration order, on segments only: no query strings, a trailing slash is a segment. → routes
11. One copy of railroad per page, or signals silently stop crossing. → [one-copy](reference/one-copy.md)

## Invariants

- No React: no hooks, lifecycle methods, classes, or `react` imports. Railroad is its own JSX runtime, chosen by `jsxImportSource`.
- No external bundler: Bun's HTML imports and `bun build`. No global `JSX`: `import type { JSX } from "@blueshed/railroad"`.
- Warnings are development-only (a production build drops them); throws are not.
- `doc.data` from delta is read-only: change a document with `doc.send(ops)`.

## Which file for which job

- [setup](reference/setup.md): new project, tsconfig, JSX types, builds, subpath imports
- [signals](reference/signals.md): `signal`, `computed`, `effect`, `batch`, `collection`, scheduling
- [scopes](reference/scopes.md): what is disposed when; custom roots
- [jsx](reference/jsx.md): components, props, handlers, SVG
- [async](reference/async.md): data that comes later, `resolved()`
- [when-list](reference/when-list.md): conditional and keyed rendering
- [routes](reference/routes.md): `routes`, `route`, `navigate`, keyed and wildcard routes, `onError`
- [realtime](reference/realtime.md): patch streams, `@blueshed/delta`, and an applet in a page dzql's server draws
- [testing](reference/testing.md): unit tests on happy-dom
- [shared-logger](reference/shared-logger.md): `provide`/`inject`, the logger
- [one-copy](reference/one-copy.md): a linked checkout breaks reactivity
