import { describe, test, expect } from "bun:test";
import { generatePiniaStore } from "../src/cli/codegen/pinia.js";
import { generateManifest } from "../src/cli/codegen/manifest.js";
import { generateIR } from "../src/cli/compiler/ir.js";

// Use domain config format (with schema), not IR format
const mockDomainConfig = {
    entities: {
        posts: {
            schema: {
                id: "serial primary key",
                title: "text"
            },
            permissions: { create: [], view: [], update: [], delete: [] }
        }
    },
    subscribables: {}
};

const mockManifest = generateManifest(generateIR(mockDomainConfig));

describe("Pinia Store Generation", () => {
  test("should generate a Pinia store with basic CRUD and table_changed", () => {
    const piniaCode = generatePiniaStore(mockManifest, "posts");

    // Check TypeScript imports
    expect(piniaCode).toContain("import { defineStore } from 'pinia'");
    expect(piniaCode).toContain("import { ref, type Ref } from 'vue'");
    expect(piniaCode).toContain("import { ws } from '../../client.js';");

    // Check type definitions
    expect(piniaCode).toContain("export interface Posts {");
    expect(piniaCode).toContain("export interface TableChangedPayload {");

    // Check store definition
    expect(piniaCode).toContain("export const usePostsStore = defineStore('posts-store', () => {");

    // Check typed CRUD methods
    expect(piniaCode).toContain("async function get(id: number): Promise<Posts | null>");
    expect(piniaCode).toContain("async function save(data: Partial<Posts>): Promise<Posts>");
    expect(piniaCode).toContain("async function remove(id: number): Promise<Posts>");
    expect(piniaCode).toContain("async function search(query:");

    // Check table_changed handler
    expect(piniaCode).toContain("function table_changed(payload: TableChangedPayload): void");
    expect(piniaCode).toContain("if (payload.table === 'posts')");
  });
});
