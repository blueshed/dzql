// bun run modeller:page <example> [out.html]: the modeller's page for one example -- the heart:
// its stories, documents and entities, and what goes with what (heart.ts, read by extract.ts),
// inlined into heart.html with its script (heart.client.ts). By default it is written to
// modeller/dist/. (page.html, the page before it, is no longer written.)
import { extract } from "./extract";

const [name = "chat", out = `${import.meta.dir}/dist/${name}.html`] = process.argv.slice(2);
if (!(await Bun.file(`${import.meta.dir}/../examples/${name}/index.ts`).exists())) {
  console.log(`examples/${name} has no app yet, and its page is drawn from a run of its stories: \`bun run modeller ${name}\` reads the stories alone.`);
  process.exit(1);
}
const { heart } = await extract(name);
const built = await Bun.build({ entrypoints: [`${import.meta.dir}/heart.client.ts`], target: "browser" });
if (!built.success) throw new AggregateError(built.logs, "heart.client.ts did not build");
const script = (await built.outputs[0]!.text()).replaceAll("</script", "<\\/script");
const data = JSON.stringify(heart).replaceAll("</", "<\\/");
const page = await Bun.file(`${import.meta.dir}/heart.html`).text();
await Bun.write(out, page.replace("__DATA__", () => data).replace("__SCRIPT__", () => script));
console.log(`${out}: the ${name} modeller page`);
