// Shared test entry point for client-side logic that needs a real DOM but
// not app.ts's side effects (a #app element, a live websocket): morph and
// small helpers like formValue. No applet is registered here -- every real
// applet belongs to an example, not the kernel (see
// the chat example's own morph-applet test for one that mounts a real applet
// against this same morph.ts).
import { formValue } from "./form-value";
import { morph, morphElement, morphTag } from "./morph";

declare global {
  interface Window {
    morph: typeof morph;
    morphElement: typeof morphElement;
    morphTag: typeof morphTag;
    formValue: typeof formValue;
  }
}

window.morph = morph;
window.morphElement = morphElement;
window.morphTag = morphTag;
window.formValue = formValue;
