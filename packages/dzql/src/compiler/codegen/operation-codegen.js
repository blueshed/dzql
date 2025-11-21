/**
 * Operation Code Generator
 * Generates PostgreSQL functions for CRUD operations
 */

export class OperationCodegen {
  constructor(entity) {
    this.entity = entity;
    this.tableName = entity.tableName;
  }

  /**
   * Generate all operation functions
   * @returns {string} SQL for all operations
   */
  generateAll() {
    return [
      this.generateGetFunction(),
      this.generateSaveFunction(),
      this.generateDeleteFunction(),
      this.generateLookupFunction(),
      this.generateSearchFunction()
    ].join('\n\n');
  }

  /**
   * Generate GET function
   */
  generateGetFunction() {
    const fkExpansions = this._generateFKExpansions();
    const m2mExpansionForGet = this._generateM2MExpansionForGet();
    const filterSensitiveFields = this._generateSensitiveFieldFilter();

    return `-- GET operation for ${this.tableName}
CREATE OR REPLACE FUNCTION get_${this.tableName}(
  p_user_id INT,
  p_id INT,
  p_on_date TIMESTAMPTZ DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
  v_record ${this.tableName}%ROWTYPE;
BEGIN
  -- Fetch the record
  SELECT * INTO v_record
  FROM ${this.tableName}
  WHERE id = p_id${this._generateTemporalFilter()};

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Record not found: % with id=%', '${this.tableName}', p_id;
  END IF;

  -- Convert to JSONB
  v_result := to_jsonb(v_record);

  -- Check view permission
  IF NOT can_view_${this.tableName}(p_user_id, v_result) THEN
    RAISE EXCEPTION 'Permission denied: view on ${this.tableName}';
  END IF;

${fkExpansions}
${m2mExpansionForGet}
${filterSensitiveFields}

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;`;
  }

  /**
   * Generate SAVE function
   */
  generateSaveFunction() {
    const graphRulesCall = this._generateGraphRulesCall();
    const notificationSQL = this._generateNotificationSQL();
    const filterSensitiveFields = this._generateSensitiveFieldFilter('v_output');
    const m2mVariables = this._generateM2MVariableDeclarations();
    const m2mExtraction = this._generateM2MExtraction();
    const m2mSync = this._generateM2MSync();
    const m2mExpansion = this._generateM2MExpansion();

    return `-- SAVE operation for ${this.tableName}
CREATE OR REPLACE FUNCTION save_${this.tableName}(
  p_user_id INT,
  p_data JSONB
) RETURNS JSONB AS $$
DECLARE
  v_result ${this.tableName}%ROWTYPE;
  v_existing ${this.tableName}%ROWTYPE;
  v_output JSONB;
  v_is_insert BOOLEAN := false;
  v_notify_users INT[];
${m2mVariables}
BEGIN
${m2mExtraction}
  -- Determine if this is insert or update
  IF p_data->>'id' IS NULL THEN
    v_is_insert := true;
  ELSE
    -- Try to fetch existing record
    SELECT * INTO v_existing
    FROM ${this.tableName}
    WHERE id = (p_data->>'id')::int;

    v_is_insert := NOT FOUND;
  END IF;

  -- Check permissions
  IF v_is_insert THEN
    IF NOT can_create_${this.tableName}(p_user_id, p_data) THEN
      RAISE EXCEPTION 'Permission denied: create on ${this.tableName}';
    END IF;
  ELSE
    IF NOT can_update_${this.tableName}(p_user_id, to_jsonb(v_existing)) THEN
      RAISE EXCEPTION 'Permission denied: update on ${this.tableName}';
    END IF;
  END IF;

  -- Perform UPSERT
  IF v_is_insert THEN
    -- Dynamic INSERT from JSONB
    EXECUTE (
      SELECT format(
        'INSERT INTO ${this.tableName} (%s) VALUES (%s) RETURNING *',
        string_agg(quote_ident(key), ', '),
        string_agg(quote_nullable(value), ', ')
      )
      FROM jsonb_each_text(p_data) kv(key, value)
    ) INTO v_result;
  ELSE
    -- Dynamic UPDATE from JSONB (only if there are fields to update)
    IF (SELECT COUNT(*) FROM jsonb_object_keys(p_data) WHERE jsonb_object_keys != 'id') > 0 THEN
      EXECUTE (
        SELECT format(
          'UPDATE ${this.tableName} SET %s WHERE id = %L RETURNING *',
          string_agg(quote_ident(key) || ' = ' || quote_nullable(value), ', '),
          (p_data->>'id')::int
        )
        FROM jsonb_each_text(p_data) kv(key, value)
        WHERE key != 'id'
      ) INTO v_result;
    ELSE
      -- No fields to update (only M2M fields were provided), just fetch existing
      v_result := v_existing;
    END IF;
  END IF;

${m2mSync}

  -- Prepare output with M2M fields (BEFORE event creation for real-time notifications!)
  v_output := to_jsonb(v_result);
${m2mExpansion}

${graphRulesCall}
${notificationSQL}

${filterSensitiveFields}

  RETURN v_output;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;`;
  }

  /**
   * Generate DELETE function
   */
  generateDeleteFunction() {
    const graphRulesCall = this._generateGraphRulesCall('delete');
    const notificationSQL = this._generateNotificationSQL('delete');
    const filterSensitiveFields = this._generateSensitiveFieldFilter('v_output');

    const deleteSQL = this.entity.softDelete
      ? `UPDATE ${this.tableName} SET deleted_at = NOW() WHERE id = p_id RETURNING * INTO v_result;`
      : `DELETE FROM ${this.tableName} WHERE id = p_id RETURNING * INTO v_result;`;

    return `-- DELETE operation for ${this.tableName}
CREATE OR REPLACE FUNCTION delete_${this.tableName}(
  p_user_id INT,
  p_id INT
) RETURNS JSONB AS $$
DECLARE
  v_result ${this.tableName}%ROWTYPE;
  v_output JSONB;
  v_notify_users INT[];
BEGIN
  -- Fetch record first
  SELECT * INTO v_result
  FROM ${this.tableName}
  WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Record not found: % with id=%', '${this.tableName}', p_id;
  END IF;

  -- Check delete permission
  IF NOT can_delete_${this.tableName}(p_user_id, to_jsonb(v_result)) THEN
    RAISE EXCEPTION 'Permission denied: delete on ${this.tableName}';
  END IF;

${graphRulesCall}

  -- Perform delete
  ${deleteSQL}

${notificationSQL}

  -- Prepare output (removing sensitive fields)
  v_output := to_jsonb(v_result);
${filterSensitiveFields}

  RETURN v_output;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;`;
  }

  /**
   * Generate LOOKUP function
   */
  generateLookupFunction() {
    return `-- LOOKUP operation for ${this.tableName}
CREATE OR REPLACE FUNCTION lookup_${this.tableName}(
  p_user_id INT,
  p_filter TEXT DEFAULT NULL,
  p_limit INT DEFAULT 50
) RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'value', id,
      'label', ${this.entity.labelField}
    ) ORDER BY ${this.entity.labelField}
  ), '[]'::jsonb) INTO v_result
  FROM ${this.tableName}
  WHERE (p_filter IS NULL OR ${this.entity.labelField} ILIKE '%' || p_filter || '%')${this._generateTemporalFilter()}
  LIMIT p_limit;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;`;
  }

  /**
   * Generate SEARCH function
   */
  generateSearchFunction() {
    const searchFields = this.entity.searchableFields || [this.entity.labelField];
    const searchConditions = searchFields.map(field =>
      `${field} ILIKE '%' || p_search || '%'`
    ).join(' OR ');
    const filterSensitiveFieldsArray = this._generateSensitiveFieldFilterArray();
    const m2mSearchExpansion = this._generateM2MExpansionForSearch();

    return `-- SEARCH operation for ${this.tableName}
CREATE OR REPLACE FUNCTION search_${this.tableName}(
  p_user_id INT,
  p_filters JSONB DEFAULT '{}',
  p_search TEXT DEFAULT NULL,
  p_sort JSONB DEFAULT NULL,
  p_page INT DEFAULT 1,
  p_limit INT DEFAULT 25
) RETURNS JSONB AS $$
DECLARE
  v_data JSONB;
  v_total INT;
  v_offset INT;
  v_sort_field TEXT;
  v_sort_order TEXT;
  v_where_clause TEXT := 'TRUE';
  v_field TEXT;
  v_filter JSONB;
  v_operator TEXT;
  v_value JSONB;
BEGIN
  v_offset := (p_page - 1) * p_limit;

  -- Extract sort parameters
  v_sort_field := COALESCE(p_sort->>'field', '${this.entity.labelField}');
  v_sort_order := COALESCE(p_sort->>'order', 'asc');

  -- Build WHERE clause from filters
  FOR v_field, v_filter IN SELECT * FROM jsonb_each(p_filters)
  LOOP
    -- Handle simple value (exact match)
    IF jsonb_typeof(v_filter) IN ('string', 'number', 'boolean') THEN
      v_where_clause := v_where_clause || format(' AND %I = %L', v_field, v_filter #>> '{}');
    ELSE
      -- Handle operator-based filters
      FOR v_operator, v_value IN SELECT * FROM jsonb_each(v_filter)
      LOOP
        CASE v_operator
          WHEN 'eq' THEN
            v_where_clause := v_where_clause || format(' AND %I = %L', v_field, v_value #>> '{}');
          WHEN 'ne' THEN
            v_where_clause := v_where_clause || format(' AND %I != %L', v_field, v_value #>> '{}');
          WHEN 'gt' THEN
            v_where_clause := v_where_clause || format(' AND %I > %L', v_field, v_value #>> '{}');
          WHEN 'gte' THEN
            v_where_clause := v_where_clause || format(' AND %I >= %L', v_field, v_value #>> '{}');
          WHEN 'lt' THEN
            v_where_clause := v_where_clause || format(' AND %I < %L', v_field, v_value #>> '{}');
          WHEN 'lte' THEN
            v_where_clause := v_where_clause || format(' AND %I <= %L', v_field, v_value #>> '{}');
          WHEN 'in' THEN
            v_where_clause := v_where_clause || format(' AND %I = ANY(%L::TEXT[])', v_field,
              (SELECT array_agg(value #>> '{}') FROM jsonb_array_elements(v_value) AS value));
          WHEN 'ilike' THEN
            v_where_clause := v_where_clause || format(' AND %I ILIKE %L', v_field, v_value #>> '{}');
          WHEN 'like' THEN
            v_where_clause := v_where_clause || format(' AND %I LIKE %L', v_field, v_value #>> '{}');
          ELSE
            -- Unknown operator, skip
        END CASE;
      END LOOP;
    END IF;
  END LOOP;

  -- Add search condition
  IF p_search IS NOT NULL THEN
    v_where_clause := v_where_clause || ' AND (${searchConditions})';
  END IF;

  -- Add temporal filter
  v_where_clause := v_where_clause || '${this._generateTemporalFilter().replace(/\n/g, ' ')}';

  -- Get total count
  EXECUTE format('SELECT COUNT(*) FROM ${this.tableName} WHERE %s', v_where_clause) INTO v_total;

  -- Get data
  EXECUTE format('
    SELECT COALESCE(jsonb_agg(${m2mSearchExpansion.selectExpression} ORDER BY %I %s), ''[]''::jsonb)
    FROM ${this.tableName} t${m2mSearchExpansion.lateralJoins}
    WHERE %s
    LIMIT %L OFFSET %L
  ', v_sort_field, v_sort_order, v_where_clause, p_limit, v_offset) INTO v_data;

${filterSensitiveFieldsArray}

  RETURN jsonb_build_object(
    'data', v_data,
    'total', v_total,
    'page', p_page,
    'limit', p_limit
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;`;
  }

  /**
   * Generate M2M variable declarations
   * COMPILE TIME: Loop to generate static variable declarations
   * RUNTIME: No loops, just variables
   * @private
   */
  _generateM2MVariableDeclarations() {
    const manyToMany = this.entity.manyToMany || {};
    if (Object.keys(manyToMany).length === 0) return '';

    const declarations = [];

    // COMPILE TIME LOOP: Generate separate variable for each M2M relationship
    for (const [relationKey, config] of Object.entries(manyToMany)) {
      const idField = config.id_field;
      declarations.push(`  v_${idField} INT[];  -- M2M: ${relationKey}`);
    }

    return declarations.join('\n');
  }

  /**
   * Generate M2M extraction logic
   * COMPILE TIME: Loop to generate code
   * RUNTIME: Separate IF blocks (NO loops!)
   * @private
   */
  _generateM2MExtraction() {
    const manyToMany = this.entity.manyToMany || {};
    if (Object.keys(manyToMany).length === 0) return '';

    const extractions = [];

    // COMPILE TIME LOOP: Generate separate extraction block for each M2M
    for (const [relationKey, config] of Object.entries(manyToMany)) {
      const idField = config.id_field;

      // Each M2M gets its own static IF block (no runtime loops!)
      extractions.push(`
  -- Extract M2M field: ${idField} (${relationKey})
  IF p_data ? '${idField}' THEN
    v_${idField} := ARRAY(SELECT jsonb_array_elements_text(p_data->'${idField}')::int);
    p_data := p_data - '${idField}';  -- Remove from data (not a table column)
  END IF;`);
    }

    return extractions.join('');
  }

  /**
   * Generate M2M junction table sync logic
   * COMPILE TIME: Loop to generate code
   * RUNTIME: Direct SQL execution (NO loops!)
   * @private
   */
  _generateM2MSync() {
    const manyToMany = this.entity.manyToMany || {};
    if (Object.keys(manyToMany).length === 0) return '';

    const syncs = [];

    // COMPILE TIME LOOP: Generate separate sync block for EACH relationship
    for (const [relationKey, config] of Object.entries(manyToMany)) {
      const idField = config.id_field;
      const junctionTable = config.junction_table;
      const localKey = config.local_key;
      const foreignKey = config.foreign_key;

      // Static SQL - all names known at compile time!
      syncs.push(`
  -- ============================================================================
  -- M2M Sync: ${relationKey} (junction: ${junctionTable})
  -- ============================================================================
  IF v_${idField} IS NOT NULL THEN
    -- Delete relationships not in new list
    DELETE FROM ${junctionTable}
    WHERE ${localKey} = v_result.id
      AND (${foreignKey} <> ALL(v_${idField}) OR v_${idField} = '{}');

    -- Insert new relationships (idempotent)
    IF array_length(v_${idField}, 1) > 0 THEN
      INSERT INTO ${junctionTable} (${localKey}, ${foreignKey})
      SELECT v_result.id, unnest(v_${idField})
      ON CONFLICT (${localKey}, ${foreignKey}) DO NOTHING;
    END IF;
  END IF;`);
    }

    return syncs.join('');
  }

  /**
   * Generate M2M expansion in output (for SAVE function)
   * COMPILE TIME: Loop to generate code
   * RUNTIME: Direct SQL queries (NO loops!)
   * Expands M2M fields into v_output BEFORE event creation (for real-time notifications)
   * @private
   */
  _generateM2MExpansion() {
    const manyToMany = this.entity.manyToMany || {};
    if (Object.keys(manyToMany).length === 0) return '';

    const expansions = [];

    // COMPILE TIME LOOP: Generate code for each M2M relationship
    for (const [relationKey, config] of Object.entries(manyToMany)) {
      const idField = config.id_field;
      const junctionTable = config.junction_table;
      const localKey = config.local_key;
      const foreignKey = config.foreign_key;
      const targetEntity = config.target_entity;
      const expand = config.expand || false;

      // Always add ID array (static SQL) - use v_result.id since v_output is v_result as jsonb
      expansions.push(`
  -- Add M2M IDs: ${idField}
  v_output := v_output || jsonb_build_object('${idField}',
    (SELECT COALESCE(jsonb_agg(${foreignKey} ORDER BY ${foreignKey}), '[]'::jsonb)
     FROM ${junctionTable} WHERE ${localKey} = v_result.id)
  );`);

      // Conditionally expand full objects (known at compile time!)
      if (expand) {
        expansions.push(`
  -- Expand M2M objects: ${relationKey} (expand=true)
  v_output := v_output || jsonb_build_object('${relationKey}',
    (SELECT COALESCE(jsonb_agg(to_jsonb(t.*) ORDER BY t.id), '[]'::jsonb)
     FROM ${junctionTable} jt
     JOIN ${targetEntity} t ON t.id = jt.${foreignKey}
     WHERE jt.${localKey} = v_result.id)
  );`);
      }
    }

    return expansions.join('');
  }

  /**
   * Generate M2M expansion for SEARCH operation
   * COMPILE TIME: Loop to generate LATERAL joins
   * RUNTIME: Static joins (NO loops!)
   * @private
   */
  _generateM2MExpansionForSearch() {
    const manyToMany = this.entity.manyToMany || {};

    if (Object.keys(manyToMany).length === 0) {
      return {
        lateralJoins: '',
        selectExpression: 'to_jsonb(t.*)'
      };
    }

    const lateralJoins = [];
    const mergeExpressions = [];

    // COMPILE TIME LOOP: Generate LATERAL join for each M2M relationship
    for (const [relationKey, config] of Object.entries(manyToMany)) {
      const idField = config.id_field;
      const junctionTable = config.junction_table;
      const localKey = config.local_key;
      const foreignKey = config.foreign_key;
      const targetEntity = config.target_entity;
      const expand = config.expand || false;

      // LATERAL join for ID array (static SQL)
      lateralJoins.push(`
    LEFT JOIN LATERAL (
      SELECT COALESCE(jsonb_agg(${foreignKey} ORDER BY ${foreignKey}), ''''[]''''::jsonb) as ${idField}
      FROM ${junctionTable}
      WHERE ${localKey} = t.id
    ) m2m_${idField} ON true`);

      mergeExpressions.push(`jsonb_build_object(''''${idField}'''', m2m_${idField}.${idField})`);

      // Optionally expand full objects
      if (expand) {
        lateralJoins.push(`
    LEFT JOIN LATERAL (
      SELECT COALESCE(jsonb_agg(to_jsonb(target.*) ORDER BY target.id), ''''[]''''::jsonb) as ${relationKey}
      FROM ${junctionTable} jt
      JOIN ${targetEntity} target ON target.id = jt.${foreignKey}
      WHERE jt.${localKey} = t.id
    ) m2m_${relationKey} ON true`);

        mergeExpressions.push(`jsonb_build_object(''''${relationKey}'''', m2m_${relationKey}.${relationKey})`);
      }
    }

    // Build the select expression that merges M2M fields
    const selectExpression = mergeExpressions.length > 0
      ? `to_jsonb(t.*) || ${mergeExpressions.join(' || ')}`
      : 'to_jsonb(t.*)';

    return {
      lateralJoins: lateralJoins.join(''),
      selectExpression
    };
  }

  /**
   * Generate M2M expansion for GET operation
   * COMPILE TIME: Loop to generate code
   * RUNTIME: Direct SQL queries (NO loops!)
   * @private
   */
  _generateM2MExpansionForGet() {
    const manyToMany = this.entity.manyToMany || {};
    if (Object.keys(manyToMany).length === 0) return '';

    const expansions = [];

    // COMPILE TIME LOOP: Generate code for each M2M relationship
    for (const [relationKey, config] of Object.entries(manyToMany)) {
      const idField = config.id_field;
      const junctionTable = config.junction_table;
      const localKey = config.local_key;
      const foreignKey = config.foreign_key;
      const targetEntity = config.target_entity;
      const expand = config.expand || false;

      // Always add ID array (static SQL)
      expansions.push(`
  -- Add M2M IDs: ${idField}
  v_result := v_result || jsonb_build_object('${idField}',
    (SELECT COALESCE(jsonb_agg(${foreignKey} ORDER BY ${foreignKey}), '[]'::jsonb)
     FROM ${junctionTable} WHERE ${localKey} = v_record.id)
  );`);

      // Conditionally expand full objects (known at compile time!)
      if (expand) {
        expansions.push(`
  -- Expand M2M objects: ${relationKey} (expand=true)
  v_result := v_result || jsonb_build_object('${relationKey}',
    (SELECT COALESCE(jsonb_agg(to_jsonb(t.*) ORDER BY t.id), '[]'::jsonb)
     FROM ${junctionTable} jt
     JOIN ${targetEntity} t ON t.id = jt.${foreignKey}
     WHERE jt.${localKey} = v_record.id)
  );`);
      }
    }

    return expansions.join('');
  }

  /**
   * Generate FK expansions for GET
   * @private
   */
  _generateFKExpansions() {
    if (!this.entity.fkIncludes || Object.keys(this.entity.fkIncludes).length === 0) {
      return '';
    }

    const expansions = [];

    for (const [key, targetTable] of Object.entries(this.entity.fkIncludes)) {
      if (key === targetTable) {
        // Reverse FK: child array
        expansions.push(`
  -- Expand ${key} (child array)
  v_result := v_result || jsonb_build_object(
    '${key}',
    (SELECT COALESCE(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb)
     FROM ${targetTable} t
     WHERE t.${this._singularize(this.tableName)}_id = v_record.id)
  );`);
      } else {
        // Direct FK: single object
        const fkField = key.endsWith('_id') ? key : key + '_id';
        expansions.push(`
  -- Expand ${key} (foreign key)
  IF v_record.${fkField} IS NOT NULL THEN
    v_result := v_result || jsonb_build_object(
      '${key}',
      (SELECT to_jsonb(t.*) FROM ${targetTable} t WHERE t.id = v_record.${fkField})
    );
  END IF;`);
      }
    }

    return expansions.join('');
  }

  /**
   * Generate temporal filter
   * @private
   */
  _generateTemporalFilter() {
    if (!this.entity.temporalFields || Object.keys(this.entity.temporalFields).length === 0) {
      return '';
    }

    const validFrom = this.entity.temporalFields.valid_from || 'valid_from';
    const validTo = this.entity.temporalFields.valid_to || 'valid_to';

    return `
    AND ${validFrom} <= COALESCE(p_on_date, NOW())
    AND (${validTo} > COALESCE(p_on_date, NOW()) OR ${validTo} IS NULL)`;
  }

  /**
   * Check if a trigger has any rules with actions
   * @private
   */
  _hasGraphRuleActions(trigger) {
    const rules = this.entity.graphRules[trigger];
    if (!rules || typeof rules !== 'object') {
      return false;
    }

    // Check if any rule has actions
    for (const ruleConfig of Object.values(rules)) {
      if (ruleConfig && ruleConfig.actions) {
        const actions = Array.isArray(ruleConfig.actions)
          ? ruleConfig.actions
          : [ruleConfig.actions];
        if (actions.length > 0) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Generate graph rules call
   * @private
   */
  _generateGraphRulesCall(operation = null) {
    if (!this.entity.graphRules || Object.keys(this.entity.graphRules).length === 0) {
      return '';
    }

    // For DELETE operation
    if (operation === 'delete') {
      if (this._hasGraphRuleActions('on_delete')) {
        return `
  -- Execute graph rules: on_delete
  PERFORM _graph_${this.tableName}_on_delete(p_user_id, to_jsonb(v_result));`;
      }
      return '';
    }

    // For SAVE operation (create/update)
    const calls = [];

    if (this._hasGraphRuleActions('on_create')) {
      calls.push(`
  -- Execute graph rules: on_create (if insert)
  IF v_is_insert THEN
    PERFORM _graph_${this.tableName}_on_create(p_user_id, to_jsonb(v_result));
  END IF;`);
    }

    if (this._hasGraphRuleActions('on_update')) {
      calls.push(`
  -- Execute graph rules: on_update (if update)
  IF NOT v_is_insert THEN
    PERFORM _graph_${this.tableName}_on_update(p_user_id, to_jsonb(v_existing), to_jsonb(v_result));
  END IF;`);
    }

    return calls.join('');
  }

  /**
   * Generate notification SQL
   * @private
   */
  _generateNotificationSQL(operation = 'save') {
    const hasNotificationPaths = this.entity.notificationPaths && Object.keys(this.entity.notificationPaths).length > 0;

    if (operation === 'save') {
      return `
  -- Resolve notification recipients (use v_output with M2M fields!)
  ${hasNotificationPaths ? `v_notify_users := _resolve_notification_paths_${this.tableName}(p_user_id, v_output);` : 'v_notify_users := ARRAY[]::INT[];'}

  -- Create event for real-time notifications (v_output includes M2M fields!)
  INSERT INTO dzql.events (
    table_name,
    op,
    pk,
    before,
    after,
    user_id,
    notify_users
  ) VALUES (
    '${this.tableName}',
    CASE WHEN v_is_insert THEN 'insert' ELSE 'update' END,
    jsonb_build_object('id', v_result.id),
    CASE WHEN NOT v_is_insert THEN to_jsonb(v_existing) ELSE NULL END,
    v_output,
    p_user_id,
    v_notify_users
  );`;
    } else if (operation === 'delete') {
      return `
  -- Resolve notification recipients
  ${hasNotificationPaths ? `v_notify_users := _resolve_notification_paths_${this.tableName}(p_user_id, to_jsonb(v_result));` : 'v_notify_users := ARRAY[]::INT[];'}

  -- Create event for real-time notifications
  INSERT INTO dzql.events (
    table_name,
    op,
    pk,
    before,
    after,
    user_id,
    notify_users
  ) VALUES (
    '${this.tableName}',
    'delete',
    jsonb_build_object('id', v_result.id),
    to_jsonb(v_result),
    NULL,
    p_user_id,
    v_notify_users
  );`;
    }

    return '';
  }

  /**
   * Generate INSERT columns
   * @private
   */
  _generateInsertColumns() {
    // This is a simplified version - in reality, would introspect table schema
    return "SELECT string_agg(quote_ident(key), ', ') FROM jsonb_object_keys(p_data) key";
  }

  /**
   * Generate INSERT values
   * @private
   */
  _generateInsertValues() {
    return "SELECT string_agg(quote_literal(value), ', ') FROM jsonb_each_text(p_data) kv(key, value)";
  }

  /**
   * Generate UPDATE SET clause
   * @private
   */
  _generateUpdateSet() {
    return `SELECT string_agg(quote_ident(key) || ' = ' || quote_literal(value), ', ')
      FROM jsonb_each_text(p_data) kv(key, value)
      WHERE key != 'id'`;
  }

  /**
   * Simple singularization (remove trailing 's')
   * @private
   */
  _singularize(word) {
    return word.endsWith('s') ? word.slice(0, -1) : word;
  }

  /**
   * Generate SQL to filter out sensitive fields from a JSONB variable
   * @param {string} varName - Name of the JSONB variable to filter (default: v_result)
   * @private
   */
  _generateSensitiveFieldFilter(varName = 'v_result') {
    return `
  -- Remove sensitive fields (password_hash, etc.) from result
  ${varName} := ${varName} - 'password_hash' - 'password' - 'secret' - 'token';`;
  }

  /**
   * Generate SQL to filter out sensitive fields from array of JSONB objects
   * @private
   */
  _generateSensitiveFieldFilterArray() {
    return `
  -- Remove sensitive fields from each record in the array
  v_data := (
    SELECT jsonb_agg(elem - 'password_hash' - 'password' - 'secret' - 'token')
    FROM jsonb_array_elements(v_data) elem
  );`;
  }
}

/**
 * Generate all operation functions for an entity
 * @param {Object} entity - Entity configuration
 * @returns {string} SQL for all operations
 */
export function generateOperations(entity) {
  const codegen = new OperationCodegen(entity);
  return codegen.generateAll();
}
