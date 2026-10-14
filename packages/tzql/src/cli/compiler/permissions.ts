/**
 * Compiles permission rules into SQL.
 *
 * Supported formats:
 * - Literal: TRUE (public), FALSE (nobody), AUTHENTICATED (any signed-in user)
 * - Simple field check: @author_id (implies author_id == user_id)
 * - Explicit comparison: @field == @user_id
 * - Single-hop traversal: @org_id->acts_for[org_id=$]{active}.user_id
 * - Multi-hop traversal: @venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id
 * - Filtered middle hop: @occasion_id->occasion_promoters[occasion_id=$].promoter_id->user_orgs[org_id=$].user_id
 * - Several filters: @org_id->user_orgs[org_id=$,role=owner].user_id
 * - Table-first: contractor_rights[package_id=@package_id]{active}.contractor_org_id->...
 *
 * Uses the shared path parser for parity with notification and subscribe compilation.
 * A rule that can't be compiled throws PathCompileError; it never compiles to FALSE.
 */

import { parsePath, compilePathToExists, PathCompileError, type RowSource } from "./paths.js";

/**
 * @param entityName - The entity name (for error messages)
 * @param rule - The permission rule string
 * @param context - Optional context (unused)
 * @param dataVar - A JSONB variable name (e.g., 'p_data', 'v_old_data'), a table name or
 *                  alias in scope (e.g., 'packages'), or an explicit RowSource
 */
export function compilePermission(entityName: string, rule: string, context: any, dataVar: string | RowSource = 'p_data'): string {
  const parsed = parsePath(rule);
  if (!parsed.isValid) {
    throw new PathCompileError(`${entityName}: ${parsed.error}`, rule);
  }
  return compilePathToExists(parsed, dataVar, 'p_user_id');
}

/**
 * Compile a list of rules: any one of them grants access. An empty or missing
 * list denies everyone.
 */
export function compileRuleList(entityName: string, rules: string[] | undefined, dataVar: string | RowSource = 'p_data'): string {
  if (!rules || rules.length === 0) return 'FALSE';
  if (rules.length === 1) return compilePermission(entityName, rules[0], null, dataVar);
  return rules.map(rule => `(${compilePermission(entityName, rule, null, dataVar)})`).join(' OR ');
}
