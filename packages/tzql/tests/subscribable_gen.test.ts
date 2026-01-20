import { describe, test, expect } from "bun:test";
import { generateSubscribableStore } from "../src/cli/codegen/subscribable_store.js";
import { generateSubscribableSQL } from "../src/cli/codegen/subscribable_sql.js";
import { generateManifest } from "../src/cli/codegen/manifest.js";
import { generateIR } from "../src/cli/compiler/ir.js";
import { entities, subscribables } from "../examples/venues.js";

const venuesDomain = { entities, subscribables };

describe("Subscribable Store Generation", () => {
  test("should generate venue_detail store with subscription handling", () => {
    const ir = generateIR(venuesDomain);
    const manifest = generateManifest(ir);

    // Generate the store for the 'venue_detail' subscribable
    const code = generateSubscribableStore(manifest, "venue_detail");

    console.log("--- GENERATED VENUE DETAIL STORE ---");
    console.log(code);
    console.log("------------------------------------");

    expect(code).toContain("useVenueDetailStore");
    // Check for TypeScript interface
    expect(code).toContain("export interface VenueDetailParams");
    // Check for bind/unbind functions
    expect(code).toContain("async function bind(params: VenueDetailParams)");
    expect(code).toContain("function unbind(params: VenueDetailParams)");
    // Check for subscribe call (registers interest, updates come via table_changed)
    expect(code).toContain("ws.call('subscribe_venue_detail', params)");
    // Check for table_changed handler
    expect(code).toContain("function table_changed(table: string, op: string,");
  });

  test("should generate async bind function that awaits first data", () => {
    const ir = generateIR(venuesDomain);
    const manifest = generateManifest(ir);

    const code = generateSubscribableStore(manifest, "venue_detail");

    // Check that bind is async with typed params
    expect(code).toContain("async function bind(params: VenueDetailParams)");
    // Check for Promise-based ready signal
    expect(code).toContain("const ready = new Promise<void>");
    expect(code).toContain("resolveReady()");
    // Check that plain object with empty data is stored (preserves reactivity on merge)
    expect(code).toContain("{ data: {}, loading: true, ready }");
    // Check initial data is merged via Object.assign to preserve reactivity (unwraps data from envelope)
    expect(code).toContain("Object.assign(documents.value[key].data, result.data)");
    // Check existing subscription handling waits for ready
    expect(code).toContain("await existing.ready");
    // Check unbind function exists with typed params
    expect(code).toContain("function unbind(params: VenueDetailParams)");
    // Check scope tables and path mappings are generated
    expect(code).toContain("SCOPE_TABLES");
    expect(code).toContain("PATH_MAPPINGS");
  });

  test("should generate flat SQL structure for nested includes", () => {
    const ir = generateIR(venuesDomain);
    const sub = ir.subscribables.venue_detail;

    const sql = generateSubscribableSQL("venue_detail", sub, ir.entities);

    console.log("--- GENERATED SQL ---");
    console.log(sql);
    console.log("---------------------");

    // Check that nested includes use jsonb concatenation (||) for flat structure
    // This merges entity fields with nested arrays into one flat object
    // Uses to_jsonb() (not row_to_json) for type compatibility with || operator
    expect(sql).toContain("to_jsonb(rel.*) || jsonb_build_object(");
    // The allocations are nested inside the flat sites object
    expect(sql).toContain("'allocations', COALESCE((");
  });

  test("should generate SQL for list subscribable (no root key)", () => {
    // List subscribable: returns filtered array, no specific entity lookup
    const listDomain = {
      entities: {
        venues: {
          schema: {
            id: 'serial PRIMARY KEY',
            org_id: 'int NOT NULL',
            name: 'text NOT NULL'
          }
        },
        acts_for: {
          schema: {
            user_id: 'int NOT NULL',
            org_id: 'int NOT NULL',
            active: 'boolean DEFAULT true'
          },
          primaryKey: ['user_id', 'org_id']
        }
      },
      subscribables: {
        my_venues: {
          params: {},  // No params
          root: {
            entity: 'venues'
            // NO KEY - this is a list subscribable
          },
          includes: {},
          scopeTables: ['venues'],
          canSubscribe: []  // Authenticated users only
        }
      }
    };

    const ir = generateIR(listDomain);
    const sub = ir.subscribables.my_venues;

    // This should NOT throw - list subscribables are valid
    const sql = generateSubscribableSQL("my_venues", sub, ir.entities);

    console.log("--- GENERATED LIST SQL ---");
    console.log(sql);
    console.log("--------------------------");

    // Check it generates valid SQL for list subscribables
    expect(sql).toContain("get_my_venues");
    expect(sql).toContain("my_venues_can_subscribe");
    // List subscribable returns array, not single object
    expect(sql).toContain("jsonb_agg");
  });
});
