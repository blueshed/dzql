/**
 * Notification Path Code Generator
 * Generates PostgreSQL functions to resolve notification paths to user IDs
 *
 * Uses the shared path parser for parity with permission compilation.
 */

import type { EntityIR } from "../../shared/ir.js";
import { parsePath, compilePathToSelect } from "../compiler/paths.js";

/**
 * Generate notification resolution function for an entity
 * Returns a function that resolves notification paths to an array of user IDs
 */
export function generateNotificationFunction(name: string, entityIR: EntityIR): string {
  const notifications = entityIR.notifications || {};
  const pathNames = Object.keys(notifications);

  if (pathNames.length === 0) {
    // No notifications - return empty function
    return `
-- Notification resolution for ${name} (no paths configured)
CREATE OR REPLACE FUNCTION dzql_v2.${name}_notify_users(
  p_user_id INT,
  p_data JSONB
) RETURNS INT[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
BEGIN
  RETURN ARRAY[]::INT[];
END;
$$;`;
  }

  // Generate SQL for each notification path
  const pathQueries: string[] = [];

  for (const [pathName, paths] of Object.entries(notifications)) {
    if (!paths || !Array.isArray(paths)) continue;

    for (const path of paths) {
      const parsed = parsePath(path);

      if (!parsed.isValid) {
        console.warn(`[Notification] Invalid path in ${name}.${pathName}: ${parsed.error}`);
        continue;
      }

      const userQuery = compilePathToSelect(parsed, 'p_data');
      pathQueries.push(`  -- ${pathName}: ${path}
  v_users := v_users || ARRAY(${userQuery});`);
    }
  }

  const pathSQL = pathQueries.length > 0
    ? pathQueries.join('\n\n')
    : '  -- No valid notification paths';

  return `
-- Notification resolution for ${name}
CREATE OR REPLACE FUNCTION dzql_v2.${name}_notify_users(
  p_user_id INT,
  p_data JSONB
) RETURNS INT[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_users INT[] := ARRAY[]::INT[];
BEGIN
${pathSQL}

  -- Return unique user IDs (excluding the acting user to avoid self-notification)
  RETURN ARRAY(SELECT DISTINCT u FROM unnest(v_users) AS u WHERE u != p_user_id);
END;
$$;`;
}
