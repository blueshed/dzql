// Shared test entry point for client-side logic that needs a real DOM but
// not app.ts's side effects (a #app element, a live websocket): morph and
// small helpers like formValue. No applet is registered here -- every real
// applet belongs to an example, not the kernel (see
// the chat example's own morph-applet test for one that mounts a real applet
// against this same morph.ts).
import { formValue } from "./form-value";
import { morph } from "./morph";

declare global {
  interface Window {
    morph: typeof morph;
    formValue: typeof formValue;
  }
}

window.morph = morph;
window.formValue = formValue;
