import { describe, test, expect } from "bun:test";
import { analyzeDomain } from "../src/cli/compiler/analyzer.js";

// Mock domain for testing
const validDomain = {
  entities: {
    users: { schema: { id: "serial primary key" } },
    posts: { schema: { id: "serial primary key", user_id: "int" } }
  },
  subscribables: {
    user_posts: {
      root: { entity: "users" },
      includes: {
        posts: { entity: "posts" }
      }
    }
  }
};

const invalidDomain = {
  entities: {
    users: { schema: { id: "serial primary key" } }
  },
  subscribables: {
    broken_feed: {
      root: { entity: "users" },
      includes: {
        posts: { entity: "missing_posts" } // <--- Reference to missing entity
      }
    }
  }
};

describe("Compiler Analyzer", () => {
  test("should pass for valid domain", () => {
    const errors = analyzeDomain(validDomain);
    expect(errors).toHaveLength(0);
  });

  test("should fail for missing entity reference", () => {
    const errors = analyzeDomain(invalidDomain);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("references unknown entity 'missing_posts'");
  });
});
