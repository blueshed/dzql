import { describe, test, expect } from "bun:test";
import { generatePiniaStore } from "../src/cli/codegen/pinia.js";
import { generateManifest } from "../src/cli/codegen/manifest.js";
import { generateIR } from "../src/cli/compiler/ir.js";

const mockManifest = generateManifest(generateIR({
    entities: { 
        posts: { 
            name: "posts",
            table: "posts",
            primaryKey: ["id"],
            columns: [{ name: "id", type: "serial primary key" }, { name: "title", type: "text" }],
            permissions: { create: [], view: [], update: [], delete: [] } 
        } 
    },
    subscribables: {}
}));

describe("Pinia Store Generation", () => {
  test("should generate a Pinia store with basic CRUD and table_changed", () => {
    const piniaCode = generatePiniaStore(mockManifest, "posts");
    
    expect(piniaCode).toContain("import { defineStore } from 'pinia'");
    expect(piniaCode).toContain("import { ws } from '../../client.js'"); // Assuming relative path
    expect(piniaCode).toContain("export const usePostsStore = defineStore('posts-store', () => {");
    
    // CRUD methods
    expect(piniaCode).toContain("async function get(id)");
    expect(piniaCode).toContain("await ws.api.save_posts(data)");
    const pkField = mockManifest.entities.posts.primaryKey[0] || 'id';
    expect(piniaCode).toContain("await ws.api.delete_posts({ id: id })");
    expect(piniaCode).toContain("async function table_changed(payload)");
    expect(piniaCode).toContain("if (payload.table === 'posts') {");
    expect(piniaCode).toContain("records.value.push(payload.data)"); // Simplified update logic
  });
});