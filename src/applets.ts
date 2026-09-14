import type { PatchOp } from "./json-patch";

export type AppletContext = {
  props: unknown;
  send: (doc: string, ops: PatchOp[]) => void;
};

export type Applet = {
  mount(el: HTMLElement, ctx: AppletContext): void | (() => void);
};

export const applets: Record<string, Applet> = {};

export function registerApplet(name: string, applet: Applet): void {
  applets[name] = applet;
}
