// bun run modeller:page <example> [out.html]: the modeller's demo page for one example -- its
// facts (extract.ts), inlined into page.html. By default it is written to modeller/dist/.
import { extract } from "./extract";

const [name = "chat", out = `${import.meta.dir}/dist/${name}.html`] = process.argv.slice(2);
const data = JSON.stringify(await extract(name)).replaceAll("</", "<\\/");
const page = await Bun.file(`${import.meta.dir}/page.html`).text();
await Bun.write(out, page.replace("__DATA__", () => data));
console.log(`${out}: the ${name} modeller page`);
