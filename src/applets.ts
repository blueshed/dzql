import type { PatchOp } from "./json-patch";

export type AppletContext = {
  props: unknown;
  send: (doc: string, ops: PatchOp[]) => void;
};

export type Applet = {
  mount(el: HTMLElement, ctx: AppletContext): void | (() => void);
  /** Called instead of a remount when a mounted applet's element survives a render but its data-props changed. */
  update?(el: HTMLElement, props: unknown): void;
};

export const applets: Record<string, Applet> = {};

export function registerApplet(name: string, applet: Applet): void {
  applets[name] = applet;
}
