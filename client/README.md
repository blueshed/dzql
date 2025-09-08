# ZeroQL Client - Search Filtering Guide

The ZeroQL client provides a powerful search interface that demonstrates all the advanced filtering capabilities of the ZeroQL search API.

## Quick Start

1. Start the server: `bun run server/index.js`
2. Open the client: `http://localhost:3000`
3. Login with test credentials
4. Navigate to the Search Operations section

## Search Interface Components

### 1. Entity Selector
Choose which entity type to search:
- Venues
- Products
- Organisations
- Users

### 2. Text Search
The text search field uses the `_search` parameter to search across all searchable fields defined for the entity.

### 3. Filter Builder
Add multiple filters with the "+ Add Filter" button. Each filter has:
- **Field**: The column name to filter on
- **Operator**: The comparison operator
- **Value**: The value to compare against

### 4. Sorting
- **Sort Field**: Enter the column name to sort by
- **Sort Order**: Choose ascending or descending

### 5. Pagination
- **Page**: Current page number (starts at 1)
- **Limit**: Results per page (1-100)

### 6. Temporal Queries
- **On Date**: Optional date for temporal filtering of relationships

## Filter Operators

| Operator | Description | Example Value | SQL Equivalent |
|----------|-------------|---------------|----------------|
| Equals (=) | Exact match | `New York` | `= 'New York'` |
| Not Equals (≠) | Not equal to | `100` | `!= 100` |
| Greater Than (>) | Greater than value | `1000` | `> 1000` |
| Greater or Equal (≥) | Greater than or equal | `500` | `>= 500` |
| Less Than (<) | Less than value | `2000` | `< 2000` |
| Less or Equal (≤) | Less than or equal | `1500` | `<= 1500` |
| Between | Value in range | `100, 500` | `BETWEEN 100 AND 500` |
| Like | Pattern match | `%Garden%` | `LIKE '%Garden%'` |
| Case-insensitive Like | Case-insensitive pattern | `%center%` | `ILIKE '%center%'` |
| IN (array) | Value in list | `1, 2, 3` | `IN (1, 2, 3)` |
| NOT IN | Value not in list | `4, 5` | `NOT IN (4, 5)` |
| IS NULL | Field is null | (leave empty) | `IS NULL` |
| IS NOT NULL | Field is not null | (leave empty) | `IS NOT NULL` |

## Example Queries

The interface includes quick example buttons to demonstrate common search patterns:

### Expensive Products
- Entity: Products
- Filter: price > 2000
- Shows all products priced above $2000

### Brooklyn Venues
- Entity: Venues
- Text Search: "brooklyn"
- Finds all venues with "brooklyn" in any searchable field

### LED Products
- Entity: Products
- Text Search: "LED"
- Filter: description IS NOT NULL
- Finds products with "LED" in searchable fields that have descriptions

### Price Range
- Entity: Products
- Filter: price BETWEEN 500, 2000
- Shows products in the $500-$2000 range

## Building Complex Queries

You can combine multiple filters for complex queries:

1. **Multiple Filters**: All filters are combined with AND logic
2. **Text Search + Filters**: Combine text search with specific field filters
3. **Sorting + Pagination**: Sort results and navigate through pages

### Example Complex Query
```javascript
api.search.products({
  filters: {
    _search: "LED",                    // Text search
    price: { gte: 100, lt: 3000 },    // Price range
    description: { not_null: true },   // Has description
    org_id: [1, 2, 3]                  // From specific orgs
  },
  sort: { field: "price", order: "asc" },
  page: 1,
  limit: 25
})
```

## Response Format

The search results are displayed in a table format with:
- **Statistics**: Total results, current page, items shown
- **Table View**: All fields for each matching record
- **Pagination Info**: Navigate between pages of results

### Response Structure
```javascript
{
  data: [...],   // Array of matching records
  total: 100,    // Total count before pagination
  page: 1,       // Current page number
  limit: 50      // Results per page
}
```

## Error Handling

The interface handles errors gracefully:

### Invalid Column Names
If you enter a column name that doesn't exist, the server returns a clear error message:
```
Column invalid_column does not exist in table venues
```

### Invalid Operators
Invalid operators are silently ignored and don't affect the query.

### Empty Results
When no results match your filters, the interface shows "No results found".

## Tips for Effective Searching

1. **Start Broad**: Begin with text search or simple filters
2. **Refine Gradually**: Add more specific filters to narrow results
3. **Use Examples**: Click example buttons to see filter patterns
4. **Check Preview**: The API call preview shows the exact query structure
5. **Test Operators**: Try different operators to understand their behavior

## Technical Details

### WebSocket Communication
All searches go through the WebSocket connection using the ZeroQL proxy API:
```javascript
ws.api.search[entity](params)
```

### Real-time Updates
Search operations may trigger real-time events if other users are modifying data.

### Performance
- Searches are optimized with database indexes
- Pagination prevents loading too much data at once
- Column validation happens server-side for security

## Troubleshooting

### No Results
- Check your filters aren't too restrictive
- Verify column names are correct
- Ensure you're searching the right entity

### Connection Issues
- Verify the server is running
- Check you're logged in
- Refresh the page if WebSocket disconnects

### Slow Searches
- Use pagination with smaller limits
- Add specific filters instead of broad text search
- Sort by indexed columns when possible