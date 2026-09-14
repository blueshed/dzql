import { applets } from "../applets";
import "../applets/room-picker";
import { morph } from "./morph";

declare global {
  interface Window {
    morph: typeof morph;
    applets: typeof applets;
  }
}

window.morph = morph;
window.applets = applets;
