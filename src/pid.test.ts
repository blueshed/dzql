import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { PID_FILE, removePidFile, writePidFile } from "./pid";

describe("pid file", () => {
  afterAll(() => removePidFile());

  test("writePidFile writes the given pid", async () => {
    await writePidFile(1234);
    expect(readFileSync(PID_FILE, "utf8")).toBe("1234");
  });

  test("removePidFile deletes the file", () => {
    removePidFile();
    expect(existsSync(PID_FILE)).toBe(false);
  });

  test("removePidFile does not throw if the file is missing", () => {
    expect(() => removePidFile()).not.toThrow();
  });
});
