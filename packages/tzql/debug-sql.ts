
import { generateIR } from "./src/cli/compiler/ir.js";
import { generateEntitySQL } from "./src/cli/codegen/sql/index.js";
import { generateSubscribableSQL } from "./src/cli/codegen/subscribable_sql.js";
import { entities, subscribables } from "./examples/venues.js";

// 1. Generate IR
const ir = generateIR({ entities, subscribables });

// 2. Generate SQL for 'venues' entity
console.log("\n=== VENUES ENTITY SQL ===\n");
const venuesIR = ir.entities['venues'];
console.log(generateEntitySQL('venues', venuesIR));

// 3. Generate SQL for 'venue_detail' subscribable
console.log("\n=== VENUE DETAIL SUBSCRIBABLE SQL ===\n");
const venueDetailIR = ir.subscribables['venue_detail'];
console.log(generateSubscribableSQL('venue_detail', venueDetailIR, ir.entities));
