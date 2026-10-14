import { describe, test, expect } from "bun:test";
import { generateTypeDefinitions } from "../src/cli/codegen/types.js";
import { generateClientSDK } from "../src/cli/codegen/client.js";
import { generateManifest } from "../src/cli/codegen/manifest.js";
import { generateIR } from "../src/cli/compiler/ir.js";
import type { DomainConfig } from "../src/shared/ir.js";

// =============================================================================
// Test Fixtures
// =============================================================================

const baseDomain: DomainConfig = {
  entities: {
    users: {
      schema: {
        id: "serial PRIMARY KEY",
        email: "text UNIQUE NOT NULL",
        name: "text NOT NULL",
        password_hash: "text NOT NULL",
        created_at: "timestamptz DEFAULT now()"
      },
      hidden: ["password_hash"],
      permissions: { view: [], create: [], update: [], delete: [] }
    },
    posts: {
      schema: {
        id: "serial PRIMARY KEY",
        title: "text NOT NULL",
        content: "text",
        author_id: "int NOT NULL REFERENCES users(id)"
      },
      includes: { author: "users" },
      permissions: { view: [], create: [], update: [], delete: [] }
    },
    venues: {
      schema: {
        id: "serial PRIMARY KEY",
        name: "text NOT NULL",
        org_id: "int NOT NULL"
      },
      permissions: { view: [], create: [], update: [], delete: [] }
    },
    sites: {
      schema: {
        id: "serial PRIMARY KEY",
        name: "text NOT NULL",
        venue_id: "int NOT NULL REFERENCES venues(id)"
      },
      permissions: { view: [], create: [], update: [], delete: [] }
    }
  },
  subscribables: {
    venue_detail: {
      params: { venue_id: "int" },
      root: { entity: "venues", key: "venue_id" },
      includes: {
        sites: "sites"
      },
      canSubscribe: []
    },
    my_profile: {
      params: {},
      root: { entity: "users", key: "@user_id" },
      canSubscribe: []
    }
  }
};

// =============================================================================
// Phase 1: Auth Types Tests
// =============================================================================

describe("Auth Types Generation", () => {
  test("should generate default auth types when no auth config provided", () => {
    const ir = generateIR(baseDomain);
    const manifest = generateManifest(ir);
    const types = generateTypeDefinitions(manifest.entities, manifest.subscribables, ir.auth);

    // Should generate AuthUser based on users entity (minus hidden fields)
    expect(types).toContain("export interface AuthUser {");
    expect(types).toContain("user_id: number;");
    expect(types).toContain("email: string;");
    expect(types).toContain("name: string;");

    // AuthUser should not contain password_hash (check by extracting AuthUser block)
    const authUserMatch = types.match(/export interface AuthUser \{[^}]+\}/);
    expect(authUserMatch).not.toBeNull();
    expect(authUserMatch![0]).not.toContain("password_hash");

    // Should generate LoginParams with defaults
    expect(types).toContain("export interface LoginParams {");
    expect(types).toContain("email: string;");
    expect(types).toContain("password: string;");

    // Should generate LoginResult extending AuthUser with token
    expect(types).toContain("export interface LoginResult extends AuthUser {");
    expect(types).toContain("token: string;");

    // Should generate RegisterParams
    expect(types).toContain("export interface RegisterParams {");

    // Should generate RegisterResult
    expect(types).toContain("export interface RegisterResult extends AuthUser {");
  });

  test("should generate custom auth types when auth config provided", () => {
    const domainWithAuth: DomainConfig = {
      ...baseDomain,
      auth: {
        userFields: {
          user_id: "number",
          email: "string",
          name: "string",
          role: "string"
        },
        loginParams: {
          email: "string",
          password: "string"
        },
        registerParams: {
          email: "string",
          password: "string",
          name: "string",
          invite_code: "string"
        }
      }
    };

    const ir = generateIR(domainWithAuth);
    const manifest = generateManifest(ir);
    const types = generateTypeDefinitions(manifest.entities, manifest.subscribables, ir.auth);

    // Should include custom role field
    expect(types).toContain("role: string;");

    // Should include custom invite_code in RegisterParams
    expect(types).toContain("invite_code: string;");
  });

  test("client SDK should use typed auth methods", () => {
    const ir = generateIR(baseDomain);
    const manifest = generateManifest(ir);
    const clientCode = generateClientSDK(manifest);

    // Should have typed login_user
    expect(clientCode).toContain("login_user: (params: LoginParams) => Promise<LoginResult>");

    // Should have typed register_user
    expect(clientCode).toContain("register_user: (params: RegisterParams) => Promise<RegisterResult>");
  });
});

// =============================================================================
// Phase 2: Subscribable Result Types Tests
// =============================================================================

describe("Subscribable Result Types Generation", () => {
  test("should generate result types for subscribables with includes", () => {
    const ir = generateIR(baseDomain);
    const manifest = generateManifest(ir);
    const types = generateTypeDefinitions(manifest.entities, manifest.subscribables, ir.auth);

    // Should generate VenueDetailResult extending Venues with includes
    expect(types).toContain("export interface VenueDetailResult extends Venues {");
    expect(types).toContain("sites?: Sites[];");
  });

  test("should generate result types for subscribables without includes", () => {
    const ir = generateIR(baseDomain);
    const manifest = generateManifest(ir);
    const types = generateTypeDefinitions(manifest.entities, manifest.subscribables, ir.auth);

    // my_profile has no includes, should still generate result type
    expect(types).toContain("export interface MyProfileResult extends Users {");
  });

  test("should generate nested result types for deeply nested includes", () => {
    const domainWithNestedIncludes: DomainConfig = {
      ...baseDomain,
      subscribables: {
        venue_detail: {
          params: { venue_id: "int" },
          root: { entity: "venues", key: "venue_id" },
          includes: {
            sites: {
              entity: "sites",
              includes: {
                venue: "venues"  // nested include
              }
            }
          },
          canSubscribe: []
        }
      }
    };

    const ir = generateIR(domainWithNestedIncludes);
    const manifest = generateManifest(ir);
    const types = generateTypeDefinitions(manifest.entities, manifest.subscribables, ir.auth);

    // Should handle nested includes
    expect(types).toContain("export interface VenueDetailResult extends Venues {");
  });

  test("client SDK should use typed subscribe callbacks", () => {
    const ir = generateIR(baseDomain);
    const manifest = generateManifest(ir);
    const clientCode = generateClientSDK(manifest);

    // Should have typed callback for venue_detail
    expect(clientCode).toContain("subscribe_venue_detail: (params: VenueDetailParams, callback: (data: VenueDetailResult) => void)");

    // Should have typed callback for my_profile
    expect(clientCode).toContain("subscribe_my_profile: (params: MyProfileParams, callback: (data: MyProfileResult) => void)");
  });
});

// =============================================================================
// Phase 3: Custom Function Types Tests
// =============================================================================

describe("Custom Function Types Generation", () => {
  test("should generate types for custom functions with params and returns", () => {
    const domainWithCustomFunctions: DomainConfig = {
      ...baseDomain,
      customFunctions: [
        {
          name: "calculate_stats",
          sql: "CREATE OR REPLACE FUNCTION dzql_v2.calculate_stats...",
          params: {
            org_id: "number",
            date_from: "string",
            date_to: "string"
          },
          returns: {
            total_count: "number",
            total_revenue: "number",
            average_order: "number"
          }
        }
      ]
    };

    const ir = generateIR(domainWithCustomFunctions);
    const manifest = generateManifest(ir);
    const types = generateTypeDefinitions(manifest.entities, manifest.subscribables, ir.auth, ir.customFunctions);

    // Should generate params interface
    expect(types).toContain("export interface CalculateStatsParams {");
    expect(types).toContain("org_id: number;");
    expect(types).toContain("date_from: string;");
    expect(types).toContain("date_to: string;");

    // Should generate result interface
    expect(types).toContain("export interface CalculateStatsResult {");
    expect(types).toContain("total_count: number;");
    expect(types).toContain("total_revenue: number;");
    expect(types).toContain("average_order: number;");
  });

  test("should handle custom functions with scalar return types", () => {
    const domainWithScalarReturn: DomainConfig = {
      ...baseDomain,
      customFunctions: [
        {
          name: "count_active_users",
          sql: "CREATE OR REPLACE FUNCTION dzql_v2.count_active_users...",
          params: { org_id: "number" },
          returns: "number"  // scalar return
        }
      ]
    };

    const ir = generateIR(domainWithScalarReturn);
    const manifest = generateManifest(ir);
    const types = generateTypeDefinitions(manifest.entities, manifest.subscribables, ir.auth, ir.customFunctions);

    expect(types).toContain("export interface CountActiveUsersParams {");
    expect(types).toContain("org_id: number;");
  });

  test("should fallback to generic types for custom functions without type info", () => {
    const domainWithUntypedFunction: DomainConfig = {
      ...baseDomain,
      customFunctions: [
        {
          name: "legacy_function",
          sql: "CREATE OR REPLACE FUNCTION dzql_v2.legacy_function..."
          // No params or returns defined
        }
      ]
    };

    const ir = generateIR(domainWithUntypedFunction);
    const manifest = generateManifest(ir);
    const clientCode = generateClientSDK(manifest);

    // Should fallback to generic types
    expect(clientCode).toContain("legacy_function: (params: Record<string, unknown>) => Promise<unknown>");
  });

  test("client SDK should use typed custom function methods", () => {
    const domainWithCustomFunctions: DomainConfig = {
      ...baseDomain,
      customFunctions: [
        {
          name: "calculate_stats",
          sql: "...",
          params: { org_id: "number" },
          returns: { total: "number" }
        }
      ]
    };

    const ir = generateIR(domainWithCustomFunctions);
    const manifest = generateManifest(ir);
    const clientCode = generateClientSDK(manifest);

    expect(clientCode).toContain("calculate_stats: (params: CalculateStatsParams) => Promise<CalculateStatsResult>");
  });
});
