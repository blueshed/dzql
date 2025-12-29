import { pathToFileURL } from "bun";
import { resolve } from "path";

export async function loadDomain(filePath: string) {
  // Simple resolve against CWD
  const absolutePath = resolve(process.cwd(), filePath);
  console.log(`[Compiler] Resolving path: ${filePath}`);
  console.log(`[Compiler] Absolute path: ${absolutePath}`);

  try {
    // Bun can import .ts files directly
    const module = await import(absolutePath);

    if (!module.entities) {
      throw new Error(`Module ${filePath} must export 'entities' object.`);
    }

    console.log(`[Compiler] Loaded ${Object.keys(module.entities).length} entities.`);
    if (module.subscribables) {
        console.log(`[Compiler] Loaded ${Object.keys(module.subscribables).length} subscribables.`);
    }

    return {
        entities: module.entities,
        subscribables: module.subscribables || {}
    };

  } catch (error) {
    console.error(`[Compiler] Failed to load domain module:`, error);
    throw error;
  }
}
