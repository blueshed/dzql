// The app's own commands, through the bin, so a project's scripts run only what dzql gives it (its
// package.json's `bin` and `exports`), never a file of dzql's src/: `dzql stories [<app>]`, its
// stories told against it (../modelling/stories-run.ts); `dzql cli <command>`, its CLI over its
// socket (../rendering/cli.ts); `dzql model load [<app>]`, an app that exists loaded into the
// model's page, and `dzql model built [<app>] [--against-page [<model.json>]]`, the app as built
// read back, and against the model as told (../modelling/page/loader/). `<app>` is the folder of
// its routes.ts, `./src` in a project (`ETA_EXAMPLE` says it too).
import { resolve } from "node:path";

/** The app's folder: the one given, else ETA_EXAMPLE, else a project's `./src`. */
const appAt = (given?: string): string => (given && !given.startsWith("-") ? resolve(given) : process.env.ETA_EXAMPLE ?? "./src");

/** A loader of ../modelling/page/loader/, run as its own script is: it reads its arguments from argv. */
async function loader(file: string, args: string[]): Promise<void> {
  const [at, ...rest] = args[0] && !args[0].startsWith("-") ? args : ["./src", ...args];
  process.argv.splice(2, process.argv.length, at!, ...rest);
  await import(`../modelling/page/loader/${file}`);
}

/** Runs `dzql stories`, `dzql cli`, `dzql model load` and `dzql model built`; false for any other command. */
export async function run(argv: string[]): Promise<boolean> {
  const [verb, ...rest] = argv;
  if (verb === "stories") {
    process.env.ETA_EXAMPLE = appAt(rest[0]);
    await import("../modelling/stories-run.ts");
    return true;
  }
  if (verb === "cli") {
    process.env.ETA_EXAMPLE = appAt();
    await (await import("../rendering/cli.ts")).main(rest);
    return true;
  }
  if (verb === "model" && rest[0] === "load") {
    process.env.LOG_LEVEL ??= "warn";
    await loader("load.ts", rest.slice(1));
    return true;
  }
  if (verb === "model" && rest[0] === "built") {
    process.env.LOG_LEVEL ??= "warn";
    await loader("check.ts", rest.slice(1));
    return true;
  }
  return false;
}
