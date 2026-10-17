/**
 * Status — a read-only resource: what the server knows about itself.
 *
 * `persistent` says whether DATA_PATH was set, which on Railway means a mounted
 * volume. It deliberately does not say where the data folder is.
 */
export type Status = {
  persistent: boolean;
  uptime: number;
  bun: string;
};

const startedAt = Date.now();

export function statusApi() {
  return {
    get: () =>
      Response.json({
        persistent: process.env.DATA_PATH !== undefined,
        uptime: Math.floor((Date.now() - startedAt) / 1000),
        bun: Bun.version,
      } satisfies Status),
  };
}
