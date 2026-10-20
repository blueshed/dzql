# Routes

```tsx
import { routes, route, navigate, resolved, when } from "@blueshed/railroad";

function SitesLayout() {
  const detail = route<{ id: string }>("/sites/:id");     // null when unmatched
  return (
    <div>
      <a href="#/sites/42">42</a>
      {when(detail, (d$) => <h2>site {d$.map((d) => d.id)}</h2>, () => <p>all sites</p>)}
    </div>
  );
}

routes(
  document.getElementById("root")!,
  {
    "/":          () => <h1>home</h1>,
    "/users/new": () => <h1>new user</h1>,                                   // before /users/:id
    "/users/:id": ({ id }) => <h1>user {id}</h1>,                            // runs again for each id
    "/sites/*":   { keyed: false, handler: () => <SitesLayout /> },          // a layout: stays mounted
    "/slow":      () => when(resolved(Promise.resolve(7)), (r$) => <p>{r$.map((r) => ("value" in r ? r.value : "failed"))}</p>),
  },
  { onError: (err) => { console.warn(err); return <p class="error">Something went wrong.</p>; } },
);

navigate("/users/42");   // route() and the router are current as it returns
```

`routes(target, table, options?)` returns its disposer (idempotent); `matchRoute(pattern, path)` is the pure matcher, for tests and servers. Types and the contract: `routes.ts`.

Working: [examples/jobs](https://github.com/blueshed/dzql/tree/main/packages/railroad/examples/jobs), whose `app.tsx` has the order (`/jobs/new` before
`/jobs/:id`), a route per job, an unkeyed wildcard layout, a catch-all taking its path apart and
`onError`;
`JobPage` splits the query off (`resources/jobs/jobs-view.tsx`) and the layout picks its runner by
`route()` (`resources/runners/runners-view.tsx`).

- The first match wins, in declaration order: `/users/new` before `/users/:id`.
- Segments only: no query strings (`#/users/42?tab=1` gives `id` `"42?tab=1"`; split `?` yourself), and a trailing slash is a segment (`/users/42/` doesn't match `/users/:id`).
- A route is keyed: when its params change (`/users/1` → `/users/2`) the old run is disposed and the handler runs again, untracked, so `({ id }) => …` is right (local state and focus reset).
- A layout that must stay mounted says `{ keyed: false, handler }`: it runs once per pattern, its `params` stay the first match, and `params$`, its second argument, follows. A wildcard layout wants it, or every sub-path (`params["*"]`) remounts it: `/sites/*` matches `/sites` and keeps the layout while `route()` swaps the inside.
- What a handler loads is `when(resolved(load(id)), …)`, the handler synchronous ([async](async.md)); keyed, it loads again for new params, and what it built dies on navigation.
- `onError` runs when a handler throws or rejects (`err` is `unknown`); a returned Node renders in the target. Without it the error goes to `console.error`.
- `navigate()` is synchronous. Setting `location.hash`, or following a `#/…` link, lands on the next `hashchange`, a macrotask later.
