import { Manifest } from "../cli/codegen/manifest.js";
import { runtimeLogger } from "./logger.js";

// Global cache for the loaded manifest
let activeManifest: Manifest | null = null;

export function loadManifest(manifest: Manifest) {
  runtimeLogger.debug(`Loading manifest v${manifest.version}`);
  activeManifest = manifest;
}

export function getManifest(): Manifest {
  if (!activeManifest) {
    throw new Error("Manifest not loaded.");
  }
  return activeManifest;
}

/**
 * Hidden columns for an entity, from the loaded manifest. Returns [] when the
 * manifest or entity is unknown so callers can treat "no manifest" as "hide
 * nothing extra" without throwing on the realtime hot path.
 */
export function getEntityHidden(table: string): string[] {
  const entity = activeManifest?.entities?.[table] as { hidden?: string[] } | undefined;
  return entity?.hidden ?? [];
}

export function resolveFunction(name: string) {
  const manifest = getManifest();
  const fn = manifest.functions[name];

  if (!fn) {
    return null;
  }

  // In a real DB-connected runtime, we would resolve OID here.
  // For now, we return the schema-qualified name.
  return `${fn.schema}.${fn.name}`;
}
