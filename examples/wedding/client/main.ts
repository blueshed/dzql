// This example's client entry point: register its own applets first, then boot the kernel's
// generic client. The kernel's app.ts only knows the generic mount contract ([data-applet],
// data-write) -- it has no idea a photo or a dressing sheet exists, so registering them is this
// example's job, not the kernel's.
import "../applets/photo";
import "../applets/dress";
import "../applets/menu";
import "../applets/picture-field";
import "../../../src/client/app";
