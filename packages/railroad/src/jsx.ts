/**
 * JSX Runtime — real DOM elements backed by signals
 *
 * createElement(tag, props, ...children)
 *   - tag: string → creates HTML element (or SVG element inside <svg>)
 *   - tag: function → calls component function(props), synchronously. Data
 *     that comes later is a signal, when(resolved(promise), …): nothing made
 *     after an await has a scope (browser JS has no AsyncContext), so an async
 *     component (one returning a Promise) renders nothing, and in development
 *     says so on the console.
 *   - props: attributes, event handlers (onclick etc), ref — applied after the
 *     children are appended, so a <select>'s value finds its <option>s and a
 *     ref sees the element whole
 *   - children: string, number, Node, Signal<T>, () => any, arrays, null/undefined
 *
 * When a Signal is used as a child, an effect auto-updates the text node.
 * When a function is used as a child, it auto-tracks dependencies:
 *   <span>{() => count.get() > 5 ? "High" : "Low"}</span>
 * When a Signal or a function is used as a prop value (other than ref and
 * on*), an effect auto-updates the attribute — same rule as children:
 *   <div class={() => open.get() ? "open" : ""} />
 * style accepts a CSS string or an object of properties, static or reactive.
 *
 * when() and list() render their initial content synchronously: it is in the
 * DOM as soon as the returned fragment is appended.
 *
 * Components are auto-scoped — effects/computeds inside are disposed when
 * the parent scope (route, when, list) tears down. No manual dispose needed.
 *
 * Render bodies are untracked: a component body, a when() branch and a list()
 * row run once, so a .get() there is a one-shot read that subscribes nothing
 * (not the when()/list() driving it, nor an effect that builds it). Pass the
 * signal itself, or a function, where the value should stay live. In
 * development such a .get() warns, once per render body; .peek() doesn't.
 *
 * SVG support:
 *   SVG-only tags (circle, g, linearGradient, foreignObject, fe* filters, …)
 *   are created directly in the SVG namespace — refs fire once, manual
 *   addEventListener calls survive, camelCase is preserved, and
 *   <foreignObject> children stay HTML. The only tags that can't be decided
 *   at creation are the four shared with HTML (a, script, style, title):
 *   those are created as HTML and namespace-adopted when appended to an SVG
 *   parent. On that fallback path the adopted element is a fresh node, so a
 *   `ref` fires twice (use the last call) and manual addEventListener calls
 *   are lost — use on* props, which are re-applied. Elements built by hand
 *   with createElementNS pass through untouched.
 *
 * Reactive helpers:
 *   mount(target, render, opts?)  — root dispose scope; returns the disposer,
 *                                   which removes its nodes; opts.before places
 *                                   them before a child of target
 *   when(signal, truthy, falsy?)  — conditional rendering; rebuilds the branch
 *                                   only when the condition's truthiness flips.
 *                                   truthy receives the current truthy value as a
 *                                   list() row is (Row<NonNullable<T>>): an object
 *                                   as its fields, each a ReadonlySignal, anything
 *                                   else as its signal; then v$, the value's own
 *                                   signal. So the branch follows a value change
 *                                   without a rebuild:
 *                                   when(detail, ({ id }) => <Site id={id} />)
 *   list(signal, keyFn, render)   — keyed reactive list; render receives the row as
 *                                   its fields, each a ReadonlySignal (Row<T>), so
 *                                   destructuring is right: ({ name }) => <li>{name}</li>;
 *                                   then index$, then the row's own signal row$
 *   list(signal, render)          — index-based reactive list, render receives raw T
 *
 * when() and list() warn (in development) if created outside a dispose scope
 * (a component, routes() handler, when/list render, or mount()) — their
 * internal effects would be impossible to tear down.
 *
 * A when() branch or list() row that throws keeps nothing: what it made
 * before the throw is disposed, nothing of it is inserted, and the next change
 * builds it again. A list()'s other rows still render (an index-based row that
 * throws on a rebuild is left empty between its brackets), then the first
 * error is rethrown. The throw leaves when()/list() on the first render (the
 * when() or list() still goes with the scope around it, with the rows made
 * beside it and whatever it builds later), and reaches the writer of the
 * condition or the items on an update.
 *
 * A Signal made by another copy of railroad throws where it is given as a
 * child, a prop, a when() condition or a list() source: this copy can't track
 * it, so it would render once and never update (see signals.ts).
 *
 * Types: each tag's props are typed from the DOM's element types (see
 * "Intrinsic element props" below), so a typo or React's `onClick` doesn't
 * compile. Railroad declares no global JSX namespace, so it sits beside React's
 * types in one app. `jsx: react` with `jsxFactory: "createElement"` finds the
 * types on the factory (createElement.JSX); `jsx: react-jsx` with
 * `jsxImportSource: "@blueshed/railroad"` finds jsx-runtime's JSX export. To
 * annotate: `import type { JSX } from "@blueshed/railroad"` (JSX.Element is Node).
 */

import { Signal, signal, effect, computed, untrack, untrackRender, scoped, trackDispose, hasActiveDisposeScope, assertOwnSignal, warn } from "./signals";
import type { Dispose, ReadonlySignal } from "./signals";

// === SVG namespace ===

const SVG_NS = "http://www.w3.org/2000/svg";

// SVG-only tag names (no overlap with HTML), so the namespace is decided at
// creation: refs fire once, manual addEventListener survives, and no adoption
// pass is needed for real SVG work. The four tags shared with HTML (a, script,
// style, title) can't be disambiguated bottom-up — they are created as HTML
// and namespace-adopted on append to an SVG parent.
const SVG_TAGS = new Set([
  "animate", "animateMotion", "animateTransform", "circle", "clipPath",
  "defs", "desc", "ellipse", "feBlend", "feColorMatrix", "feComponentTransfer",
  "feComposite", "feConvolveMatrix", "feDiffuseLighting", "feDisplacementMap",
  "feDistantLight", "feDropShadow", "feFlood", "feFuncA", "feFuncB", "feFuncG",
  "feFuncR", "feGaussianBlur", "feImage", "feMerge", "feMergeNode",
  "feMorphology", "feOffset", "fePointLight", "feSpecularLighting",
  "feSpotLight", "feTile", "feTurbulence", "filter", "foreignObject", "g",
  "image", "line", "linearGradient", "marker", "mask", "metadata", "mpath",
  "path", "pattern", "polygon", "polyline", "radialGradient", "rect", "set",
  "stop", "svg", "switch", "symbol", "text", "textPath", "tspan", "use",
  "view",
]);

const storedProps = new WeakMap<Element, Record<string, any>>();
// Disposers for the reactive effects applyProps creates per element. SVG
// adoption discards the original HTML-namespace element and re-applies its
// props to a fresh SVG element; without tearing these down first, both elements
// would stay subscribed and the detached one would keep being written to.
const propEffectDisposers = new WeakMap<Element, Dispose[]>();

// === Fragment ===

export function Fragment(props: any): DocumentFragment {
  const frag = document.createDocumentFragment();
  const children = props?.children
    ? (Array.isArray(props.children) ? props.children : [props.children])
    : [];
  appendChildren(frag, children);
  return frag;
}

// === Props application ===

// Apply a style value: a CSS string (cssText) or an object of properties.
// `prev` carries what the last reactive value set — the object keys, or null
// after a string — so the next value can clear what it no longer names.
type StyleState = { keys: Set<string> | null };

function applyStyle(el: Element, v: unknown, prev: StyleState): void {
  const elStyle = (el as HTMLElement).style;
  if (v == null || v === false || typeof v === "string") {
    prev.keys = null;
    if (v == null || v === false || v === "") el.removeAttribute("style");
    else el.setAttribute("style", v);
    return;
  }
  // Coming from a string (or the first run), start from a clean attribute so
  // properties set by the old cssText don't linger under the object form.
  if (prev.keys === null) el.removeAttribute("style");
  const next = v as Record<string, string>;
  // A custom property (--x) exists only through setProperty; camelCase keys
  // are properties of the declaration.
  const set = (k: string, val: string) =>
    k.startsWith("--") ? elStyle.setProperty(k, val) : (elStyle[k as any] = val);
  for (const k of prev.keys ?? []) {
    if (!(k in next)) set(k, "");
  }
  prev.keys = new Set(Object.keys(next));
  for (const [k, val] of Object.entries(next)) set(k, val);
}

function applyProps(el: Element, props: Record<string, any>): void {
  const disposers: Dispose[] = [];
  for (const [key, value] of Object.entries(props)) {
    if (key === "ref") {
      if (typeof value === "function") value(el);
      continue;
    }
    if (key.startsWith("on")) {
      // A non-function here (a Signal, or an accidentally-invoked handler)
      // would be silently ignored by addEventListener — the element just
      // doesn't respond, with nothing to say why. null/undefined stay legal:
      // `onclick={maybeHandler}` is a real conditional-handler pattern.
      if (typeof value === "function") {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (value != null) {
        warn?.handlerNotAFunction(key, value);
      }
      continue;
    }

    // Every other prop is reactive when given a Signal or a function — the
    // same rule as children, so `class={() => …}` tracks like `{() => …}`.
    // Anything else is applied once.
    let apply: (v: any) => void;
    if (key === "innerHTML") {
      apply = (v) => { el.innerHTML = v ?? ""; };
    } else if (key === "value" || key === "checked" || key === "disabled" || key === "selected" || key === "srcdoc" || key === "src") {
      // Coerce null/undefined to "" so a cleared signal doesn't write the
      // literal string "null"/"undefined" into the DOM property.
      apply = (v) => { (el as any)[key] = v ?? ""; };
    } else if (key === "style") {
      const prev: StyleState = { keys: null };
      apply = (v) => applyStyle(el, v, prev);
    } else {
      // className and htmlFor are the DOM properties' names for `class` and `for`.
      const name = key === "className" ? "class" : key === "htmlFor" ? "for" : key;
      apply = (v) => {
        if (v === false || v == null) el.removeAttribute(name);
        else el.setAttribute(name, String(v));
      };
    }

    if (value instanceof Signal) {
      disposers.push(effect(() => apply(value.get())));
    } else if (typeof value === "function") {
      disposers.push(effect(() => apply(value())));
    } else {
      assertOwnSignal(value);
      apply(value);
    }
  }
  if (disposers.length) propEffectDisposers.set(el, disposers);
}

// === createElement ===

export function createElement(
  tag: string | Function,
  props: Record<string, any> | null,
  ...children: any[]
): Node {
  if (typeof tag === "function") {
    const componentProps: Record<string, any> = { ...props, children };
    const { value, dispose } = scoped(() => {
      // Untracked: a component runs once, so a .get() in its body is a one-shot
      // read and must not subscribe whatever effect is building it.
      const result = untrackRender("component", tag, () => tag(componentProps));
      if (!(result instanceof Promise)) return result;
      // An async component. What it makes after its first await has no scope
      // (browser JS has no AsyncContext), so nothing could tear it down: it
      // renders nothing, and in development says to use resolved().
      warn?.asyncComponent(tag.name || "anonymous");
      return document.createComment("async");
    });
    trackDispose(dispose); // the component goes with the scope around it
    return value;
  }

  // SVG-only tags are created in the SVG namespace outright; only the
  // HTML/SVG-ambiguous tags fall back to adoption in appendChildren.
  const el = SVG_TAGS.has(tag)
    ? document.createElementNS(SVG_NS, tag)
    : document.createElement(tag);

  // Children first: a <select>'s value names one of its <option>s, and a ref
  // sees the element whole.
  appendChildren(el, children);
  if (props) {
    storedProps.set(el, props);
    applyProps(el, props);
  }
  return el;
}

// === SVG adoption ===

/**
 * Recursively adopt an HTML element into the SVG namespace.
 * Creates a new SVG element, re-applies stored props (or copies
 * attributes), and recursively adopts all children.
 */
function adoptSvg(node: Node): Node {
  if (!(node instanceof Element) || node.namespaceURI === SVG_NS) return node;

  const svgEl = document.createElementNS(SVG_NS, node.localName);
  // Adopt children recursively — except through <foreignObject>, whose
  // subtree is HTML content by definition and must keep its namespace. They
  // move before the props are re-applied, as createElement orders them.
  const isForeign = svgEl.localName === "foreignObject";
  while (node.firstChild) {
    const child = node.removeChild(node.firstChild);
    svgEl.appendChild(isForeign ? child : adoptSvg(child));
  }

  const props = storedProps.get(node);
  if (props) {
    // Dispose the discarded HTML element's reactive prop effects before
    // re-applying props to the SVG element, so each signal keeps exactly one
    // live effect (targeting svgEl) rather than leaking one onto the detached
    // node. The disposed effects are idempotent, so the owning scope tearing
    // them down again later is a no-op.
    const oldDisposers = propEffectDisposers.get(node);
    if (oldDisposers) {
      for (const d of oldDisposers) d();
      propEffectDisposers.delete(node);
    }
    storedProps.set(svgEl, props);
    applyProps(svgEl, props);
  } else {
    // No stored props — copy attributes directly
    for (let i = 0; i < node.attributes.length; i++) {
      const attr = node.attributes[i]!;
      svgEl.setAttribute(attr.name, attr.value);
    }
  }

  return svgEl;
}

/**
 * @internal -- jsx.ts and routes(): adopt a render result into the SVG
 * namespace if the target parent is SVG. Must run before the caller captures
 * child-node references, because `adoptSvg` replaces elements with fresh
 * SVG-namespace copies. DocumentFragments are mutated in place; single
 * elements are returned swapped (caller must reassign).
 */
export function adoptIntoSvg(result: Node, parent: Node | null): Node {
  // <foreignObject> is an SVG-namespace element whose children are HTML —
  // adoption stops at that boundary.
  if (
    !(parent instanceof Element) ||
    parent.namespaceURI !== SVG_NS ||
    parent.localName === "foreignObject"
  ) {
    return result;
  }
  if (result instanceof DocumentFragment) {
    const children = [...result.childNodes];
    for (const child of children) {
      if (child instanceof Element && child.namespaceURI !== SVG_NS) {
        result.replaceChild(adoptSvg(child), child);
      }
    }
    return result;
  }
  if (result instanceof Element && result.namespaceURI !== SVG_NS) {
    return adoptSvg(result);
  }
  return result;
}

// === Bracket comments ===
//
// when() and each list() row keep their content between two comments rather
// than as a node array captured at render, so removal stays correct when SVG
// adoption swaps node identities after capture, and nodes a nested
// when()/list() inserts later go with it.

// Remove every node between two bracket comments, leaving the brackets.
function clearBetween(start: Node, end: Node): void {
  for (let n = start.nextSibling; n && n !== end; n = start.nextSibling) {
    n.parentNode!.removeChild(n);
  }
}

// A when() branch: one piece of content at a time between brackets, with the
// scope that made it. Its teardown, registered in the scope around it, latches
// `disposed` (nothing rebuilds after it: the brackets can still sit in a
// detached-but-parented subtree, so a parent check isn't enough) and clears.
// Returned with the fragment holding the brackets, for the caller to return.
interface Bracket {
  start: Comment;
  end: Comment;
  dispose: Dispose | null; // the content's scope
  disposed: boolean;
  clear(): void; // dispose the content and remove it
  fill(built: { value: Node | null; dispose: Dispose }): void; // place a render's content and scope
}

function bracket(name: string): [Bracket, DocumentFragment] {
  const frag = document.createDocumentFragment();
  const start = frag.appendChild(document.createComment(name));
  const end = frag.appendChild(document.createComment(`/${name}`));
  const b: Bracket = {
    start, end, dispose: null, disposed: false,
    clear() {
      b.dispose?.();
      b.dispose = null;
      clearBetween(start, end);
    },
    // A render that disposed the bracket's owner (a navigation, say) ran
    // after the teardown: what it built is dropped, not placed.
    fill(built) {
      if (b.disposed) return built.dispose();
      b.dispose = built.dispose;
      if (built.value) end.parentNode!.insertBefore(built.value, end);
    },
  };
  trackDispose(() => {
    b.disposed = true;
    b.clear();
  });
  return [b, frag];
}

// === Child rendering ===

function appendChildren(parent: Node, children: any[]): void {
  // foreignObject children are HTML by definition — never adopt them.
  const isSvgParent = parent instanceof Element &&
    parent.namespaceURI === SVG_NS &&
    parent.localName !== "foreignObject";

  for (const child of children.flat(Infinity)) {
    if (child == null || child === false || child === true) continue;

    if (child instanceof Signal || typeof child === "function") {
      // A reactive text node. Its value renders as a static child's would:
      // null, undefined and booleans as nothing.
      const read: () => unknown = child instanceof Signal ? () => child.get() : child;
      const textNode = document.createTextNode("");
      let warnedNode = false;
      effect(() => {
        const v = read();
        if (!warnedNode && v instanceof Node) {
          warnedNode = true;
          warn?.nodeAsText();
        }
        textNode.textContent = v == null || typeof v === "boolean" ? "" : String(v);
      });
      parent.appendChild(textNode);
    } else if (child instanceof Node) {
      // Adopt HTML elements — and the element children of DocumentFragments
      // (from <>...</> or components returning fragments) — into the SVG
      // namespace when the parent is SVG. adoptIntoSvg handles both shapes
      // and passes Text/Comment/already-SVG nodes through untouched.
      parent.appendChild(isSvgParent ? adoptIntoSvg(child, parent) : child);
    } else {
      assertOwnSignal(child);
      parent.appendChild(document.createTextNode(String(child)));
    }
  }
}


// === mount() — root dispose scope for an app mounted outside routes() ===

/** Where mount() places what it renders: before `before`, a child of the
 *  target (null or absent: at the end). */
export interface MountOptions {
  before?: Node | null;
}

/**
 * Mount UI into `target` under a fresh dispose scope. Effects, computeds,
 * when() and list() created by `render` tear down when the returned disposer
 * runs, which also removes the rendered nodes. `render` runs untracked, like
 * a component body: a .get() in it doesn't subscribe an effect calling mount(). Use this (or routes()) for app
 * roots so the scope rules in signals.ts hold all the way down.
 *
 *   const dispose = mount(document.getElementById("root")!, () => <App />);
 *
 * The nodes go at the end of `target`, or before `options.before` (one of its
 * children): a root placed by hand, a toast first in its host, say, is a mount,
 * and its disposer takes its nodes out wherever they went.
 *   const dismiss = mount(host, () => <Toast />, { before: host.firstChild });
 */
export function mount(target: Element, render: () => Node, options?: MountOptions): Dispose {
  const { value: adopted, dispose: scopeDispose } = scoped(() =>
    adoptIntoSvg(untrackRender("mount()'s render", render, render), target));
  const nodes = adopted instanceof DocumentFragment
    ? [...adopted.childNodes]
    : [adopted];
  target.insertBefore(adopted, options?.before ?? null);
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    scopeDispose();
    for (const n of nodes) n.parentNode?.removeChild(n);
  };
  trackDispose(dispose); // nested mounts compose with an outer scope
  return dispose;
}

// === Rows: a value as its fields ===

/**
 * A value as a keyed list() row and a when() branch receive it: for an object,
 * its fields, each a ReadonlySignal of that field (so `({ name, status }) => …`
 * destructures it and binds each); for anything else (a primitive, an array),
 * its signal.
 */
export type Row<T> = [T] extends [readonly unknown[]] ? ReadonlySignal<T>
  : [T] extends [object] ? { readonly [K in keyof T]-?: ReadonlySignal<T[K]> }
  : ReadonlySignal<T>;

// The fields of a value: each a projection of value$, made the first time it
// is read and kept, so every read of `row.name` is the one signal. They are
// made under a scope of their own, not the reader's (a field first read in a
// nested when() branch must outlive that branch), and go with `release`, which
// the row or branch calls when it goes. Only keys the value has, or doesn't
// share with Object.prototype, are fields: String(row) still works. Whether it
// is fields is decided by the first value. `inWhen` says whose it is, for the
// warning.
function rowOf<T>(value$: ReadonlySignal<T>, inWhen: boolean): { row: Row<T>; release: Dispose } {
  const own: Dispose[] = [];
  const release = () => { for (const d of own.splice(0)) d(); };
  const value = () => value$.peek() as object;
  const first = value();
  if (typeof first !== "object" || first === null || Array.isArray(first)) return { row: value$ as Row<T>, release };
  const fields = new Map<string, ReadonlySignal<unknown>>();
  const field = (k: string) => {
    let s = fields.get(k);
    if (!s) {
      if (warn && (k === "get" || k === "peek" || k === "map") && !(k in value())) warn.rowAsSignal(k, inWhen);
      const made = scoped(() => computed(() => (value$.get() as Record<string, unknown>)[k]));
      own.push(made.dispose);
      fields.set(k, (s = made.value));
    }
    return s;
  };
  const row = new Proxy({}, {
    get: (target, k) =>
      typeof k === "symbol" || (k in target && !Object.hasOwn(value(), k)) ? Reflect.get(target, k) : field(k),
    has: (_, k) => k in value(),
    ownKeys: () => Object.keys(value()),
    getOwnPropertyDescriptor: (_, k) =>
      typeof k === "string" && Object.hasOwn(value(), k)
        ? { configurable: true, enumerable: true, writable: false, value: field(k) }
        : undefined,
    set: () => false, // a value is changed at its source, never through its fields
  }) as Row<T>;
  return { row, release };
}

// === when() — conditional rendering ===
// Swaps DOM nodes only when truthiness transitions (falsy↔truthy).
// Value changes within the same branch (e.g. "a" → "b") do NOT re-render;
// they reach the truthy branch through its arguments: the value as a list()
// row is (its fields for an object, its signal otherwise), then v$, a
// ReadonlySignal of the current truthy value that notifies whenever the
// condition does while truthy (an in-place touch() included). So the branch
// binds to them:
//   when(isLoggedIn, () => <Dashboard />, () => <Login />)
//   when(detail, ({ id, name }) => <SiteDetail id={id} name={name} />)
//   when(count, (n$) => <p>{n$}</p>)

export function when<T>(
  condition: ReadonlySignal<T> | (() => T),
  truthy: (value: Row<NonNullable<T>>, value$: ReadonlySignal<NonNullable<T>>) => Node,
  falsy?: () => Node,
): Node {
  if (!hasActiveDisposeScope()) warn?.scopeless("when");
  assertOwnSignal(condition);
  // The branch lives between brackets, whose teardown goes with the scope
  // around when(). Registered before the first swap, as list()'s is: a first
  // branch that throws leaves when() with its effect live, and if that scope
  // outlives the throw, what the next change builds must still go with it.
  const [b, frag] = bracket("when");
  let wasTruthy: boolean | undefined = undefined;
  // The truthy branch's v$, fresh per build. It never holds a falsy value: a
  // falsy condition disposes the branch instead of writing v$. equals: () =>
  // false, so it notifies whenever the condition did (the condition already
  // decided that), including a touch() that keeps the same reference.
  let value$: Signal<NonNullable<T>> | null = null;

  const sig: ReadonlySignal<T> = typeof condition === "function"
    ? computed(condition as () => T)
    : condition;

  function swap() {
    if (b.disposed) return;
    // On the first run the brackets are in frag, so the first branch renders
    // synchronously: it is in the DOM when mount()/appendChild returns.
    const parent = b.start.parentNode;
    if (!parent) return; // brackets removed out of contract — nowhere to render
    const value = sig.peek(); // the effect below tracked it
    const isTruthy = !!value;

    // Only swap when truthiness actually changes; a new truthy value goes to v$.
    if (isTruthy === wasTruthy) {
      if (isTruthy) value$!.set(value as NonNullable<T>);
      return;
    }
    // Unset until the new branch has built. A branch that throws keeps
    // nothing: what it made is disposed, the brackets stay empty, and the next
    // change of the condition builds again.
    wasTruthy = undefined;
    b.clear();
    value$ = isTruthy ? signal(value as NonNullable<T>, { equals: () => false }) : null;
    const v$ = value$;
    // The value's fields, released with the branch, or at its throw.
    const fields = v$ && rowOf(v$, true);
    let branch: { value: Node | null; dispose: Dispose };
    try {
      branch = scoped(() => {
        const node = fields
          ? untrackRender("a when() branch", truthy, () => truthy(fields.row, v$!))
          : falsy ? untrackRender("a when() branch", falsy, falsy) : null;
        return node && adoptIntoSvg(node, parent);
      });
    } catch (err) {
      fields?.release();
      throw err;
    }
    wasTruthy = isTruthy;
    b.fill(fields ? { value: branch.value, dispose: () => { branch.dispose(); fields.release(); } } : branch);
  }

  // Only the condition is tracked; the branch renders untracked, so a .get()
  // inside it doesn't re-run this effect.
  effect(() => {
    sig.get();
    untrack(swap);
  });

  return frag;
}

// === list() — keyed reactive list rendering ===
// Diffs by key to preserve DOM nodes across updates. A reorder moves only the
// rows outside the longest run already in order, so a row that didn't move
// keeps its focus, selection and scroll position.
//
// Keyed form — render receives the row as its fields, each a ReadonlySignal,
// then the index as a ReadonlySignal, then the row's own signal, so item
// updates flow into existing DOM without re-creating nodes:
//   list(items, (t) => t.id, ({ name }) => <li>{name}</li>)
//   list(items, (t) => t.id, (_, i$, item$) => <Card card$={item$} />)
// A row is pushed on with Object.is: a changed row must be a new object (a
// collection() makes it one), and a row that is the same object is not
// touched, so a change costs the rows it changed and no other.
//
// Non-keyed form (index-based, raw values):
//   list(items, (item, index) => <li>{item}</li>)
//
// Each row is bracketed by <!--row--> / <!--/row--> comment markers, so nodes
// that a when() (or nested list()) at the row's top level inserts beside its
// anchor after render time still move and remove with the row.

// Keyed form. Real overloads (not a union-typed param) so the keyFn's item
// parameter is inferred from T; the bare-arrow form `list(rows, r => r.id, ...)`
// type-checks under strict.
export function list<T>(
  items: ReadonlySignal<readonly T[]>,
  keyFn: (item: T) => string | number,
  render: (row: Row<T>, index: ReadonlySignal<number>, row$: ReadonlySignal<T>) => Node,
): Node;
// Index-based form — render receives raw T.
export function list<T>(
  items: ReadonlySignal<readonly T[]>,
  render: (item: T, index: number) => Node,
): Node;
export function list<T>(
  items: ReadonlySignal<readonly T[]>,
  keyFnOrRender: ((item: T) => string | number) | ((item: T, index: number) => Node),
  maybeRender?: (row: Row<T>, index: ReadonlySignal<number>, row$: ReadonlySignal<T>) => Node,
): Node {
  if (!hasActiveDisposeScope()) warn?.scopeless("list");
  assertOwnSignal(items);
  const hasKeyFn = maybeRender !== undefined;
  const keyFn = hasKeyFn ? keyFnOrRender as (item: T) => string | number : null;

  // A row's node array snapshotted at render time goes stale: a when() (or
  // nested list()) at the row's top level inserts nodes NEXT TO its anchor
  // later (branch changes), and moving just the snapshot
  // would strand them. The bracket range [start..end] is the row's live DOM —
  // it is what reorders move and removals delete.
  type Entry = { start: Comment; end: Comment; dispose: Dispose; item?: Signal<T>; index?: Signal<number> };
  const anchor = document.createComment("list");
  // Anchor goes into the fragment BEFORE the effect runs, so the first sync
  // renders rows synchronously (into the fragment, which the caller appends).
  const frag = document.createDocumentFragment();
  frag.appendChild(anchor);
  const entries = new Map<string | number, Entry>();
  let order: (string | number)[] = [];
  let disposed = false;

  // The row with its brackets: what a move carries and a removal deletes (a
  // rebuild clears only what is between them).
  function rangeOf(entry: Entry): Node[] {
    const nodes: Node[] = [];
    for (let n: Node | null = entry.start; n; n = n.nextSibling) {
      nodes.push(n);
      if (n === entry.end) break;
    }
    return nodes;
  }

  // Dispose a row and remove it, brackets and all.
  function dropEntry(entry: Entry) {
    const range = rangeOf(entry); // snapshot before dispose mutates the row
    entry.dispose();
    for (const n of range) n.parentNode?.removeChild(n);
  }

  // The index-based form's render, run as a render body.
  const renderRow = (item: T, i: number): Node =>
    untrackRender("a list() row", keyFnOrRender, () => (keyFnOrRender as (item: T, index: number) => Node)(item, i));

  function sync() {
    // Same guard as when()'s swap: a disposed list must not rebuild rows. The
    // parent check below doesn't cover an anchor still sitting in a
    // detached-but-parented subtree after a routes()/component teardown.
    if (disposed) return;
    const arr = items.peek(); // the effect below tracked it
    const parent = anchor.parentNode;
    if (!parent) return;

    const newKeys = arr.map((item, i) => keyFn ? keyFn(item) : i);
    const newKeySet = new Set(newKeys);

    // Duplicate keys collapse to one entry in the Map, silently dropping rows.
    if (keyFn && newKeySet.size !== newKeys.length) warn?.duplicateKeys();

    // Remove entries no longer in the list
    for (const key of order) {
      const entry = entries.get(key);
      if (!entry || newKeySet.has(key)) continue;
      dropEntry(entry);
      entries.delete(key);
    }

    // The rows in the longest run already in order stay put (see above).
    const oldPos = new Map(order.map((k, i) => [k, i]));
    const stay = longestIncreasing(newKeys.map((k) => oldPos.get(k) ?? -1));

    // Each row renders under a scope of its own, closed on every path. A row
    // that throws has what it made before the throw disposed and nothing of
    // it placed: a new row is left out, an index-based rebuild left empty
    // between its brackets. The other rows still render, and the first error
    // is rethrown once the list is in place, as a flush does for its effects.
    // A row that disposes the list's owner (a navigation, say) stops the sync:
    // the list's teardown has run, so the row it built is disposed here.
    let thrown: { error: unknown } | undefined;
    const scopedRow = (render: () => Node): { value: Node; dispose: Dispose } | null => {
      let row: { value: Node; dispose: Dispose };
      try {
        // Adoption re-applies props, so its effects belong to the row too.
        row = scoped(() => adoptIntoSvg(render(), parent));
      } catch (error) {
        thrown ??= { error };
        return null;
      }
      if (!disposed) return row;
      row.dispose();
      return null;
    };

    // Add or reorder entries
    let insertBefore: Node = anchor;
    for (let i = newKeys.length - 1; i >= 0 && !disposed; i--) {
      const key = newKeys[i]!;
      let entry = entries.get(key);

      if (!entry) {
        // New item — render between fresh brackets in a detached fragment;
        // the shared move step below inserts the whole range into position.
        const start = document.createComment("row");
        const end = document.createComment("/row");
        let row: { value: Node; dispose: Dispose } | null;
        if (hasKeyFn) {
          const itemSig = signal(arr[i]!);
          const indexSig = signal(i);
          const { row: fields, release } = rowOf(itemSig, false);
          row = scopedRow(() => untrackRender("a list() row", maybeRender!, () => maybeRender!(fields, indexSig, itemSig)));
          if (!row) { // left out: the next sync finds it new
            release();
            continue;
          }
          const rowDispose = row.dispose;
          entry = { start, end, dispose: () => { rowDispose(); release(); }, item: itemSig, index: indexSig };
        } else {
          row = scopedRow(() => renderRow(arr[i]!, i));
          if (!row) continue;
          entry = { start, end, dispose: row.dispose };
        }
        const frag = document.createDocumentFragment();
        frag.appendChild(start);
        frag.appendChild(row.value);
        frag.appendChild(end);
        entries.set(key, entry);
      } else if (hasKeyFn) {
        // Existing keyed item — push new value into its signal
        entry.item!.set(arr[i]!);
        entry.index!.set(i);
      } else {
        // Index-based — dispose the old content and rebuild it between the
        // same brackets, which keeps the row's position without re-inserting.
        const { start, end } = entry;
        entry.dispose();
        clearBetween(start, end);
        const row = scopedRow(() => renderRow(arr[i]!, i));
        entry.dispose = row?.dispose ?? (() => {}); // the old scope is spent: never run it twice
        if (row) end.parentNode?.insertBefore(row.value, end);
      }

      // Move or insert into correct position — the whole bracket range, so
      // nodes a when()/list() inserted beside its anchor travel with the row.
      if (!stay.has(i) && entry.end.nextSibling !== insertBefore) {
        for (const n of rangeOf(entry)) parent.insertBefore(n, insertBefore);
      }
      insertBefore = entry.start;
    }

    // A new row that threw has no entry: the next sync must find it new.
    order = thrown ? newKeys.filter((k) => entries.has(k)) : newKeys;
    if (thrown) throw thrown.error;
  }

  // Registered before the first sync runs, so that if a row throws there
  // (the throw leaves list()), the rows made beside it still go with the scope.
  trackDispose(() => {
    disposed = true;
    for (const entry of entries.values()) dropEntry(entry);
    entries.clear();
  });

  // Only the items are tracked; rows render untracked, so a .get() inside a
  // row doesn't re-run the whole list.
  effect(() => {
    items.get();
    untrack(sync);
  });

  return frag;
}

// The positions of a longest strictly increasing run in `seq`, skipping
// negative entries (rows that are new). Patience sorting, O(n log n).
function longestIncreasing(seq: number[]): Set<number> {
  const tails: number[] = []; // tails[k]: position ending the best run of length k+1
  const prev: number[] = [];
  for (let i = 0; i < seq.length; i++) {
    const v = seq[i]!;
    if (v < 0) continue;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]!]! < v) lo = mid + 1;
      else hi = mid;
    }
    prev[i] = lo > 0 ? tails[lo - 1]! : -1;
    tails[lo] = i;
  }
  const run = new Set<number>();
  for (let i = tails.length ? tails[tails.length - 1]! : -1; i >= 0; i = prev[i]!) run.add(i);
  return run;
}

// === Intrinsic element props ===
//
// Each tag's props come from the DOM's own element type (HTMLElementTagNameMap),
// in the spelling railroad applies them: an attribute is the element property
// lowercased, as HTML writes it (`tabindex`, `readonly`, `colspan`), with
// `class`/`className`, `for`/`htmlFor` and the few the DOM names otherwise,
// and any attribute with a hyphen (`data-*`, `aria-*`, a library's `hx-get`);
// each value static, a Signal, or a function (reactive). A handler is one of
// the element's own `on*` properties, or an event in its event map that has
// none (focusin, focusout, composition*), lowercase, a function of its event
// with `currentTarget` typed. So a typo, or React's `onClick`, doesn't compile.
// SVG's element types don't name their attributes (presentation attributes
// aren't properties), so an SVG tag, like a custom element, takes any
// attribute, with typed refs and handlers.

type AttrValue = string | number | boolean | null | undefined;
type Reactive<T> = T | ReadonlySignal<T> | (() => T);
type StyleValue = string | { [property: string]: string | number | null | undefined } | false | null | undefined;

// Where the attribute isn't the property lowercased.
interface Renamed {
  className: "class";
  htmlFor: "for";
  httpEquiv: "http-equiv";
  acceptCharset: "accept-charset";
  popoverTargetElement: "popovertarget";
  commandForElement: "commandfor";
}
// Properties that aren't attributes: the node tree, and what railroad sets itself.
type NotAttribute = keyof Node | keyof ParentNode | keyof ChildNode | "style" | "innerHTML" | "outerHTML";

type AttributeProps<E> = {
  -readonly [K in keyof E as K extends NotAttribute | `on${string}` ? never
    : E[K] extends (...args: never[]) => unknown ? never
    : K extends keyof Renamed ? Renamed[K]
    : K extends string ? string extends K ? never : Lowercase<K> // not a form's [name: string]
    : never]?: Reactive<AttrValue>;
};

type Handler<Ev, E> = ((ev: Ev & { currentTarget: E }) => void) | null | undefined;
// TypeScript 5's DOM types `input` as Event, but a text control or
// contenteditable sends an InputEvent (a <select> doesn't), so
// `(e: InputEvent) => …` is the handler people write. TypeScript 7's DOM types
// every `oninput` as InputEvent, a <select>'s too, and this agrees with it.
type EventOf<K, Ev, E> = K extends "oninput" ? (E extends HTMLSelectElement ? Ev : InputEvent) : Ev;

// The element's own on* properties (NonNullable: some, like ontouchstart, are
// optional), then the events in its map that have no property.
type HandlerProps<E, Events> = {
  -readonly [K in keyof E as K extends `on${string}` ? K : never]?:
    NonNullable<E[K]> extends (this: never, ev: infer Ev) => unknown ? Handler<EventOf<K, Ev, E>, E> : never;
} & {
  -readonly [K in keyof Events & string as `on${K}` extends keyof E ? never : `on${K}`]?: Handler<Events[K], E>;
};

interface CommonProps<E> {
  // jsx: react-jsx passes children as a prop; what a child may be isn't typed here
  children?: unknown;
  class?: Reactive<AttrValue>;
  className?: Reactive<AttrValue>;
  style?: Reactive<StyleValue>;
  innerHTML?: Reactive<string | null | undefined>;
  ref?: (el: E) => void;
  // global attributes with no element property
  itemid?: Reactive<AttrValue>;
  itemprop?: Reactive<AttrValue>;
  itemref?: Reactive<AttrValue>;
  itemscope?: Reactive<AttrValue>;
  itemtype?: Reactive<AttrValue>;
  // data-*, aria-*, and any other attribute with a hyphen (never React's casing)
  [hyphenated: `${string}-${string}`]: Reactive<AttrValue>;
}

type HtmlProps<E> = AttributeProps<E> & HandlerProps<E, HTMLElementEventMap> & CommonProps<E> &
  (E extends { htmlFor: unknown } ? { htmlFor?: Reactive<AttrValue> } : unknown);
type AnyAttributeProps<E, Events> = HandlerProps<E, Events> & CommonProps<E> & { [attribute: string]: unknown };

type HtmlTags = { [K in keyof HTMLElementTagNameMap]: HtmlProps<HTMLElementTagNameMap[K]> };
// a, script, style and title are HTML's here: created as HTML, adopted inside <svg>
type SvgTags = {
  [K in Exclude<keyof SVGElementTagNameMap, keyof HTMLElementTagNameMap>]:
    AnyAttributeProps<SVGElementTagNameMap[K], SVGElementEventMap>;
};

// === JSX namespace for TypeScript ===
//
// No global JSX: a global one clashes with React's in a mixed app (TS2300
// Duplicate identifier 'Element'). Each JSX mode finds these types without it:
//   jsx: react (jsxFactory createElement) — TypeScript looks the namespace up
//     on the factory, createElement.JSX, before any global;
//   jsx: react-jsx (jsxImportSource) — the JSX that jsx-runtime.ts exports.
// To annotate, import it: `import type { JSX } from "@blueshed/railroad"`.

export declare namespace createElement {
  export namespace JSX {
    export type Element = globalThis.Node;
    // A component returns a Node, synchronously: an async one doesn't compile.
    export type ElementType = string | ((props: any) => globalThis.Node);
    /** Every HTML and SVG tag, typed from the DOM's element types; a custom
     *  element (a name with a hyphen) takes any attribute. */
    export interface IntrinsicElements extends HtmlTags, SvgTags {
      [customElement: `${string}-${string}`]: AnyAttributeProps<HTMLElement, HTMLElementEventMap>;
    }
  }
}

/** Railroad's JSX types, the same ones `createElement.JSX` holds:
 *  `import type { JSX } from "@blueshed/railroad"`. */
export declare namespace JSX {
  export type Element = createElement.JSX.Element;
  export type ElementType = createElement.JSX.ElementType;
  export interface IntrinsicElements extends createElement.JSX.IntrinsicElements {}
}
