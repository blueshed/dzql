// Test entry point for app.ts in a real browser, without any example: loads it exactly as a
// browser would (`client/main.ts` always imports this kernel entry last). app.ts connects a
// WebSocket on load; app.test.ts's fixture server accepts the upgrade and does nothing with it,
// then drives the client by replacing `window.eta.socket().send` and dispatching synthetic
// "message" events on that same socket -- app.ts itself needs no test-only seam for this.
//
// Two applets first, as an example's main.ts registers its own: `tally`, which draws from its props
// alone -- who is looking, and the total of the document it watches, derived -- and `ops`, which
// takes its document's ops itself (`patch`). Each notes on `window.__applets` what it was given.
import { registerApplet } from "../../../src/rendering/applets";

type Rows = Record<string, { n: number }>;
type Given = { mounts: unknown[]; updates: unknown[]; patches: unknown[] };

declare global {
  interface Window {
    __applets: Record<string, Given>;
  }
}

window.__applets = {};
const given = (el: HTMLElement): Given => (window.__applets[el.id] ??= { mounts: [], updates: [], patches: [] });

/** What the tally shows: pure, from its props -- the document at `rows`, or the props themselves when they are the document. */
const tally = (p: { me?: string; rows?: Rows | { n: number }[] } & Rows): string => {
  const rows = p.rows ?? p;
  const total = Object.values(rows).reduce((n, r) => n + (typeof r === "object" ? r.n : 0), 0);
  return p.me === undefined ? String(total) : `${p.me}: ${total}`;
};

registerApplet("tally", {
  mount(el, ctx) {
    given(el).mounts.push(ctx.props);
    el.textContent = tally(ctx.props as never);
  },
  update(el, props) {
    given(el).updates.push(props);
    el.textContent = tally(props as never);
  },
});

registerApplet("ops", {
  mount(el, ctx) {
    given(el).mounts.push(ctx.props);
  },
  update(el, props) {
    given(el).updates.push(props);
  },
  patch(el, ops) {
    given(el).patches.push(ops);
  },
});

await import("../../../src/rendering/client/app");
