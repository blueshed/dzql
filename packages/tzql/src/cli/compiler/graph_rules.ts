export function compileGraphRules(entity: string, trigger: string, rules: any[]): string {
  if (!rules || rules.length === 0) return "";

  let sql = "";

  for (const rule of rules) {
    // === REACTOR ===
    if (rule.type === 'reactor') {
      const name = rule.name;
      const params = rule.params || {};
      
      // Build JSON object using jsonb_build_object
      const jsonArgs = [];
      for (const [key, val] of Object.entries(params)) {
        let valueExpr = val as string;
        // Basic variable resolution
        if (valueExpr === '@id') {
            if (trigger === 'create' || trigger === 'update') {
                valueExpr = `(v_result->>'id')`;
            } else {
                valueExpr = `(p_pk->>'id')`;
            }
        } else {
            valueExpr = `'${val}'`; // Literal
        }
        jsonArgs.push(`'${key}', ${valueExpr}`);
      }
      
      const dataJson = jsonArgs.length > 0 
        ? `jsonb_build_object(${jsonArgs.join(', ')})`
        : `'{}'::jsonb`;

      sql += `
  -- Graph Rule: Reactor ${name}
  INSERT INTO dzql_v2.events (commit_id, table_name, op, pk, data, user_id)
  VALUES (
    v_commit_id,
    '${entity}',
    'reactor:${name}',
    jsonb_build_object('id', ${trigger === 'create' ? "(v_result->>'id')::text" : "(p_pk->>'id')::text"}),
    ${dataJson},
    p_user_id
  );
`;
    }

    // === CREATE SIDE EFFECT ===
    if (rule.type === 'create') {
        const target = rule.entity;
        const data = rule.data || {};
        const cols = [];
        const vals = [];
        
        for (const [key, val] of Object.entries(data)) {
             let valueExpr = val as string;
             // Variable Resolution
             if (valueExpr === '@id') {
                 valueExpr = `(v_result->>'id')::int`;
             } else if (valueExpr === '@user_id') {
                 valueExpr = `p_user_id`;
             // If target column is NOT NULL, and p_user_id is null, this will still fail.
             // We need a more robust solution involving IS NOT NULL checks in PL/pgSQL
             // For now, assume p_user_id will be valid or the table allows NULL.
             // Or, better, pass 0 if userId is null, and let FK fail.
             // But if we're passing NULL from WS, then p_user_id is null.
             // For user_id, if p_user_id is NULL and target column is NOT NULL, we must NOT insert.
             // This is a complex logic that probably needs to come from IR schema.
             // For now, let's keep it simple: if p_user_id is NULL, then insert NULL.
             // And if the DB has NOT NULL, it will fail.
             // This needs to be part of the contract.
             // The SQL should be `CASE WHEN p_user_id IS NOT NULL THEN p_user_id ELSE NULL END`
             valueExpr = `CASE WHEN p_user_id IS NOT NULL THEN p_user_id ELSE NULL END`;

             } else if (valueExpr === '@today' || valueExpr === '@now') {
                 valueExpr = `CURRENT_DATE`; // or NOW()
             } else {
                 valueExpr = `'${val}'`; // Literal
             }
             cols.push(key);
             vals.push(valueExpr);
        }
        
        sql += `
  -- Graph Rule: Create ${target}
  INSERT INTO ${target} (${cols.join(', ')})
  VALUES (${vals.join(', ')});
`;
    }

    // === DELETE CASCADE ===
    if (rule.type === 'delete') {
        const target = rule.target;
        const params = rule.params || {};
        const whereClauses = [];
        
        for (const [key, val] of Object.entries(params)) {
             let valueExpr = val as string;
             if (valueExpr === '@id') {
                 valueExpr = `(p_pk->>'id')::int`;
             }
             whereClauses.push(`${key} = ${valueExpr}`);
        }
        
        sql += `
  -- Graph Rule: Delete ${target}
  DELETE FROM ${target} WHERE ${whereClauses.join(' AND ')};
`;
    }
  }

  return sql;
}