// Test entry point for what the ticker's pages never ask of its applets, the kernel's contract all
// the same: a board row given new props by a render, and a clock given a zone by one, then taken
// off the page. Registers them directly, as the wedding's applets test does.
import { applets } from "dzql/rendering/applets";
import "../applets/board-applet";
import "../applets/clock-applet";

declare global {
  interface Window {
    applets: typeof applets;
  }
}

window.applets = applets;
