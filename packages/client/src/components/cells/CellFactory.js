/**
 * Cell Factory - Determines the appropriate cell renderer based on metadata
 *
 * Analyzes column schema and returns the best cell component for display/editing
 */

/**
 * Detect if column represents geographic coordinates
 */
export function isCoordinateColumn(columnName, dataType) {
  const name = columnName.toLowerCase()
  return (
    (name.includes('lat') || name.includes('lng') ||
     name.includes('lon') || name.includes('coordinate')) &&
    (dataType === 'numeric' || dataType === 'double precision' || dataType === 'real')
  )
}

/**
 * Detect if column is a foreign key
 */
export function isForeignKey(columnName, relations, entityName) {
  return relations.some(rel =>
    rel.type === 'many_to_one' &&
    rel.from === `${entityName}.${columnName}`
  )
}

/**
 * Get the referenced entity for a foreign key
 */
export function getReferencedEntity(columnName, relations, entityName) {
  const relation = relations.find(rel =>
    rel.type === 'many_to_one' &&
    rel.from === `${entityName}.${columnName}`
  )
  return relation ? relation.to.split('.')[0] : null
}

/**
 * Determine cell type based on metadata
 */
export function getCellType(column, relations, entityName) {
  const { column_name, data_type, is_nullable } = column

  // Check for foreign key first
  if (isForeignKey(column_name, relations, entityName)) {
    return {
      type: 'foreign-key',
      component: 'ForeignKeyCell',
      referencedEntity: getReferencedEntity(column_name, relations, entityName)
    }
  }

  // Check for coordinates
  if (isCoordinateColumn(column_name, data_type)) {
    return {
      type: 'coordinate',
      component: 'CoordinateCell'
    }
  }

  // Check data type
  switch (data_type) {
    case 'boolean':
      return {
        type: 'boolean',
        component: 'BooleanCell'
      }

    case 'date':
    case 'timestamp':
    case 'timestamp without time zone':
    case 'timestamp with time zone':
      return {
        type: 'date',
        component: 'DateCell'
      }

    case 'integer':
    case 'bigint':
    case 'smallint':
    case 'numeric':
    case 'decimal':
    case 'real':
    case 'double precision':
      return {
        type: 'number',
        component: 'NumberCell'
      }

    case 'json':
    case 'jsonb':
      return {
        type: 'json',
        component: 'JSONCell'
      }

    case 'text':
    case 'character varying':
    case 'varchar':
    case 'char':
    default:
      // Check for long text
      if (data_type === 'text' || column.character_maximum_length > 100) {
        return {
          type: 'textarea',
          component: 'TextAreaCell'
        }
      }

      return {
        type: 'text',
        component: 'TextCell'
      }
  }
}
