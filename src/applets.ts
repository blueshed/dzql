import type { PatchOp } from "./json-patch";

export type AppletContext = {
  props: unknown;
  send: (doc: string, ops: PatchOp[]) => void;
};

export type Applet = {
  mount(el: HTMLElement, ctx: AppletContext): void | (() => void);
  /** Called instead of a remount when a mounted applet's element survives a render but its data-props changed. */
  update?(el: HTMLElement, props: unknown): void;
  /**
   * Called with a document's applied ops as they are echoed, for an applet whose element names
   * that document in `data-doc`. The applet's props are a subtree of the document; this keeps
   * them current from the same ops the ledger recorded, with no HTML sent -- the delta itself is
   * the update (a price tick, a cursor moving). The server's compartment answers `fragments` with `[]`
   * for such a page, so nothing follows the patch.
   */
  patch?(el: HTMLElement, ops: PatchOp[]): void;
};

export const applets: Record<string, Applet> = {};

export function registerApplet(name: string, applet: Applet): void {
  applets[name] = applet;
}
