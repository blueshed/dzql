// Made by `delta migrations make`: this folder's migrations, in order, as an import a bundle carries
// (`await migrate(db, migrations, ...)`). Never edited by hand: `make` writes it again.
import * as m001_people from "./001-people";

export const migrations = [
  { id: "001-people", ...m001_people },
];
