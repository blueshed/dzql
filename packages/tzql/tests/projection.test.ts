import { describe, test, expect } from "bun:test";
import { projectVisible } from "../src/runtime/projection.js";
import { loadManifest, getEntityHidden } from "../src/runtime/manifest_loader.js";

describe("projectVisible", () => {
  test("strips hidden keys from the outgoing row", () => {
    const row: Record<string, unknown> = { id: 1, name: "alice", password_hash: "secret" };
    expect(projectVisible(row, ["password_hash"])).toEqual({ id: 1, name: "alice" });
  });

  test("returns the row unchanged when nothing is hidden", () => {
    const row = { id: 1, name: "alice" };
    expect(projectVisible(row, [])).toEqual(row);
    expect(projectVisible(row, undefined)).toEqual(row);
  });

  test("passes through null/undefined", () => {
    expect(projectVisible(null, ["x"])).toBeNull();
    expect(projectVisible(undefined, ["x"])).toBeUndefined();
  });

  test("does not mutate the input", () => {
    const row = { id: 1, password_hash: "secret" };
    projectVisible(row, ["password_hash"]);
    expect(row).toHaveProperty("password_hash");
  });
});

describe("getEntityHidden (manifest-driven)", () => {
  test("reads hidden columns from the loaded manifest", () => {
    loadManifest({
      version: "test",
      functions: {},
      entities: {
        users: { hidden: ["password_hash"] } as any,
      },
      subscribables: {},
    } as any);
    expect(getEntityHidden("users")).toEqual(["password_hash"]);
    expect(getEntityHidden("unknown")).toEqual([]);
  });
});
