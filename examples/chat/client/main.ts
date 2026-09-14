// This example's client entry point: register its own applets first, then
// boot the kernel's generic client. The kernel's app.ts only knows the
// generic mount contract ([data-applet], data-write) -- it has no idea
// room-picker exists, so registering it is this example's job, not the
// kernel's.
import "../applets/room-picker";
import "../../../src/client/app";
