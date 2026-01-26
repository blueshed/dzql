/**
 * Compiles a permission rule into SQL.
 *
 * Supported formats:
 * - Literal: TRUE, FALSE
 * - Simple field check: @author_id (implies author_id == user_id)
 * - Explicit comparison: @field == @user_id
 * - Single-hop traversal: @org_id->acts_for[org_id=$]{active}.user_id
 * - Multi-hop traversal: @venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id
 * - Deep traversal: @site_id->sites.venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id
 * - Table-first: contractor_rights[package_id=@package_id]{active}.contractor_org_id->...
 *
 * Uses the shared path parser for parity with notification compilation.
 *
 * @param entityName - The entity name
 * @param rule - The permission rule string
 * @param context - Optional context (unused)
 * @param dataVar - Either a JSONB variable name (e.g., 'p_data') or a table name (e.g., 'packages')
 *                  When it's a table name, we use table.column syntax instead of jsonb->>'column'
 */

import { parsePath, compilePathToExists } from "./paths.js";

export function compilePermission(entityName: string, rule: string, context: any, dataVar: string = 'p_data'): string {
  // Literal TRUE/FALSE - public access or deny all
  if (rule === 'TRUE' || rule === 'true') {
    return 'TRUE';
  }
  if (rule === 'FALSE' || rule === 'false') {
    return 'FALSE';
  }

  // Parse the path
  const parsed = parsePath(rule);

  if (!parsed.isValid) {
    console.warn(`[Compiler] Warning: ${parsed.error}`);
    return 'FALSE';
  }

  // Compile to EXISTS check
  return compilePathToExists(parsed, dataVar, 'p_user_id');
}
