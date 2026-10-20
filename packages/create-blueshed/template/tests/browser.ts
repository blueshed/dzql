// A Bun.WebView at the app's page, and the helpers page tests share: railroad's
// (`@blueshed/railroad/webview`, whose header has the Bun.WebView rules), and one of the app's own.
import { browser as railroadBrowser } from "@blueshed/railroad/webview";

/** `url` is read on each visit, so a test can restart the server on another one. */
export function browser(url: () => URL) {
  const page = railroadBrowser(url);
  return {
    ...page,

    // Make every change the page sends to a document from now on one the server refuses (a path that is no path)
    refuseWrites: () =>
      page.view.evaluate(`(() => {
        const send = WebSocket.prototype.send;
        WebSocket.prototype.send = function (data) {
          const msg = JSON.parse(data);
          if (msg.action === "delta") msg.ops = [{ op: "replace", path: "no path", value: null }];
          return send.call(this, JSON.stringify(msg));
        };
      })()`),
  };
}
