// Test entry point for this example's own applet(s) mounted against the
// kernel's morph.ts -- proves room-picker's update() survives a morph the
// same way the kernel's own generic morph tests do, without the kernel
// needing to know room-picker exists.
import { applets } from "../../../src/applets";
import "../applets/room-picker"; // registers itself into the kernel's registry
import { morph } from "../../../src/client/morph";

declare global {
  interface Window {
    morph: typeof morph;
    applets: typeof applets;
  }
}

window.morph = morph;
window.applets = applets;
