import { describe, test, expect, beforeAll } from "bun:test";
import { loadManifest } from "../src/runtime/manifest_loader.js";
import { handleRequest } from "../src/runtime/server.js";
import { ErrorCode } from "../src/runtime/errors.js";

// Mock Manifest
const mockManifest = {
  version: "2.0.0",
  functions: {
    "save_posts": {
      schema: "dzql_v2",
      name: "save_posts",
      args: ["p_user_id", "p_data"],
      returnType: "jsonb"
    }
  },
  entities: {},
  subscribables: {}
};

// Mock DB
const mockDB = {
  query: async (text: string, params: any[]) => {
    // Simulate Success
    if (params[1].title === "Hello") {
        return [{ result: { id: 1, ...params[1] } }];
    }
    // Simulate Permission Error
    if (params[1].title === "Hacked") {
        const e: any = new Error("permission_denied");
        e.code = "P0001";
        throw e;
    }
    // Simulate Unique Violation
    if (params[1].title === "Duplicate") {
        const e: any = new Error("duplicate key value");
        e.code = "23505";
        throw e;
    }
    return [];
  }
};

describe("Runtime Security", () => {
  beforeAll(() => {
    loadManifest(mockManifest);
  });

  test("should execute allowlisted function", async () => {
    const result = await handleRequest(mockDB, "save_posts", { title: "Hello" }, 1);
    expect(result.id).toBe(1);
  });

  test("should reject unknown function (Injection Attempt)", async () => {
    try {
      await handleRequest(mockDB, "pg_sleep", {}, 1);
      expect(true).toBe(false); 
    } catch (e: any) {
      expect(e.message).toContain("not found in manifest");
    }
  });

  test("should return PERMISSION_DENIED", async () => {
    try {
      await handleRequest(mockDB, "save_posts", { title: "Hacked" }, 1);
      expect(true).toBe(false); 
    } catch (e: any) {
      expect(e.code).toBe(ErrorCode.PERMISSION_DENIED);
    }
  });

  test("should return CONFLICT", async () => {
    try {
      await handleRequest(mockDB, "save_posts", { title: "Duplicate" }, 1);
      expect(true).toBe(false); 
    } catch (e: any) {
      expect(e.code).toBe(ErrorCode.CONFLICT);
    }
  });
});