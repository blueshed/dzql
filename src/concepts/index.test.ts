import { describe, expect, test } from "bun:test";
import { renderFor } from "./index";

describe("renderFor", () => {
  test("throws if no concept in the list produces a view", () => {
    const sessionId = crypto.randomUUID();
    expect(() => renderFor(sessionId, [])).toThrow(
      `no concept produced a view for session ${sessionId}`,
    );
  });
});
