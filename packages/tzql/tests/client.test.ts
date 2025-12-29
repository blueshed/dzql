import { describe, test, expect } from "bun:test";
import { generateClientSDK } from "../src/cli/codegen/client.js";
import { generateManifest } from "../src/cli/codegen/manifest.js";
import { generateIR } from "../src/cli/compiler/ir.js";

const mockManifest = generateManifest(generateIR({
    entities: { 
        posts: { 
            schema: { id: "serial primary key", title: "text" }, 
            permissions: { create: [], view: [] } 
        } 
    },
    subscribables: {}
}));

describe("Client SDK Generation", () => {
  test("should generate a JS SDK with API methods", () => {
    const jsCode = generateClientSDK(mockManifest);
    
    expect(jsCode).toContain("class GeneratedWebSocketManager extends WebSocketManager");
    expect(jsCode).toContain("this.call('save_posts', params)");
    expect(jsCode).toContain("this.api = {");
    expect(jsCode).toContain("save_posts: (params) => this.call('save_posts', params)");
  });

  test("should generate a TS SDK with types (optional)", () => {
    const tsCode = generateClientSDK(mockManifest, true); // true for TS
    
    expect(tsCode).toContain("export interface TzqlAPI {");
    expect(tsCode).toContain("save_posts: (params: SavePostsParams) => Promise<Posts>");
    expect(tsCode).toContain("get_posts: (params: PostsPK) => Promise<Posts | null>");
  });
});
