// bun run modeller:page <example | path> [out.html]: the modeller's page for one example -- the heart:
// its stories, documents and entities, and what goes with what (heart.ts, read by extract.ts),
// inlined into heart.html with its script (heart.client.ts). By default it is written to
// modeller/dist/. A project with no app yet is drawn from its stories alone, and says so. (page.html,
// the page before it, is no longer written.)
import { exampleAt } from "./documents";
import { extract } from "./extract";

const [at = "chat", given] = process.argv.slice(2);
const { name } = exampleAt(at);
const out = given ?? `${import.meta.dir}/dist/${name}.html`;
const { heart } = await extract(at);
const built = await Bun.build({ entrypoints: [`${import.meta.dir}/heart.client.ts`], target: "browser" });
if (!built.success) throw new AggregateError(built.logs, "heart.client.ts did not build");
const script = (await built.outputs[0]!.text()).replaceAll("</script", "<\\/script");
const data = JSON.stringify(heart).replaceAll("</", "<\\/");
const page = await Bun.file(`${import.meta.dir}/heart.html`).text();
await Bun.write(out, page.replace("__DATA__", () => data).replace("__SCRIPT__", () => script));
console.log(`${out}: the ${name} modeller page${heart.ran ? "" : ", from its stories alone"}`);
