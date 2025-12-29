import { Manifest } from "../cli/codegen/manifest.js";

// Global cache for the loaded manifest
let activeManifest: Manifest | null = null;

export function loadManifest(manifest: Manifest) {
  console.log(`[Runtime] Loading manifest v${manifest.version}`);
  activeManifest = manifest;
}

export function getManifest(): Manifest {
  if (!activeManifest) {
    throw new Error("[Runtime] Manifest not loaded.");
  }
  return activeManifest;
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
