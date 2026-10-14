import { entities, subscribables } from "./modeling-dzql.domain.js";

/**
 * Columns modeling-dzql's rules start from or pass through that its schema lacks
 * (or types wrongly). The compiler rejects the verbatim domain because of them.
 * Most are foreign keys recorded in the model's entity_relationships that its
 * domain.ts generator never emitted. Each [table, column, type].
 */
export const MISSING_COLUMNS: Array<[string, string, string]> = [
  ["venues", "org_id", "int"],
  ["products", "org_id", "int"],
  ["faces", "product_id", "int"],
  ["face_acceptses", "face_id", "int"],
  ["sites", "area_id", "int"],
  ["workflows", "org_id", "int"],                    // schema has product_id; rules use org_id
  ["workflow_item_dependencies", "workflow_item_id", "int"],
  ["workflow_item_resources", "workflow_item_id", "int"],
  ["workflow_item_skills", "workflow_item_id", "int"], // schema has item_id
  ["profiles", "id", "serial PRIMARY KEY"],           // rules are @id; the table has no id
  ["audit_logs", "org_id", "int"],                    // declared text
];

/**
 * modeling-dzql's domain with its schema completed to what its rules assume, as a
 * scratch copy would be. Every rule is kept verbatim. Also removes invites'
 * `invitee: ["@email"]` notification: email is text, so (p_data->>'email')::int
 * fails on every save of an invite.
 */
export function patchedModelingDomain(): any {
  const d: any = structuredClone({ entities, subscribables });
  for (const [table, column, type] of MISSING_COLUMNS) d.entities[table].schema[column] = type;
  delete d.entities.invites.notifications.invitee;
  return d;
}
