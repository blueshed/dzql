// Test entry point for two of this example's applets whose mount/update logic isn't reached by
// client/app.test.ts's real-browser flows: photo's update() diffing (arriving/descend) needs
// props changes app.test.ts never triggers, and picture-field needs a fake /api/picture rather
// than the couple's real one. Registers them directly, the same way morph-applet.test.ts does
// for chat's room-picker, without the kernel needing to know either exists.
import { applets } from "../../../src/applets";
import "../applets/photo";
import "../applets/picture-field";

declare global {
  interface Window {
    applets: typeof applets;
  }
}

window.applets = applets;
