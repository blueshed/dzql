# DZQL

**The AI-First Database Framework.**

> DZQL is a new kind of framework for a new era of development. It's built on a simple, powerful idea: the developer is the **Architect**, and your AI assistant is the **Coder**. You design the "what," and the AI, powered by DZQL, handles the "how."

---

I'm a programmer who started in 1974. For decades, I knew that moving business logic into the database via stored procedures was the ideal for creating robust, high-performance applications. But the complexity of doing so was always a barrier.

Until now.

AI assistants are now capable of writing the complex, performant SQL that was once the exclusive domain of database experts. DZQL is a framework designed from the ground up for this new reality. It provides the structure, guardrails, and runtime engine to allow a human architect and an AI coder to build powerful, real-time applications with unprecedented speed and reliability.

## The Core Workflow

Building with DZQL is a three-step dance between you, your AI, and the framework.

#### 1. You, The Architect
You define your application's domain and rules in plain terms. You focus on the high-level structure, relationships, and permissions.

> **Your Goal:** "I need a `posts` table for a blog. Users can create their own posts. Editors can view all posts. When a post is updated, everyone viewing it should see the changes in real-time."

#### 2. Your AI, The Coder
You instruct your AI assistant to implement this domain using the DZQL framework. The AI's job is to translate your architectural vision into a precise `dzql.register_entity` call.

> **The AI's Output:**
> ```sql
> SELECT dzql.register_entity(
>   'posts',
>   'title',
>   array['title', 'content'],
>   '{}'::jsonb,
>   false,
>   '{}'::jsonb,
>   jsonb_build_object(
>     'owner', array['@user_id'],
>     'editors', array['@user_id->users[role=''editor''].id']
>   ),
>   jsonb_build_object(
>     'view', array['@user_id', '@user_id->users[role=''editor''].id'],
>     'create', array['@user_id'],
>     'update', array['@user_id'],
>     'delete', array['@user_id']
>   ),
>   '{}'::jsonb
> );
> ```

#### 3. DZQL, The Engine
DZQL takes that registration and instantly brings it to life. It provides the runtime, the WebSocket server, and the API that powers your application. No boilerplate, no resolvers, no manual endpoint creation.

---

## The Engine's Features

When your AI registers an entity with DZQL, it unlocks a powerful set of features that you get for free:

✅ **The 5 Operations**: `get`, `save`, `delete`, `lookup`, and `search` are instantly available for every entity.  
✅ **Real-time by Default**: Any database change is automatically and securely broadcast over WebSockets to the correct users.  
✅ **Declarative Row-Level Security**: Permissions are defined as simple, readable paths and are enforced automatically on every query.  
✅ **Atomic Transactions**: Business logic, data changes, and notifications are handled in a single, atomic database transaction, eliminating entire classes of bugs.  
✅ **PostgreSQL Native**: Full access to the power, reliability, and performance of PostgreSQL.  
✅ **Extensible**: Add custom business logic with standard PostgreSQL functions or server-side JavaScript for when you need to call external APIs or perform complex tasks.

---

## For the Human Architect

Your journey starts here. This documentation provides the conceptual overview you need to direct your AI.

*   **[Getting Started Tutorial](packages/dzql/docs/getting-started/tutorial.md)**: A step-by-step tutorial to set up your first DZQL project.
*   **[Documentation Hub](packages/dzql/docs/)**: Complete user documentation, guides, and reference.
*   **Example Applications**:
    *   **[Streaks](packages/streaks/domain.md)**: A social habit-tracking app.
    *   **[Venues](packages/venues/)**: A venue management system.

## For the AI Coder

This section contains the dense, precise technical details needed for code generation. Provide the relevant links to your AI assistant.

*   **[Claude Guide](packages/dzql/docs/for-ai/claude-guide.md)**: Complete guide for AI-assisted DZQL development.
*   **[API Reference](packages/dzql/docs/reference/api.md)**: The complete API reference, including the `dzql.register_entity` function signature and all available operations.
*   **[Permission Path DSL Grammar](docs/architecture/PERMISSIONS.md)**: The complete syntax for defining permission paths.
*   **[Database Schema & Migrations](packages/dzql/src/database/migrations/)**: The core database schema that DZQL builds upon.

---

## Project Info

> 🚧 **Pre-1.0 Release** - API is stabilizing but may still change.

*   **License**: [MIT](LICENSE)
*   **Issues**: [GitHub Issues](https://github.com/blueshed/dzql/issues)
*   **Roadmap**: [Project Roadmap](docs/architecture/ROADMAP.md)
*   **Changelog**: [Release History](CHANGELOG.md)
*   **Contributing**: [Contribution Guidelines](CONTRIBUTING.md)

**Ready to build the future?** Start with the [Getting Started Guide](packages/dzql/docs/getting-started/tutorial.md) 🚀