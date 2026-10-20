/**
 * Routes — Hash-based client router built on signals
 *
 * API:
 *   routes(target, table, options?) — declarative hash router, swaps target
 *                             content; a table value is a handler or
 *                             { handler, keyed? } (keyed unless keyed: false)
 *   route<T>(pattern)       — reactive route: Signal<T | null>, null when unmatched
 *   navigate(path)          — set location.hash; route() and routes() are
 *                             current when it returns (no tick to wait for)
 *   matchRoute(pattern, path) — pure pattern matcher, returns params or null
 *
 * Patterns:
 *   "/users/:id"     — named params, exact segment match
 *   "/sites/*"       — wildcard, matches /sites and /sites/any/depth
 *   "/sites/:id/*"   — params + wildcard, rest captured as params["*"]
 *
 * Patterns are tested in declaration order; the first match wins. Declare
 * specific routes before parameterised ones (`/users/new` before `/users/:id`).
 *
 * Matching is purely segment-based — there is no query-string handling. A
 * hash of "#/users/42?tab=1" matches "/users/:id" with id === "42?tab=1"
 * (split on "?" yourself if you need it), and a trailing slash is a real
 * empty segment: "/users/42/" does NOT match "/users/:id".
 *
 * Handlers receive (params, params$) and return a Node, synchronously. Data
 * that comes later is a signal, when(resolved(promise), …), so what its
 * branch builds is in the handler's scope however late it comes:
 *   "/users/:id": ({ id }) => when(resolved(load(id)), (r) => …, () => <p>…</p>)
 * An async handler is an error (onError, or the console): what it built after
 * its first await would have no owner scope. A handler, like a component, runs
 * untracked: a .get() in it is a one-shot read that doesn't subscribe the
 * router (and warns, in development).
 *
 * Routes are keyed: a handler runs again whenever the matched params change
 * (compared value by value), the previous run disposed, as Solid's
 * <Show keyed> does. So `params` is the match, and destructuring is right:
 *   "/users/:id": ({ id }) => <User id={id} />
 * /users/1 → /users/2 runs it again for 2 (local state and focus reset).
 *
 * A layout opts out — `{ handler, keyed: false }` runs once per pattern and
 * stays mounted while its params change; they reach it through params$, a
 * ReadonlySignal of the current match (its `params` stays the first):
 *   "/sites/*": { keyed: false, handler: (_, p$) => <Sites rest$={p$.map(p => p["*"])} /> }
 * A wildcard layout wants it, or every sub-path remounts it (its params["*"]
 * changes). params$ is given to a keyed handler too; it changes only when the
 * handler runs again.
 *
 * navigate(path) updates the route signal synchronously, so route() and the
 * router show the new path as navigate() returns, and the hashchange that
 * follows re-runs nothing. Setting location.hash yourself, or following an
 * <a href="#/…">, still lands on the next hashchange (a macrotask later).
 *
 * Nested routes — use a wildcard, unkeyed, to keep a layout mounted:
 *   routes(app, {
 *     "/":          () => <Home />,
 *     "/sites/*":   { keyed: false, handler: () => <SitesLayout /> },
 *   });
 *   // Inside SitesLayout, use route() for sub-navigation:
 *   const detail = route("/sites/:id");
 *
 * Both routes() and route() auto-track in the parent dispose scope,
 * so nested routing cleans up when the parent scope tears down.
 *
 * route() at module level (outside any dispose scope) is SUPPORTED: the
 * signal and its share of the hashchange listener simply live for the app's
 * lifetime, which is what module scope means. That's why route() doesn't warn
 * when scopeless the way when()/list() do — for those, scopeless is almost
 * always a leak; for route() it's a legitimate app-lifetime binding.
 */

import { Signal, signal, computed, effect, untrack, untrackRender, scoped, trackDispose } from "./signals";
import type { Dispose, ReadonlySignal } from "./signals";
import { adoptIntoSvg } from "./jsx";

// The hash as a signal, shared by every route() and routes() through one
// hashchange listener, counted.
let hashSignal: Signal<string> | null = null;
let hashListenerCount = 0;
let hashListener: (() => void) | null = null;

// A share of the hash signal, and its release. The release runs once however
// often it is called, so disposing a scope twice can't drive the count
// negative and detach the listener from other routers; the last removes it.
function getHash(): { hash: Signal<string>; release: Dispose } {
  if (!hashSignal) {
    hashSignal = new Signal(location.hash.slice(1) || "/");
    hashListener = () => {
      hashSignal!.set(location.hash.slice(1) || "/");
    };
    window.addEventListener("hashchange", hashListener);
  }
  hashListenerCount++;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    if (--hashListenerCount === 0) {
      window.removeEventListener("hashchange", hashListener!);
      hashListener = null;
      hashSignal = null;
    }
  };
  return { hash: hashSignal, release };
}

export function matchRoute(
  pattern: string,
  path: string,
): Record<string, string> | null {
  const pp = pattern.split("/");
  const hp = path.split("/");
  const isWild = pp.length > 0 && pp[pp.length - 1] === "*";

  if (isWild) {
    if (hp.length < pp.length - 1) return null;
  } else {
    if (pp.length !== hp.length) return null;
  }

  const params: Record<string, string> = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i] === "*") {
      params["*"] = hp.slice(i).map(s => {
        try { return decodeURIComponent(s); } catch { return s; }
      }).join("/");
      return params;
    } else if (pp[i]!.startsWith(":")) {
      // A malformed percent-escape must not silently un-match the route.
      // Fall back to the raw segment, consistent with the wildcard branch.
      try {
        params[pp[i]!.slice(1)] = decodeURIComponent(hp[i]!);
      } catch {
        params[pp[i]!.slice(1)] = hp[i]!;
      }
    } else if (pp[i] !== hp[i]) return null;
  }
  return params;
}

// Two matches of one pattern have the same keys; compare their values.
function sameParams(a: Record<string, string>, b: Record<string, string>): boolean {
  return Object.keys(a).every((k) => a[k] === b[k]);
}

export function route<
  T extends Record<string, string> = Record<string, string>,
>(pattern: string): ReadonlySignal<T | null> {
  const { hash, release } = getHash();
  trackDispose(release);
  return computed(() => matchRoute(pattern, hash.get()) as T | null);
}

export function navigate(path: string): void {
  location.hash = path;
  // Set the route signal now rather than a tick later on hashchange, so route()
  // and routes() are current when navigate() returns. Read the hash back rather
  // than using `path`: the browser percent-encodes it ("a b" → "a%20b"), and
  // the hashchange that follows sets this same string, so it re-runs nothing.
  hashSignal?.set(location.hash.slice(1) || "/");
}

/** A route handler: returns a Node, synchronously. */
type RouteHandler = (
  params: Record<string, string>,
  params$: ReadonlySignal<Record<string, string>>,
) => Node;

/** A table entry: a handler, or `{ handler, keyed }`. Keyed (the default) the
 *  handler runs again (a fresh scope, the old one disposed) whenever the
 *  matched params change; with `keyed: false` it runs once per pattern and
 *  follows its params through params$, as a layout does. */
type RouteEntry<H> = H | { handler: H; keyed?: boolean };

export interface RouterOptions {
  onError?: (err: unknown) => Node | void;
}

export function routes(
  target: Element,
  table: Record<string, RouteEntry<RouteHandler>>,
  options?: RouterOptions,
): Dispose {
  const { hash, release } = getHash();
  let activePattern: string | null = null;
  let activeParams: Signal<Record<string, string>> | null = null;
  let activeDispose: Dispose | null = null;

  function teardown() {
    if (activeDispose) activeDispose();
    activeDispose = null;
    activePattern = null;
    activeParams = null;
    target.replaceChildren();
  }

  // Show onError's fallback for a failed render (one that threw, or returned
  // no Node), or log it, and forget the route so the next
  // navigation runs it again. A throwing onError is logged, never thrown, so
  // it can't escape as an unhandled rejection. The fallback renders under a
  // scope of its own, disposed when the router moves on, as a handler's is.
  function failed(err: unknown, log: string): void {
    activePattern = null;
    activeParams = null;
    try {
      const fallback = scoped(() => {
        const node = options?.onError?.(err);
        return node instanceof Node ? adoptIntoSvg(node, target) : null;
      });
      activeDispose = fallback.dispose;
      if (fallback.value) {
        target.appendChild(fallback.value);
        return;
      }
    } catch (boundaryErr) {
      console.error("[railroad/routes] onError boundary threw:", boundaryErr);
      return;
    }
    console.error(log, err);
  }

  function run(handler: RouteHandler, params: Record<string, string>) {
    const params$ = signal(params);
    activeParams = params$;
    let ran: { value: Node; dispose: Dispose };
    try {
      ran = scoped(() => {
        const r: unknown = untrackRender("a route handler", handler, () => handler(params, params$));
        if (r instanceof Node) return adoptIntoSvg(r, target);
        throw new Error(r instanceof Promise
          ? "[railroad] a route handler is async: what it builds after an await has no scope. Return DOM " +
            "synchronously, and show the data that comes later as a signal: when(resolved(promise), …)."
          : "[railroad] a route handler returned a non-Node — return DOM.");
      });
    } catch (err) {
      return failed(err, "[railroad/routes] handler threw:");
    }
    activeDispose = ran.dispose;
    target.appendChild(ran.value);
  }

  // Register the outer dispose into the caller's scope BEFORE creating the
  // effect, so dispose lands in the caller's scope (not the router's own
  // internal one): this is about attributing dispose to the right scope.
  let disposeEffect: Dispose | null = null;
  let disposed = false;
  const dispose = () => {
    // Idempotent: called by the returned handle and by a parent scope, it
    // tears down once.
    if (disposed) return;
    disposed = true;
    if (disposeEffect) disposeEffect();
    teardown();
    release();
  };
  trackDispose(dispose);

  // Show whatever `path` matches. Runs untracked (below): a handler is a render
  // body, so a .get() inside it must not subscribe the router.
  function show(path: string) {
    for (const [pattern, entry] of Object.entries(table)) {
      const params = matchRoute(pattern, path);
      if (!params) continue;
      const { handler, keyed = true } = typeof entry === "function" ? { handler: entry } : entry;
      // Same pattern, new params: a keyed route (the default) runs again
      // whenever they differ. An unkeyed one has them pushed into params$, no
      // teardown.
      if (pattern === activePattern && !(keyed && !sameParams(params, activeParams!.peek()))) {
        activeParams!.set(params);
        return;
      }
      teardown();
      activePattern = pattern;
      run(handler, params);
      return;
    }
    teardown();
  }

  disposeEffect = effect(() => {
    const path = hash.get();
    untrack(() => show(path));
  });

  return dispose;
}
