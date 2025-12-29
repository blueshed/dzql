import { describe, test, expect, beforeEach } from "bun:test";
import { ref, isRef, isReactive, nextTick, watch } from "vue";
import { createPinia, setActivePinia, defineStore } from "pinia";
import { generateSubscribableStore } from "../src/cli/codegen/subscribable_store.js";
import { generateManifest } from "../src/cli/codegen/manifest.js";
import { generateIR } from "../src/cli/compiler/ir.js";
import { entities, subscribables } from "../examples/venues.js";

// Mock WebSocket manager
const mockWs = {
  api: {
    subscribe_venue_detail: (params: any, callback: (data: any) => void) => {
      // Simulate async subscription response
      setTimeout(() => {
        callback({
          id: 1,
          name: "Test Venue",
          sites: [
            { id: 1, name: "Site A", allocations: [] },
            { id: 2, name: "Site B", allocations: [] }
          ]
        });
      }, 10);
    }
  },
  registerStore: (listener: (event: any) => void) => {
    // Store the listener so tests can dispatch events
    mockWs._storeListener = listener;
    return () => {};
  },
  _storeListener: null as ((event: any) => void) | null,
  dispatchEvent: (event: any) => {
    if (mockWs._storeListener) {
      mockWs._storeListener(event);
    }
  }
};

describe("Subscribable Store Reactivity", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockWs._storeListener = null;
  });

  test("generated store code structure is correct", () => {
    const ir = generateIR({ entities, subscribables });
    const manifest = generateManifest(ir);
    const code = generateSubscribableStore(manifest, "venue_detail");

    // Should use ref({}) for documents
    expect(code).toContain("const documents = ref({});");

    // Should add plain object with empty data object to documents.value (preserves reactivity)
    expect(code).toContain("documents.value[key] = { data: {}, loading: true, ready };");

    // Should merge initial data into existing object via Object.assign (preserves reactivity)
    expect(code).toContain("Object.assign(documents.value[key].data, eventData);");
    expect(code).toContain("documents.value[key].loading = false;");

    // Should have unbind function
    expect(code).toContain("function unbind(params)");

    // Should NOT pre-wrap in ref()
    expect(code).not.toContain("const docState = ref(");
    expect(code).not.toContain("const loading = ref(");
  });

  test("documents.value entries become reactive when added as plain objects", async () => {
    // Simulate what the generated store does
    const documents = ref<Record<string, any>>({});

    // Add a plain object - Vue should make it reactive
    documents.value["test-key"] = { data: null, loading: true };

    // The entry should be reactive
    expect(isReactive(documents.value["test-key"])).toBe(true);

    // Assign data
    documents.value["test-key"].data = { id: 1, name: "Test" };
    documents.value["test-key"].loading = false;

    // Data should also be reactive
    expect(isReactive(documents.value["test-key"].data)).toBe(true);
  });

  test("mutations to document data trigger reactivity", async () => {
    const documents = ref<Record<string, any>>({});

    // Setup
    documents.value["key1"] = {
      data: { id: 1, name: "Original", items: [{ id: 1, value: "a" }] },
      loading: false
    };

    let changeCount = 0;

    // Watch for changes
    watch(
      () => documents.value["key1"]?.data?.name,
      () => { changeCount++; },
      { flush: 'sync' }
    );

    // Mutate via Object.assign (like applyPatch does)
    Object.assign(documents.value["key1"].data, { name: "Updated" });

    expect(changeCount).toBe(1);
    expect(documents.value["key1"].data.name).toBe("Updated");
  });

  test("array mutations trigger reactivity", async () => {
    const documents = ref<Record<string, any>>({});

    documents.value["key1"] = {
      data: {
        id: 1,
        sites: [
          { id: 1, name: "Site A" },
          { id: 2, name: "Site B" }
        ]
      },
      loading: false
    };

    let changeCount = 0;

    watch(
      () => documents.value["key1"]?.data?.sites?.length,
      () => { changeCount++; },
      { flush: 'sync' }
    );

    // Insert (push)
    documents.value["key1"].data.sites.push({ id: 3, name: "Site C" });
    expect(changeCount).toBe(1);
    expect(documents.value["key1"].data.sites.length).toBe(3);

    // Delete (splice)
    documents.value["key1"].data.sites.splice(0, 1);
    expect(changeCount).toBe(2);
    expect(documents.value["key1"].data.sites.length).toBe(2);
  });

  test("Object.assign on array items triggers reactivity", async () => {
    const documents = ref<Record<string, any>>({});

    documents.value["key1"] = {
      data: {
        sites: [{ id: 1, name: "Original" }]
      },
      loading: false
    };

    let changeCount = 0;

    watch(
      () => documents.value["key1"]?.data?.sites?.[0]?.name,
      () => { changeCount++; },
      { flush: 'sync' }
    );

    // Update via Object.assign (like handleArrayPatch does)
    Object.assign(documents.value["key1"].data.sites[0], { name: "Updated" });

    expect(changeCount).toBe(1);
    expect(documents.value["key1"].data.sites[0].name).toBe("Updated");
  });

  test("applyPatch simulation works with reactivity", async () => {
    const documents = ref<Record<string, any>>({});

    // Simulate bind() adding the document
    documents.value["venue-1"] = {
      data: {
        id: 1,
        name: "Test Venue",
        sites: [
          { id: 1, name: "Site A", allocations: [] }
        ]
      },
      loading: false
    };

    // Simulate applyPatch for root entity update
    function applyPatch(doc: any, event: any) {
      if (!doc) return;
      switch (event.table) {
        case 'venues':
          if (event.op === 'update') Object.assign(doc, event.data);
          break;
        case 'sites':
          handleArrayPatch(doc.sites, event);
          break;
      }
    }

    function handleArrayPatch(arr: any[], event: any) {
      if (!arr) return;
      const pkValue = event.pk?.id;
      const idx = arr.findIndex(i => i.id === pkValue);
      if (event.op === 'insert') {
        if (idx === -1) arr.push(event.data);
      } else if (event.op === 'update') {
        if (idx !== -1) Object.assign(arr[idx], event.data);
      } else if (event.op === 'delete') {
        if (idx !== -1) arr.splice(idx, 1);
      }
    }

    let venueNameChanges = 0;
    let sitesLengthChanges = 0;

    watch(
      () => documents.value["venue-1"]?.data?.name,
      () => { venueNameChanges++; },
      { flush: 'sync' }
    );

    watch(
      () => documents.value["venue-1"]?.data?.sites?.length,
      () => { sitesLengthChanges++; },
      { flush: 'sync' }
    );

    // Test root entity update
    applyPatch(documents.value["venue-1"].data, {
      table: 'venues',
      op: 'update',
      data: { name: "Updated Venue" },
      pk: { id: 1 }
    });

    expect(venueNameChanges).toBe(1);
    expect(documents.value["venue-1"].data.name).toBe("Updated Venue");

    // Test insert into nested array
    applyPatch(documents.value["venue-1"].data, {
      table: 'sites',
      op: 'insert',
      data: { id: 2, name: "Site B", allocations: [] },
      pk: { id: 2 }
    });

    expect(sitesLengthChanges).toBe(1);
    expect(documents.value["venue-1"].data.sites.length).toBe(2);

    // Test delete from nested array
    applyPatch(documents.value["venue-1"].data, {
      table: 'sites',
      op: 'delete',
      data: { id: 1 },
      pk: { id: 1 }
    });

    expect(sitesLengthChanges).toBe(2);
    expect(documents.value["venue-1"].data.sites.length).toBe(1);
  });
});
