# DZQL Examples

SQL examples demonstrating DZQL entity registration patterns.

## Files

### blog.sql
A complete blog application with:
- Multiple entities (users, posts, comments, tags)
- Many-to-many relationships (posts ↔ tags)
- Soft delete
- FK includes
- Permission paths
- Notification paths

### venue-detail-simple.sql
Basic subscribable definition for venue data.

### venue-detail-subscribable.sql
Full subscribable with relations and permission paths. Demonstrates:
- Root entity with FK includes
- Child entity filtering
- Permission path syntax

## Usage

These files are meant to be run after DZQL core migrations. See the [Tutorial](../getting-started/tutorial.md) for complete setup instructions.

```bash
# After setting up your database with DZQL migrations
psql $DATABASE_URL < examples/blog.sql
```

## See Also

- [API Reference](../reference/api.md) - Entity registration parameters
- [Many-to-Many Guide](../guides/many-to-many.md) - M2M configuration
- [Subscriptions Guide](../guides/subscriptions.md) - Subscribable patterns
