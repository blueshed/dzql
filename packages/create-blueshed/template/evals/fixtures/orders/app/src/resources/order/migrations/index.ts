// Made by `delta migrations make`: this folder's migrations, in order, as an import a bundle carries
// (`await migrate(db, migrations, ...)`). Never edited by hand: `make` writes it again.
import * as m001_order from "./001-order";

export const migrations = [
  { id: "001-order", ...m001_order },
];
