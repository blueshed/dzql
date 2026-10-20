// Made by `delta migrations make`: this folder's migrations, in order, as an import a bundle carries
// (`await migrate(db, migrations, ...)`). Never edited by hand: `make` writes it again.
import * as m001_lists from "./001-lists";
import * as m002_title from "./002-title";

export const migrations = [
  { id: "001-lists", ...m001_lists },
  { id: "002-title", ...m002_title },
];
