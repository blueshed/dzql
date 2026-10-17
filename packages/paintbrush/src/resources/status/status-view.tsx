import { signal, when } from "@blueshed/railroad";
import { load, status } from "./status";

export function StatusView() {
  const failed = signal(false);

  load().then(
    () => failed.set(false),
    () => failed.set(true),
  );

  return (
    <div id="status">
      {when(failed, () => <p class="help">The status could not be loaded.</p>)}
      {when(status, (s$) => (
        <>
          <p class="help">
            {s$.map((s) =>
              s.persistent
                ? "Your data is on a mounted volume: it survives redeploys."
                : "Your data is ephemeral: it resets on redeploy.",
            )}
          </p>
          <p class="meta">{s$.map((s) => `Uptime ${s.uptime}s · Bun ${s.bun}`)}</p>
        </>
      ))}
    </div>
  );
}
