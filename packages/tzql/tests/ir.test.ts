import { describe, test, expect } from "bun:test";
import { generateIR } from "../src/cli/compiler/ir.js";

const rawDomain = {
  entities: {
    users: {
      schema: {
        id: "serial PRIMARY KEY",
        name: "text NOT NULL"
      },
      permissions: {
        view: ["public"]
      }
    }
  },
  subscribables: {}
};

describe("IR Generator", () => {
  test("should normalize entities", () => {
    const ir = generateIR(rawDomain);
    
    expect(ir.entities.users).toBeDefined();
    expect(ir.entities.users.primaryKey).toEqual(["id"]);
    expect(ir.entities.users.columns).toHaveLength(2);
    expect(ir.entities.users.columns[0].name).toBe("id");
    
    // Check permission normalization
    expect(ir.entities.users.permissions.view).toEqual(["public"]);
    expect(ir.entities.users.permissions.create).toEqual([]); // Defaulted
  });
});
