import { unlinkSync } from "node:fs";

export const PID_FILE = process.env.PID_FILE ?? "server.pid";

export async function writePidFile(pid: number | string = process.pid) {
  await Bun.write(PID_FILE, `${pid}`);
}

export function removePidFile() {
  try {
    unlinkSync(PID_FILE);
  } catch {}
}
