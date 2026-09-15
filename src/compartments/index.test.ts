import { describe, expect, test } from "bun:test";
import type { Example } from "../example";
import { assemble } from "./index";

describe("renderFor", () => {
  test("throws if no compartment in the example produces a view", () => {
    const sessionId = crypto.randomUUID();
    // A fake example with no compartments at all: the kernel's own ledger
    // compartment (appended by assemble()) has no render() either, so nothing
    // in the assembled set can produce a view -- exercising the fallback
    // without needing a real example to somehow decline in every state.
    const fakeExample: Example = {
      name: "fake",
      compartments: [],
      active: () => true,
      index: {} as Example["index"], // never served: this test never hits a route
    };

    expect(() => assemble(fakeExample).renderFor(sessionId)).toThrow(
      `no compartment produced a view for session ${sessionId}`,
    );
  });
});
