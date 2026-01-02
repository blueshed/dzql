import { describe, test, expect } from "bun:test";
import { generateSubscribableStore } from "../src/cli/codegen/subscribable_store.js";
import { generateSubscribableSQL } from "../src/cli/codegen/subscribable_sql.js";
import { generateManifest } from "../src/cli/codegen/manifest.js";
import { generateIR } from "../src/cli/compiler/ir.js";
import { entities, subscribables } from "../examples/venues.js";

const venuesDomain = { entities, subscribables };

describe("Subscribable Store Generation", () => {
  test("should generate venue_detail store with deep graph patching", () => {
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
    // Check for nested table handling
    expect(code).toContain("case 'sites':");
    expect(code).toContain("case 'allocations':");
    // Check for parent lookup logic with type annotation
    expect(code).toContain("const parent = (doc.sites as any[])?.find");
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
    // Check that bind awaits ready
    expect(code).toContain("await ready");
    // Check that plain object with empty data is stored (preserves reactivity on merge)
    expect(code).toContain("{ data: {}, loading: true, ready }");
    // Check initial data is merged via Object.assign to preserve reactivity
    expect(code).toContain("Object.assign(documents.value[key].data, eventData");
    // Check existing subscription handling waits for ready
    expect(code).toContain("await existing.ready");
    // Check unbind function exists with typed params
    expect(code).toContain("function unbind(params: VenueDetailParams)");
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
});
