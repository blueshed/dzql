#!/usr/bin/env bun
/**
 * `bun create dzql my-app`: eta's starter on dzql. The app is `src/`, begun as dzql's
 * `examples/starter` (its routes and its page, no stories yet, no resources yet), served by delta's
 * one server from its own `routes.ts`. Copies `template/` (the app's package.json, tsconfig, README), then the
 * starter into `src/`, puts the app's name in, and says what to run.
 *
 * The starter is dzql's own, copied in when this package is packed (`prepack`, as `starter/`); run
 * from the repository it is read where it lives, so the two never differ.
 */
import { cpSync, existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const name = process.argv[2] || "my-dzql-app";
if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
  console.error(`"${name}" is not a name for an app: lower case letters, digits and dashes`);
  process.exit(1);
}
const dest = join(process.cwd(), name);
if (existsSync(dest)) {
  console.error(`Error: "${name}" already exists`);
  process.exit(1);
}
const packed = join(import.meta.dir, "starter");
const starter = existsSync(packed) ? packed : join(import.meta.dir, "../dzql/examples/starter");

console.log(`Creating ${name}...`);
cpSync(join(import.meta.dir, "template"), dest, { recursive: true });
cpSync(starter, join(dest, "src"), { recursive: true });

// npm leaves dotfiles of a package behind: they travel without their dot
renameSync(join(dest, "gitignore"), join(dest, ".gitignore"));
renameSync(join(dest, "env.test"), join(dest, ".env.test"));

// The starter's look imports the kernel's bento by a path inside dzql; in an app it is by name
const styles = join(dest, "src/styles.css");
writeFileSync(styles, readFileSync(styles, "utf8").replace(/@import "[^"]*src\/rendering\/(bento(?:-plain)?\.css)";/, '@import "dzql/rendering/$1";'));

// The app's name in place of {{name}}, and of the starter's own, in every file
const title = name.replace(/(^|-)(\w)/g, (_, dash: string, c: string) => (dash ? " " : "") + c.toUpperCase());
const named = (dir: string): void => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) named(path);
    else {
      const text = readFileSync(path, "utf8");
      const next = text.replaceAll("{{name}}", name).replaceAll("Starter", title).replace('name: "starter"', `name: "${name}"`);
      if (next !== text) writeFileSync(path, next);
    }
  }
};
named(dest);

console.log(`
Done. To start:

  cd ${name}
  bun install        # and the skills: dzql-app, modelling, delta-doc
  bun dev            # http://localhost:3000: the page, waiting for its first story;
                     # and /model, the model's page, where the stories are told first
  bun test           # the page is served and drawn, and every story passes
`);
