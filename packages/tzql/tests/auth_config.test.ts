import { describe, test, expect } from "bun:test";
import { resolveJwtSecret, DEV_JWT_SECRET } from "../src/runtime/auth.js";

describe("resolveJwtSecret", () => {
  test("throws in production when JWT_SECRET is unset", () => {
    expect(() => resolveJwtSecret({ NODE_ENV: "production" } as any)).toThrow(
      /JWT_SECRET must be set/,
    );
  });

  test("throws in production when JWT_SECRET is the dev default", () => {
    expect(() =>
      resolveJwtSecret({ NODE_ENV: "production", JWT_SECRET: DEV_JWT_SECRET } as any),
    ).toThrow(/JWT_SECRET must be set/);
  });

  test("accepts a real secret in production", () => {
    expect(
      resolveJwtSecret({ NODE_ENV: "production", JWT_SECRET: "a-strong-secret" } as any),
    ).toBe("a-strong-secret");
  });

  test("falls back to the dev secret outside production", () => {
    expect(resolveJwtSecret({ NODE_ENV: "development" } as any)).toBe(DEV_JWT_SECRET);
  });

  test("prefers an explicit secret outside production too", () => {
    expect(resolveJwtSecret({ JWT_SECRET: "xyz" } as any)).toBe("xyz");
  });
});
