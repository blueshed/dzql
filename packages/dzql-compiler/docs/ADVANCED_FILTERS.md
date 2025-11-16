# Advanced SEARCH Filters

The compiled SEARCH functions support powerful JSONB-based filtering with multiple operators.

## Filter Operators

### Comparison Operators

**Equal (`eq`)** - Exact match
```json
{ "status": { "eq": "active" } }
```
or simplified:
```json
{ "status": "active" }
```

**Not Equal (`ne`)** - Exclude values
```json
{ "status": { "ne": "deleted" } }
```

**Greater Than (`gt`)**
```json
{ "age": { "gt": 18 } }
```

**Greater Than or Equal (`gte`)**
```json
{ "age": { "gte": 18 } }
```

**Less Than (`lt`)**
```json
{ "created_at": { "lt": "2024-01-01" } }
```

**Less Than or Equal (`lte`)**
```json
{ "price": { "lte": 100 } }
```

### Array Membership

**In (`in`)** - Match any value in array
```json
{ "status": { "in": ["active", "pending", "review"] } }
```

### Pattern Matching

**Case-Insensitive Like (`ilike`)** - PostgreSQL pattern matching
```json
{ "email": { "ilike": "%@gmail.com" } }
```

**Like (`like`)** - Case-sensitive pattern matching
```json
{ "code": { "like": "PRD-%" } }
```

## Combining Multiple Filters

You can combine multiple filters on different fields:

```json
{
  "age": { "gte": 18, "lte": 65 },
  "status": { "in": ["active", "pending"] },
  "email": { "ilike": "%@company.com" }
}
```

You can also apply multiple operators to the same field:

```json
{
  "age": { "gte": 18, "lt": 65 }
}
```

## Example Usage

### Simple equality filter
```javascript
const result = await sql`
  SELECT search_users(
    p_filters := '{"status": "active"}'::jsonb,
    p_page := 1,
    p_limit := 25
  )
`;
```

### Age range filter
```javascript
const result = await sql`
  SELECT search_users(
    p_filters := '{"age": {"gte": 18, "lte": 65}}'::jsonb
  )
`;
```

### Multiple status filter
```javascript
const result = await sql`
  SELECT search_orders(
    p_filters := '{"status": {"in": ["pending", "processing", "shipped"]}}'::jsonb
  )
`;
```

### Email domain filter with text search
```javascript
const result = await sql`
  SELECT search_users(
    p_filters := '{"email": {"ilike": "%@company.com"}}'::jsonb,
    p_search := 'john',
    p_sort := '{"field": "created_at", "order": "desc"}'::jsonb
  )
`;
```

### Complex combined filters
```javascript
const result = await sql`
  SELECT search_products(
    p_filters := '{
      "price": {"gte": 10, "lte": 100},
      "category": {"in": ["electronics", "accessories"]},
      "status": "active",
      "name": {"ilike": "%wireless%"}
    }'::jsonb,
    p_page := 1,
    p_limit := 50
  )
`;
```

## Generated SQL

The filters are converted to optimized SQL WHERE conditions:

```sql
-- Input filters:
{ "age": {"gte": 18}, "status": {"in": ["active", "pending"]} }

-- Generated WHERE clause:
WHERE TRUE
  AND age >= '18'
  AND status = ANY(ARRAY['active', 'pending']::TEXT[])
```

## Performance Considerations

1. **Index your filter fields** - Create indexes on frequently filtered columns:
   ```sql
   CREATE INDEX idx_users_status ON users(status);
   CREATE INDEX idx_users_age ON users(age);
   ```

2. **Use exact matches when possible** - `eq` is faster than `ilike`

3. **Limit ILIKE patterns** - Patterns starting with `%` can't use indexes efficiently

4. **Combine with pagination** - Always use `p_limit` to avoid loading large result sets

## Type Safety

The filter system is type-aware and handles:
- **Strings** - Quoted and escaped properly
- **Numbers** - Cast appropriately
- **Booleans** - Converted to SQL boolean values
- **Dates** - Handled as timestamp comparisons
- **Arrays** - Expanded for `IN` clauses

## Error Handling

Unknown operators are silently ignored to prevent SQL injection. Only these operators are supported:
- `eq`, `ne`
- `gt`, `gte`, `lt`, `lte`
- `in`
- `like`, `ilike`
