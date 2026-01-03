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
  test("should generate a Pinia store with basic CRUD and broadcast handlers", () => {
    const piniaCode = generatePiniaStore(mockManifest, "posts");

    // Check TypeScript imports
    expect(piniaCode).toContain("import { defineStore } from 'pinia'");
    expect(piniaCode).toContain("import { ref, type Ref } from 'vue'");
    expect(piniaCode).toContain("import { ws } from '../../client.js';");

    // Check type definitions
    expect(piniaCode).toContain("export interface Posts {");

    // Check store definition
    expect(piniaCode).toContain("export const usePostsStore = defineStore('posts-store', () => {");

    // Check typed CRUD methods
    expect(piniaCode).toContain("async function get(id: number): Promise<Posts | null>");
    expect(piniaCode).toContain("async function save(data: Partial<Posts>): Promise<Posts>");
    expect(piniaCode).toContain("async function remove(id: number): Promise<Posts>");
    expect(piniaCode).toContain("async function search(query:");

    // Check table_changed handler (called by global dispatcher)
    expect(piniaCode).toContain("function table_changed(table: string, op: string, pk: Record<string, unknown>, data:");
    expect(piniaCode).toContain("if (table !== 'posts') return;");
  });
});
