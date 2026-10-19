/**
 * Bench runner — applies framework SQL, then walks each adapter through the
 * single-write workload and prints a comparison table.
 *
 * Usage (requires the test compose: `bun run test:setup`):
 *
 *   bun run bench/run.ts
 *   BENCH_ITERATIONS=5000 bun run bench/run.ts
 *   DATABASE_URL=postgres://... bun run bench/run.ts
 */
import { Pool } from "pg";
import { applyFramework } from "../src/postgres";
import type { Adapter, Stats } from "./adapter";
import { fmtMs } from "./adapter";
import { deltaAdapter } from "./adapters/delta";
import { rawPostgresAdapter } from "./adapters/raw-postgres";
import { appUrl, ensureAppRole } from "./schema";
import { runSingleWrite } from "./workloads/single-write";
import { runFanout } from "./workloads/fanout";

const PG_URL = process.env.DATABASE_URL ?? "postgres://dzql_test:dzql_test@localhost:5433/dzql_test";

const ITERATIONS = Number(process.env.BENCH_ITERATIONS ?? 10_000);
const WARMUP = Number(process.env.BENCH_WARMUP ?? 200);

/** The framework, and the app role every timed write runs as, made by the admin the URL names. */
async function prepare(): Promise<void> {
  const pool = new Pool({ connectionString: PG_URL, max: 1 });
  try {
    await applyFramework(pool);
    await ensureAppRole(pool);
  } finally {
    await pool.end();
  }
}

interface Result {
  adapter: Adapter;
  stats: Stats;
}

async function runOne(factory: () => Adapter): Promise<Result> {
  const adapter = factory();
  await adapter.setup();
  try {
    const stats = await runSingleWrite(adapter, {
      iterations: ITERATIONS,
      warmup: WARMUP,
    });
    return { adapter, stats };
  } finally {
    await adapter.teardown();
  }
}

function printHeader(): void {
  console.log(
    `\ndelta bench — single-field write, ${ITERATIONS.toLocaleString()} iterations (${WARMUP} warm-up)\n` +
      `target: ${PG_URL}\n`,
  );
  console.log(
    "                        p50         p95         p99        mean       total    RTT",
  );
  console.log(
    "                     --------    --------    --------    --------    --------   ---",
  );
}

function printRow(r: Result): void {
  const { adapter, stats } = r;
  const cols = [
    adapter.name.padEnd(18, " "),
    fmtMs(stats.p50),
    fmtMs(stats.p95),
    fmtMs(stats.p99),
    fmtMs(stats.mean),
    `${(stats.totalMs / 1000).toFixed(2).padStart(7, " ")} s`,
    String(adapter.rtt).padStart(3, " "),
  ];
  console.log(cols.join("   "));
}

async function main(): Promise<void> {
  await prepare();
  const app = appUrl(PG_URL);

  // One after another, on the same hardware state: raw first (the baseline), then delta's write.
  // Every write as the app role.
  const results: Result[] = [];
  results.push(await runOne(() => rawPostgresAdapter(PG_URL, app)));
  results.push(await runOne(() => deltaAdapter(PG_URL, app)));

  printHeader();
  for (const r of results) printRow(r);

  const [rawS, deltaS] = results.map((r) => r.stats) as [Stats, Stats];
  console.log(`\ndelta / raw-postgres p50: ${(deltaS.p50 / rawS.p50).toFixed(2)}x`);

  // A write's fan-out as the names ever opened grow, ten open: it should stay flat.
  console.log("\nfan-out — one write through a scoped document, 10 open\n");
  console.log("    ever opened         p50         p95        mean    writes");
  for (const n of [10, 1_000, 100_000]) {
    const s = await runFanout(PG_URL, n);
    console.log(`${n.toLocaleString().padStart(15, " ")}   ${fmtMs(s.p50)}   ${fmtMs(s.p95)}   ${fmtMs(s.mean)}   ${String(s.iterations).padStart(7, " ")}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
