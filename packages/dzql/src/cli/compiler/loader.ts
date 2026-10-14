import { resolve } from "path";
import type { DomainConfig, EntityConfig, SubscribableConfig, CustomFunctionConfig } from "../../shared/ir.js";

/**
 * Validates that an entity config has the required fields
 */
function validateEntityConfig(name: string, config: unknown): EntityConfig {
  if (!config || typeof config !== 'object') {
    throw new Error(`Entity '${name}' must be an object`);
  }

  const c = config as Record<string, unknown>;

  if (!c.schema || typeof c.schema !== 'object') {
    throw new Error(`Entity '${name}' must have a 'schema' object`);
  }

  // Return typed config (schema is the only required field)
  return config as EntityConfig;
}

/**
 * Validates that a subscribable config has the required fields
 */
function validateSubscribableConfig(name: string, config: unknown): SubscribableConfig {
  if (!config || typeof config !== 'object') {
    throw new Error(`Subscribable '${name}' must be an object`);
  }

  const c = config as Record<string, unknown>;

  if (!c.root || typeof c.root !== 'object') {
    throw new Error(`Subscribable '${name}' must have a 'root' object`);
  }

  const root = c.root as Record<string, unknown>;
  if (!root.entity || typeof root.entity !== 'string') {
    throw new Error(`Subscribable '${name}' root must have an 'entity' string`);
  }

  return config as SubscribableConfig;
}

/**
 * Validates a custom function config
 */
function validateCustomFunctionConfig(fn: unknown, index: number): CustomFunctionConfig {
  if (!fn || typeof fn !== 'object') {
    throw new Error(`Custom function at index ${index} must be an object`);
  }

  const f = fn as Record<string, unknown>;

  if (!f.name || typeof f.name !== 'string') {
    throw new Error(`Custom function at index ${index} must have a 'name' string`);
  }

  if (!f.sql || typeof f.sql !== 'string') {
    throw new Error(`Custom function '${f.name}' must have a 'sql' string`);
  }

  return fn as CustomFunctionConfig;
}

/**
 * Loads and validates a domain configuration file
 */
export async function loadDomain(filePath: string): Promise<DomainConfig> {
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

    if (typeof module.entities !== 'object') {
      throw new Error(`Module ${filePath} 'entities' must be an object.`);
    }

    // Validate entities
    const entities: Record<string, EntityConfig> = {};
    for (const [name, config] of Object.entries(module.entities)) {
      entities[name] = validateEntityConfig(name, config);
    }

    console.log(`[Compiler] Loaded ${Object.keys(entities).length} entities.`);

    // Validate subscribables if present
    const subscribables: Record<string, SubscribableConfig> = {};
    if (module.subscribables) {
      if (typeof module.subscribables !== 'object') {
        throw new Error(`Module ${filePath} 'subscribables' must be an object.`);
      }

      for (const [name, config] of Object.entries(module.subscribables)) {
        subscribables[name] = validateSubscribableConfig(name, config);
      }

      console.log(`[Compiler] Loaded ${Object.keys(subscribables).length} subscribables.`);
    }

    // Validate custom functions if present
    const customFunctions: CustomFunctionConfig[] = [];
    if (module.customFunctions) {
      if (!Array.isArray(module.customFunctions)) {
        throw new Error(`Module ${filePath} 'customFunctions' must be an array.`);
      }

      for (let i = 0; i < module.customFunctions.length; i++) {
        customFunctions.push(validateCustomFunctionConfig(module.customFunctions[i], i));
      }

      console.log(`[Compiler] Loaded ${customFunctions.length} custom functions.`);
    }

    return {
      entities,
      subscribables,
      customFunctions
    };

  } catch (error) {
    console.error(`[Compiler] Failed to load domain module:`, error);
    throw error;
  }
}
