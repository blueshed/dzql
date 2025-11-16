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

    return `-- GET operation for ${this.tableName}
CREATE OR REPLACE FUNCTION get_${this.tableName}(
  p_id INT,
  p_user_id INT,
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

    return `-- SAVE operation for ${this.tableName}
CREATE OR REPLACE FUNCTION save_${this.tableName}(
  p_data JSONB,
  p_user_id INT
) RETURNS JSONB AS $$
DECLARE
  v_result ${this.tableName}%ROWTYPE;
  v_existing ${this.tableName}%ROWTYPE;
  v_is_insert BOOLEAN := false;
  v_notify_users INT[];
BEGIN
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
    INSERT INTO ${this.tableName} (
      ${this._generateInsertColumns()}
    ) VALUES (
      ${this._generateInsertValues()}
    ) RETURNING * INTO v_result;
  ELSE
    UPDATE ${this.tableName}
    SET ${this._generateUpdateSet()}
    WHERE id = (p_data->>'id')::int
    RETURNING * INTO v_result;
  END IF;

${graphRulesCall}
${notificationSQL}

  RETURN to_jsonb(v_result);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;`;
  }

  /**
   * Generate DELETE function
   */
  generateDeleteFunction() {
    const graphRulesCall = this._generateGraphRulesCall('delete');
    const notificationSQL = this._generateNotificationSQL();

    const deleteSQL = this.entity.softDelete
      ? `UPDATE ${this.tableName} SET deleted_at = NOW() WHERE id = p_id RETURNING * INTO v_result;`
      : `DELETE FROM ${this.tableName} WHERE id = p_id RETURNING * INTO v_result;`;

    return `-- DELETE operation for ${this.tableName}
CREATE OR REPLACE FUNCTION delete_${this.tableName}(
  p_id INT,
  p_user_id INT
) RETURNS JSONB AS $$
DECLARE
  v_result ${this.tableName}%ROWTYPE;
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

  RETURN to_jsonb(v_result);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;`;
  }

  /**
   * Generate LOOKUP function
   */
  generateLookupFunction() {
    return `-- LOOKUP operation for ${this.tableName}
CREATE OR REPLACE FUNCTION lookup_${this.tableName}(
  p_filter TEXT DEFAULT NULL,
  p_user_id INT DEFAULT NULL,
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

    return `-- SEARCH operation for ${this.tableName}
CREATE OR REPLACE FUNCTION search_${this.tableName}(
  p_filters JSONB DEFAULT '{}',
  p_search TEXT DEFAULT NULL,
  p_sort JSONB DEFAULT NULL,
  p_page INT DEFAULT 1,
  p_limit INT DEFAULT 25,
  p_user_id INT DEFAULT NULL
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
    SELECT COALESCE(jsonb_agg(to_jsonb(t.*) ORDER BY %I %s), ''[]''::jsonb)
    FROM ${this.tableName} t
    WHERE %s
    LIMIT %L OFFSET %L
  ', v_sort_field, v_sort_order, v_where_clause, p_limit, v_offset) INTO v_data;

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
   * Generate graph rules call
   * @private
   */
  _generateGraphRulesCall(operation = null) {
    if (!this.entity.graphRules || Object.keys(this.entity.graphRules).length === 0) {
      return '';
    }

    // For DELETE operation
    if (operation === 'delete') {
      if (this.entity.graphRules.on_delete) {
        return `
  -- Execute graph rules: on_delete
  PERFORM graph_${this.tableName}_on_delete(to_jsonb(v_result), p_user_id);`;
      }
      return '';
    }

    // For SAVE operation (create/update)
    const calls = [];

    if (this.entity.graphRules.on_create) {
      calls.push(`
  -- Execute graph rules: on_create (if insert)
  IF v_is_insert THEN
    PERFORM graph_${this.tableName}_on_create(to_jsonb(v_result), p_user_id);
  END IF;`);
    }

    if (this.entity.graphRules.on_update) {
      calls.push(`
  -- Execute graph rules: on_update (if update)
  IF NOT v_is_insert THEN
    PERFORM graph_${this.tableName}_on_update(to_jsonb(v_existing), to_jsonb(v_result), p_user_id);
  END IF;`);
    }

    return calls.join('');
  }

  /**
   * Generate notification SQL
   * @private
   */
  _generateNotificationSQL() {
    if (!this.entity.notificationPaths || Object.keys(this.entity.notificationPaths).length === 0) {
      return '';
    }

    return `
  -- Resolve notification recipients
  v_notify_users := resolve_notification_paths_${this.tableName}(to_jsonb(v_result));`;
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
