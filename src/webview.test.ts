import { describe, expect, test } from "bun:test";
import { urlFor } from "./webview";

// Both platforms' paths, on whichever this runs: a browser test only ever takes its own.
describe("at: a view's own address", () => {
  const view = (): Bun.WebView => ({}) as Bun.WebView; // only its identity is used
  const url = "http://localhost:4321";

  test("on macOS (WebKit) views are apart already: the address as it is", () => {
    expect(urlFor(view(), url, "/room", "darwin")).toBe("http://localhost:4321/room");
  });

  test("elsewhere (Chrome) each view gets a host of its own, and keeps it", () => {
    const [a, b] = [view(), view()];
    const first = urlFor(a, url, "/room", "linux");
    expect(first).toMatch(/^http:\/\/view\d+\.localhost:4321\/room$/);
    expect(urlFor(a, url, "/other", "linux")).toBe(first.replace("/room", "/other")); // the same host again
    expect(new URL(urlFor(b, url, "", "linux")).hostname).not.toBe(new URL(first).hostname);
  });
});
