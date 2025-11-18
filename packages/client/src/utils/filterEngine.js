/**
 * Filter engine for applying filter conditions to records
 */

/**
 * Apply a single filter condition to a record
 */
function applyCondition(record, filter) {
  const value = record[filter.field]
  const filterValue = filter.value

  switch (filter.operator) {
    // Text operators
    case 'contains':
      return value != null && String(value).toLowerCase().includes(String(filterValue).toLowerCase())

    case 'not_contains':
      return value == null || !String(value).toLowerCase().includes(String(filterValue).toLowerCase())

    case 'equals':
      return value == filterValue || String(value) === String(filterValue)

    case 'not_equals':
      return value != filterValue && String(value) !== String(filterValue)

    case 'starts_with':
      return value != null && String(value).toLowerCase().startsWith(String(filterValue).toLowerCase())

    case 'ends_with':
      return value != null && String(value).toLowerCase().endsWith(String(filterValue).toLowerCase())

    case 'is_empty':
      return value == null || value === '' || value === undefined

    case 'is_not_empty':
      return value != null && value !== '' && value !== undefined

    // Number operators
    case 'greater_than':
      return Number(value) > Number(filterValue)

    case 'greater_than_or_equal':
      return Number(value) >= Number(filterValue)

    case 'less_than':
      return Number(value) < Number(filterValue)

    case 'less_than_or_equal':
      return Number(value) <= Number(filterValue)

    // Boolean operators
    case 'is_true':
      return value === true || value === 'true' || value === 1

    case 'is_false':
      return value === false || value === 'false' || value === 0 || value == null

    // Date operators
    case 'before':
      return value && filterValue && new Date(value) < new Date(filterValue)

    case 'after':
      return value && filterValue && new Date(value) > new Date(filterValue)

    default:
      console.warn(`Unknown operator: ${filter.operator}`)
      return true
  }
}

/**
 * Apply all filters to records with AND/OR logic
 */
export function applyFilters(records, filters) {
  if (!filters || filters.length === 0) {
    return records
  }

  return records.filter(record => {
    // Start with the first filter
    let result = applyCondition(record, filters[0])

    // Apply remaining filters with their logic operators
    for (let i = 1; i < filters.length; i++) {
      const filter = filters[i]
      const conditionResult = applyCondition(record, filter)

      if (filter.logic === 'OR') {
        result = result || conditionResult
      } else {
        // Default to AND
        result = result && conditionResult
      }
    }

    return result
  })
}

/**
 * Apply sorting to records
 */
export function applySorts(records, sorts) {
  if (!sorts || sorts.length === 0) {
    return records
  }

  return [...records].sort((a, b) => {
    for (const sort of sorts) {
      const aVal = a[sort.field]
      const bVal = b[sort.field]

      // Handle null/undefined
      if (aVal == null && bVal == null) continue
      if (aVal == null) return sort.direction === 'asc' ? 1 : -1
      if (bVal == null) return sort.direction === 'asc' ? -1 : 1

      // Compare values
      let comparison = 0
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        comparison = aVal.localeCompare(bVal)
      } else if (typeof aVal === 'number' && typeof bVal === 'number') {
        comparison = aVal - bVal
      } else if (aVal instanceof Date && bVal instanceof Date) {
        comparison = aVal.getTime() - bVal.getTime()
      } else {
        comparison = String(aVal).localeCompare(String(bVal))
      }

      if (comparison !== 0) {
        return sort.direction === 'asc' ? comparison : -comparison
      }
    }

    return 0
  })
}
