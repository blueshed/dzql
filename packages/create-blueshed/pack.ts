#!/usr/bin/env bun
/**
 * `prepack` (`bun pack.ts ../paintbrush`): paintbrush copied in as `template/`, but for what a new app
 * never gets (UNCOPIED, in paintbrush's `create/setup.ts`), so the tarball carries nothing only to
 * have it deleted. The folder is named in the command, where the root's affected.ts reads it.
 */
import { cpSync, rmSync } from "node:fs";
import { join } from "node:path";
import { UNCOPIED } from "../paintbrush/create/setup";

const paintbrush = join(import.meta.dir, process.argv[2] ?? "../paintbrush");
const template = join(import.meta.dir, "template");
rmSync(template, { recursive: true, force: true });
const copied = (src: string) => !UNCOPIED.some((path) => src === join(paintbrush, path) || src.startsWith(`${join(paintbrush, path)}/`));
cpSync(paintbrush, template, { recursive: true, filter: copied });
