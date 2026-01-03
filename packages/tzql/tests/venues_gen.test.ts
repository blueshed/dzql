import { describe, test, expect } from "bun:test";
import { generatePiniaStore } from "../src/cli/codegen/pinia.js";
import { generateManifest } from "../src/cli/codegen/manifest.js";
import { generateIR } from "../src/cli/compiler/ir.js";
import { entities, subscribables } from "../examples/venues.js";

const venuesDomain = { entities, subscribables };

describe("Venues Store Generation", () => {
  test("should generate venues store", () => {
    const ir = generateIR(venuesDomain);
    const manifest = generateManifest(ir);

    // Generate the store for the 'venues' entity
    const code = generatePiniaStore(manifest, "venues");

    console.log("--- GENERATED VENUES STORE ---");
    console.log(code);
    console.log("------------------------------");

    expect(code).toContain("useVenuesStore");
    expect(code).toContain("ws.api.save_venues");
    expect(code).toContain("function table_changed(table: string, op: string,");
    expect(code).toContain("if (table !== 'venues') return;");
  });
});
