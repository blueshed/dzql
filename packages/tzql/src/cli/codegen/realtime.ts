export function generateAffectedKeysFunction(name: string, subIR: any) {
  // Logic to determine keys based on table
  // For 'post_detail' (param: post_id), if 'posts' table updates, key is 'post_detail:' + post.id
  
  // This is a simplified generator. In reality, it needs to traverse the 'includes' graph 
  // to find the path from the updated table back to the root parameter.
  
  // Example for post_detail:
  // Root: posts (key: post_id)
  //   -> includes comments (filter: post_id=@id)
  
  // If posts updates: key = 'post_detail:' + new.id
  // If comments updates: key = 'post_detail:' + new.post_id
  
  // We need to generate a CASE statement for p_table
  
  const cases = [];
  
  // 1. Root Entity Case
  const rootEntity = subIR.root.entity;
  // Assumption: the param key matches the root entity's PK or is mapped
  // Here, param is 'post_id'. Root key is 'post_id'.
  // If root key starts with @, it's a variable. If not, it's a param name.
  // Wait, in blog.ts: root: { entity: 'posts', key: 'post_id' }
  // This means the subscription param 'post_id' maps to the 'posts' entity.
  // So if 'posts' updates, we look at its ID (assuming ID is the join key? No, 'key' is the param name).
  
  // Simpler assumption for V2.0:
  // subscription key = "sub_name:param_value"
  
  // If root table updates, the param value is usually the PK of the root table.
  cases.push(
    `
    WHEN '${rootEntity}' THEN
      RETURN ARRAY['${name}:' || COALESCE(p_new->>'id', p_old->>'id')];
  `);
  
  // TODO: Handle related tables via traversal
  
  return (
    `
CREATE OR REPLACE FUNCTION dzql_v2.${name}_affected_keys(p_table text, p_op text, p_old jsonb, p_new jsonb)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  CASE p_table
    ${cases.join('\n')}
    ELSE
      RETURN ARRAY[]::text[];
  END CASE;
END;
$$;
`);
}
