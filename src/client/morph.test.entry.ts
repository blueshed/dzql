// Shared test entry point for client-side logic that needs a real DOM but
// not app.ts's side effects (a #app element, a live websocket): morph,
// applets, and small helpers like formValue.
import { applets } from "../applets";
import "../applets/room-picker";
import { formValue } from "./form-value";
import { morph } from "./morph";

declare global {
  interface Window {
    morph: typeof morph;
    applets: typeof applets;
    formValue: typeof formValue;
  }
}

window.morph = morph;
window.applets = applets;
window.formValue = formValue;
