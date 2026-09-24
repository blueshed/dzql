// What eta's browser tests share (`Bun.WebView`): a view that is a browser of its own, and a
// wait on what it shows.

let views = 0;
const hosts = new WeakMap<Bun.WebView, string>();

/**
 * Where `view` goes for `path` on the server at `url`, as a browser of its own. On Chrome (Linux,
 * the Claude Code sandbox) every view in a process shares one profile, and a cookie ignores the
 * port, so a second view would open already signed in as the first. Each view is given a host of
 * its own instead -- Chrome takes every `*.localhost` to this machine -- and keeps it, so a
 * reload or a link is the same person. WebKit's views (macOS) are apart already.
 */
export function at(view: Bun.WebView, url: URL | string, path = "", platform: string = process.platform): string {
  const address = new URL(path, url);
  if (platform === "darwin") return address.toString();
  if (!hosts.has(view)) hosts.set(view, `view${++views}.localhost`);
  address.hostname = hosts.get(view)!;
  return address.toString();
}

/** Evaluates `script` in `view` until `predicate` holds of it, and resolves with that value; throws, with the last value, after `timeout` ms. */
export async function waitFor(view: Bun.WebView, script: string, predicate: (value: unknown) => boolean, timeout = 5000): Promise<unknown> {
  const start = Date.now();
  let last: unknown;
  while (Date.now() - start < timeout) {
    last = await view.evaluate(script);
    if (predicate(last)) return last;
    await Bun.sleep(20);
  }
  throw new Error(`Timed out waiting for \`${script}\`; last value: ${JSON.stringify(last)}`);
}
