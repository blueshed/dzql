// Test entry point for what this example's real-browser flows (client/app.test.ts) never ask of its
// applets: photo's update() diffing (arriving/descend) needs props changes app.test.ts never
// triggers; picture-field needs a fake /api/picture rather than the couple's real one, and
// `downsized` a photograph bigger than a screen; and the keyboard on a figure or a part of the
// dress. Registers them directly, without the kernel needing to know any exists.
import { applets } from "dzql/rendering/applets";
import "../applets/dress-applet";
import "../applets/photo-applet";
import { downsized } from "../applets/picture-field";

declare global {
  interface Window {
    applets: typeof applets;
    downsized: typeof downsized;
  }
}

window.applets = applets;
window.downsized = downsized;
