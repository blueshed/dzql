// dzql/rendering: pages the server draws, morphed into the browser, and the documents they read
// through delta. Each module is also its own entry (`dzql/rendering/<module>`): an applet drawn
// with railroad (`dzql/rendering/applet`) is the one that needs @blueshed/railroad, so it is not exported here, nor is `db` (opening it opens the file DB_PATH names).
export * from "./server";
export * from "./example";
export * from "./resources/index";
export * from "./resources/resource";
export * from "./documents";
export * from "./bento";
export * from "./derive";
export * from "./grid";
export * from "./html";
export * from "./parts";
export * from "./json-patch";
export * from "./refusal";
export * from "./icons";
export * from "./names";
