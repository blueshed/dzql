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
  test("should generate a TypeScript SDK with typed API", () => {
    const tsCode = generateClientSDK(mockManifest);

    // Check imports
    expect(tsCode).toContain("import { WebSocketManager } from 'tzql/client'");

    // Check interface definition
    expect(tsCode).toContain("export interface TzqlAPI {");
    expect(tsCode).toContain("save_posts: (params: SavePostsParams) => Promise<Posts>");
    expect(tsCode).toContain("get_posts: (params: PostsPK) => Promise<Posts | null>");

    // Check class definition
    expect(tsCode).toContain("export class GeneratedWebSocketManager extends WebSocketManager");
    expect(tsCode).toContain("api: TzqlAPI");

    // Check API implementation
    expect(tsCode).toContain("this.call('save_posts', params)");

    // Check singleton export
    expect(tsCode).toContain("export const ws = new GeneratedWebSocketManager()");
  });
});
