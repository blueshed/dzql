import type { PatchOp } from "./json-patch";

export type AppletContext = {
  props: unknown;
  send: (doc: string, ops: PatchOp[]) => void;
};

export type Applet = {
  mount(el: HTMLElement, ctx: AppletContext): void | (() => void);
  /**
   * Called with the applet's props anew, instead of a remount: when its element survives a render
   * with other `data-props`; and, for an applet that watches a document (`data-doc`, given by
   * `appletProps` in src/html.ts), when a patch to it is told -- the ops laid on the props it holds,
   * at `data-under`, by the kernel's client. So an applet draws from its props, whichever brought
   * them, with the pure function the server draws its first paint with.
   */
  update?(el: HTMLElement, props: unknown): void;
  /**
   * Called instead of `update` with a watched document's ops as they are told, for an applet that
   * takes them itself (the ticker's sparkline keeps each tick). The delta itself is the update, with
   * no HTML sent: the watched document is left out when the page is compared (src/parts.ts).
   */
  patch?(el: HTMLElement, ops: PatchOp[]): void;
};

export const applets: Record<string, Applet> = {};

export function registerApplet(name: string, applet: Applet): void {
  applets[name] = applet;
}
