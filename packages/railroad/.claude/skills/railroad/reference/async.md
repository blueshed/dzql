# Data that comes later

```tsx
import { mount, resolved, routes, when } from "@blueshed/railroad";

type User = { name: string };
const load = (url: string) => fetch(url).then((r) => r.json() as Promise<User>);

function Profile() {
  return when(resolved(load("/api/me")), (r) => {
    if ("error" in r) return <p class="error">no profile</p>;
    const user = r.value.peek();                  // settled: it never changes again
    return <div>{user.name}</div>;
  }, () => <p>loading…</p>);
}

mount(document.getElementById("profile")!, () => <Profile />);

routes(document.getElementById("root")!, {
  "/users/:id": ({ id }) => when(resolved(load(`/api/users/${id}`)), (r) =>
    "error" in r ? <p class="error">no such user</p> : <h1>{r.value.peek().name}</h1>),
});
```

What a promise brings is a signal: `resolved(promise)` is `null` until it settles, then `{ value }` or `{ error }`, and `when()` shows it. The component or handler stays synchronous, so everything its branch builds is in a scope railroad owns, however late the promise settles. Never `await` before you build: after an `await` there is no scope (browser JS has no AsyncContext).

Working: [examples/jobs](https://github.com/blueshed/dzql/tree/main/packages/railroad/examples/jobs), a job's page by route (`JobPage`), its log, left before
it comes (`JobLog`), and `NewJobPage`, which waits for the runners, in
`resources/jobs/jobs-view.tsx`; async work started from an effect in
`resources/runners/runners-view.tsx`.

- `when()` hands the branch what it settled as, `{ value }` or `{ error }`, as its fields ([when-list](when-list.md)). `"error" in r` tells the two apart; TypeScript won't let `r.value` be read until the error is ruled out. It settles once and never changes again, so `r.value.peek()` reads it. A rejection is that `{ error }`, never an unhandled rejection.
- `when()`'s falsy branch is the wait; it goes when the promise settles.
- Left before it settles (a navigation, a branch swapped out), nothing is built.
- A route is keyed, so `({ id }) => when(resolved(load(id)), …)` loads again for each id. A handler that throws goes to `routes()`' `onError`.
- For streams or several stages rather than one swap, an effect writes a signal and `when()` shows it.
- `effect(async () => …)` is an error (logged in development): start the async work from a synchronous effect and write the result to a signal.
- An `async` component or handler doesn't compile (a component returns a Node). Run anyway, a component renders nothing and says why in development; a handler goes to `onError`.
