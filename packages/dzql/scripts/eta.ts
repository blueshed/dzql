#!/usr/bin/env bun
// The modelling and rendering tests, every example's included, at 100% coverage (`bun run test:eta`;
// `--ci` for the CI runner's slower machine: fewer workers, a longer timeout).
import { EXAMPLES } from "./examples";

const ci = process.argv.includes("--ci");
const dirs = ["src/rendering", "src/modelling", "readme", ...EXAMPLES.map((e) => `examples/${e}`)];
const args = ci ? ["--parallel=2", "--timeout=30000"] : ["--parallel"];
const proc = Bun.spawn(["bun", "test", ...args, ...dirs], { cwd: `${import.meta.dir}/..`, stdout: "inherit", stderr: "inherit" });
process.exit(await proc.exited);
