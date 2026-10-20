import { signal, when } from "@blueshed/railroad";
import { bento } from "../bento";
import { load, status } from "./status";

const { cell } = bento();

/** The server's status on the box: where the data is kept, and how long it has been up. */
export function StatusCell() {
  const failed = signal(false);

  load().then(
    () => failed.set(false),
    () => failed.set(true),
  );

  const body = (
    <div id="status">
      {when(failed, () => <p class="help">The status could not be loaded.</p>)}
      {when(status, ({ persistent, uptime, bun }) => (
        <>
          <p class="help">
            {persistent.map((p) =>
              p
                ? "Your data is on a mounted volume: it survives redeploys."
                : "Your data is ephemeral: it resets on redeploy.",
            )}
          </p>
          <p class="meta">Uptime {uptime}s · Bun {bun}</p>
        </>
      ))}
    </div>
  );
  return cell({ name: "Status", body });
}
