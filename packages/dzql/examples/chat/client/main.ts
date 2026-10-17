// This example's client entry point: chat has no applets of its own -- every reading is the
// server's HTML -- so this is the kernel's generic client, and its writes as tools for an
// assistant in the browser (src/client/tools.ts), which an app opts into.
import "dzql/rendering/client/app";
import "dzql/rendering/client/tools";
