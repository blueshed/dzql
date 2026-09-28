// bun run uml:check [model]: every diagram checked against its vocabulary, once, as `bun watch.ts`
// reports it live -- chat's against types.ts, a model with a stories.ts (londons) against its
// stories. The check reads the ASCII, so PlantUML is not needed. It is advice: it says what
// drifts, and exits 0.

import { readdir } from "node:fs/promises";
import { checkAgreement, uncited, type Story } from "./agreements";
import { check, readTypes, typesFindings, undrawn, type Checked } from "./check";

const dir = import.meta.dir + (process.argv[2] ? `/${process.argv[2]}` : "");
const sources = (await readdir(`${dir}/src`)).filter((f) => /\.(puml|plantuml|pu|uml)$/.test(f));
const read = (f: string) => Bun.file(`${dir}/src/${f}`).text();
const drift: string[] = [];

if (await Bun.file(`${dir}/stories.ts`).exists()) {
  const stories = (await import(`${dir}/stories.ts`)).stories.stories as Story[];
  const cited = new Set<number>();
  for (const f of sources) {
    const a = checkAgreement(await read(f), stories);
    for (const n of a.cited) cited.add(n);
    drift.push(...a.drift.map((d) => `${f}: ${d}`));
  }
  drift.push(...uncited(stories, cited).map((s) => `on no diagram: ${s}`));
} else {
  const types = readTypes(await Bun.file(`${dir}/types.ts`).text());
  const all: Checked[] = [];
  for (const f of sources) {
    const c = check(f.replace(/\.[^.]+$/, ""), await read(f), types);
    all.push(c);
    drift.push(...c.drift.map((d) => `${f}: ${d}`));
  }
  drift.push(...typesFindings(types).map((x) => `types.ts: ${x}`), ...undrawn(types, all).map((x) => `not drawn yet: ${x}`));
}

console.log(drift.length ? drift.join("\n") : `every diagram in ${dir.replace(`${process.cwd()}/`, "")}/src agrees`);
