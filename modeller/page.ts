// DB_PATH=:memory: bun modeller/page.ts wedding out.html
//
// The modeller demo page for one example: extract.ts's facts, inlined into page.html.
import { $ } from "bun";

const [name = "wedding", out = `${name}-modeller.html`] = process.argv.slice(2);
const json = `${out}.json`;
await $`bun ${import.meta.dir}/extract.ts ${name} ${json}`.quiet();
const page = await Bun.file(`${import.meta.dir}/page.html`).text();
const data = (await Bun.file(json).text()).replaceAll("</", "<\\/");
await Bun.write(out, page.replace("__DATA__", () => data));
console.log(`${out}: the ${name} modeller page`);
