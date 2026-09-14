export type AppletContext = {
  props: unknown;
  send: (name: string, payload?: Record<string, unknown>) => void;
};

export type Applet = {
  mount(el: HTMLElement, ctx: AppletContext): void | (() => void);
};

export const applets: Record<string, Applet> = {};

export function registerApplet(name: string, applet: Applet): void {
  applets[name] = applet;
}
