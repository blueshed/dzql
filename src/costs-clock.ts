// Preloaded into each measure src/costs.ts runs: the clock stands still on a day before the
// wedding's (the seed's is 2027-04-02), so what a page draws -- a photo with names or without,
// answers open or closed -- is the same whatever the day the README is measured on.
import { setSystemTime } from "bun:test";

setSystemTime(new Date("2026-09-01T12:00:00Z"));
