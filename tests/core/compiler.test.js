import { test, expect, describe } from "bun:test";
import { DZQLCompiler } from "../../packages/dzql/src/compiler/compiler.js";
import { EntityParser } from "../../packages/dzql/src/compiler/parser/entity-parser.js";
import { PathParser } from "../../packages/dzql/src/compiler/parser/path-parser.js";

describe("EntityParser", () => {
  test("parses simple register_entity call", () => {
    const parser = new EntityParser();
    const sql = `
      select dzql.register_entity(
        'todos',
        'title',
        array['title', 'description'],
        '{}',
        false
      );
    `;

    const entity = parser.parseFromSQL(sql);

    expect(entity.tableName).toBe("todos");
    expect(entity.labelField).toBe("title");
    expect(entity.searchableFields).toEqual(["title", "description"]);
    expect(entity.fkIncludes).toEqual({});
    expect(entity.softDelete).toBe(false);
  });

  test("parses jsonb_build_object parameters", () => {
    const parser = new EntityParser();
    const sql = `
      select dzql.register_entity(
        'venues',
        'name',
        array['name', 'address'],
        '{"org": "organisations"}',
        false,
        '{}',
        jsonb_build_object('ownership', array['@org_id->acts_for[org_id=$]{active}.user_id']),
        jsonb_build_object('view', array[]::text[], 'update', array['@org_id'])
      );
    `;

    const entity = parser.parseFromSQL(sql);

    expect(entity.tableName).toBe("venues");
    expect(entity.notificationPaths).toHaveProperty("ownership");
    expect(entity.permissionPaths).toHaveProperty("view");
    expect(entity.permissionPaths).toHaveProperty("update");
  });
});

describe("PathParser", () => {
  test("parses direct field reference", () => {
    const parser = new PathParser();
    const ast = parser.parse("@owner_id");

    expect(ast.type).toBe("direct_field");
    expect(ast.field).toBe("owner_id");
  });

  test("parses simple traversal", () => {
    const parser = new PathParser();
    const ast = parser.parse("@org_id->acts_for.user_id");

    expect(ast.type).toBe("traversal");
    expect(ast.steps.length).toBeGreaterThan(0);
    expect(ast.steps[0].type).toBe("field_ref");
  });

  test("parses traversal with filter", () => {
    const parser = new PathParser();
    const ast = parser.parse("@org_id->acts_for[org_id=$]{active}.user_id");

    expect(ast.type).toBe("traversal");
    expect(ast.steps[1].type).toBe("table_ref");
    expect(ast.steps[1].table).toBe("acts_for");
    expect(ast.steps[1].filter).toBeDefined();
    // Filter should have at least one condition
    expect(ast.steps[1].filter.length).toBeGreaterThan(0);
  });

  test("parses multiple paths", () => {
    const parser = new PathParser();
    const paths = ["@owner_id", "@org_id->acts_for[org_id=$]{active}.user_id"];

    const asts = parser.parseMultiple(paths);

    expect(asts).toHaveLength(2);
    expect(asts[0].type).toBe("direct_field");
    expect(asts[1].type).toBe("traversal");
  });
});

describe("DZQLCompiler", () => {
  test("compiles simple entity", () => {
    const compiler = new DZQLCompiler();

    const entity = {
      tableName: "todos",
      labelField: "title",
      searchableFields: ["title", "description"],
      permissionPaths: {
        view: [], // Public
        create: ["@owner_id"],
        update: ["@owner_id"],
        delete: ["@owner_id"],
      },
    };

    const result = compiler.compile(entity);

    expect(result.tableName).toBe("todos");
    expect(result.sql).toContain("CREATE OR REPLACE FUNCTION get_todos");
    expect(result.sql).toContain("CREATE OR REPLACE FUNCTION save_todos");
    expect(result.sql).toContain("CREATE OR REPLACE FUNCTION delete_todos");
    expect(result.sql).toContain("CREATE OR REPLACE FUNCTION lookup_todos");
    expect(result.sql).toContain("CREATE OR REPLACE FUNCTION search_todos");
    expect(result.checksum).toBeDefined();
    expect(result.checksum).toHaveLength(64); // SHA-256
  });

  test("generates permission functions", () => {
    const compiler = new DZQLCompiler();

    const entity = {
      tableName: "posts",
      labelField: "title",
      searchableFields: ["title"],
      permissionPaths: {
        view: [], // Public access
        update: ["@author_id"],
      },
    };

    const result = compiler.compile(entity);

    expect(result.sql).toContain("can_view_posts");
    expect(result.sql).toContain("can_update_posts");
    expect(result.sql).toContain("RETURN true;  -- Public access");
  });

  test("generates FK expansions", () => {
    const compiler = new DZQLCompiler();

    const entity = {
      tableName: "venues",
      labelField: "name",
      searchableFields: ["name"],
      fkIncludes: {
        org: "organisations",
        sites: "sites",
      },
    };

    const result = compiler.compile(entity);

    expect(result.sql).toContain("-- Expand org (foreign key)");
    expect(result.sql).toContain("-- Expand sites (child array)");
    expect(result.sql).toContain("FROM organisations t WHERE t.id = v_fk_id");
    expect(result.sql).toContain("FROM sites t");
  });

  test("generates temporal filtering", () => {
    const compiler = new DZQLCompiler();

    const entity = {
      tableName: "acts_for",
      labelField: "user_id",
      searchableFields: ["user_id"],
      temporalFields: {
        valid_from: "valid_from",
        valid_to: "valid_to",
      },
    };

    const result = compiler.compile(entity);

    expect(result.sql).toContain("valid_from");
    expect(result.sql).toContain("valid_to");
    expect(result.sql).toContain("COALESCE(p_on_date, NOW())");
  });

  test("checksum is deterministic", () => {
    // Disable header comments which include timestamps that change between calls
    const compiler = new DZQLCompiler({ includeComments: false });

    const entity = {
      tableName: "todos",
      labelField: "title",
      searchableFields: ["title"],
    };

    const result1 = compiler.compile(entity);
    const result2 = compiler.compile(entity);

    expect(result1.checksum).toBe(result2.checksum);
  });

  test("compileFromSQL parses multiple entities", () => {
    const compiler = new DZQLCompiler();

    const sql = `
      select dzql.register_entity('todos', 'title', array['title'], '{}', false);
      select dzql.register_entity('posts', 'title', array['title'], '{}', false);
    `;

    const result = compiler.compileFromSQL(sql);

    expect(result.summary.total).toBe(2);
    expect(result.summary.successful).toBe(2);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].tableName).toBe("todos");
    expect(result.results[1].tableName).toBe("posts");
  });
});

test("does not generate graph function calls when graph_rules is empty", () => {
  const compiler = new DZQLCompiler();

  const entity = {
    tableName: "events",
    labelField: "title",
    searchableFields: ["title", "description"],
    fkIncludes: { resource: "resources" },
    softDelete: false,
    graphRules: {}, // Empty graph rules
    notificationPaths: { ownership: ["@owner_id"] },
    permissionPaths: {
      view: [],
      create: [],
      update: ["@owner_id"],
      delete: ["@owner_id"],
    },
  };

  const result = compiler.compile(entity);

  // Should NOT contain graph function calls when graph_rules is empty
  expect(result.sql).not.toContain("_graph_events_on_create");
  expect(result.sql).not.toContain("_graph_events_on_update");
  expect(result.sql).not.toContain("_graph_events_on_delete");

  // Should still contain the save function
  expect(result.sql).toContain("CREATE OR REPLACE FUNCTION save_events");

  // Should NOT contain PERFORM calls to graph functions
  expect(result.sql).not.toContain("PERFORM _graph_events_on_create(");
  expect(result.sql).not.toContain("PERFORM _graph_events_on_update(");
  expect(result.sql).not.toContain("PERFORM _graph_events_on_delete(");
});

test("handles null and undefined configuration fields gracefully", () => {
  const compiler = new DZQLCompiler();

  const entity = {
    tableName: "minimal",
    labelField: "name",
    searchableFields: ["name"],
    // Test with various empty/null/undefined values
    fkIncludes: null,
    temporalFields: undefined,
    notificationPaths: {},
    permissionPaths: {},
    graphRules: null,
  };

  const result = compiler.compile(entity);

  // Should compile successfully
  expect(result.tableName).toBe("minimal");
  expect(result.sql).toContain("CREATE OR REPLACE FUNCTION get_minimal");
  expect(result.sql).toContain("CREATE OR REPLACE FUNCTION save_minimal");

  // Should not have any graph function calls
  expect(result.sql).not.toContain("_graph_minimal_");

  // Should still have permission functions (they're always generated)
  expect(result.sql).toContain("can_view_minimal");
  expect(result.sql).toContain("can_create_minimal");
});

test("generates graph function calls only when graph_rules has actions", () => {
  const compiler = new DZQLCompiler();

  const entity = {
    tableName: "tasks",
    labelField: "title",
    searchableFields: ["title"],
    graphRules: {
      on_create: {
        notify_owner: {
          description: "Notify owner of new task",
          actions: [
            {
              type: "execute",
              function: "notify_user",
              params: { user_id: "@owner_id", message: "New task created" },
            },
          ],
        },
      },
    },
    permissionPaths: {
      view: [],
      create: [],
      update: ["@owner_id"],
      delete: ["@owner_id"],
    },
  };

  const result = compiler.compile(entity);

  // SHOULD contain graph function when rules have actions
  expect(result.sql).toContain(
    "CREATE OR REPLACE FUNCTION _graph_tasks_on_create",
  );
  expect(result.sql).toContain("PERFORM _graph_tasks_on_create(");

  // Should NOT contain on_update or on_delete since they weren't defined
  expect(result.sql).not.toContain("_graph_tasks_on_update");
  expect(result.sql).not.toContain("_graph_tasks_on_delete");
});

describe("Graph Rules", () => {
  test("generates notify actions in graph rules", () => {
    const compiler = new DZQLCompiler();

    const entity = {
      tableName: "posts",
      labelField: "title",
      searchableFields: ["title", "content"],
      fkIncludes: { author: "users" },
      permissionPaths: {
        view: [],
        create: [],
        update: ["@author_id"],
        delete: ["@author_id"],
      },
      graphRules: {
        on_create: {
          notify_followers: {
            description: "Notify author followers",
            actions: [
              {
                type: "notify",
                users: ["@author_id"],
                message: "New post created",
                data: { post_id: "@id" },
              },
            ],
          },
        },
      },
      fieldDefaults: {
        author_id: "@user_id",
        created_at: "@now",
        status: "draft",
      },
    };

    const result = compiler.compile(entity);

    // Check for notify action SQL generation
    expect(result.sql).toContain("INSERT INTO dzql.events");
    expect(result.sql).toContain("notify_users");

    // Check for graph function generation
    expect(result.sql).toContain("_graph_posts_on_create");
  });

  test("generates condition evaluation with @before/@after variables", () => {
    const compiler = new DZQLCompiler();

    const entity = {
      tableName: "posts",
      labelField: "title",
      searchableFields: ["title"],
      permissionPaths: {
        view: [],
        create: [],
        update: ["@author_id"],
        delete: ["@author_id"],
      },
      graphRules: {
        on_update: {
          notify_on_publish: {
            description: "Notify when status changes to published",
            condition:
              "@before.status != @after.status AND @after.status = 'published'",
            actions: [
              {
                type: "notify",
                users: ["@author_id"],
                message: "Post published",
              },
            ],
          },
        },
      },
    };

    const result = compiler.compile(entity);

    // Check for condition evaluation code with p_old_record and p_new_record
    expect(result.sql).toContain("p_old_record->>'status'");
    expect(result.sql).toContain("p_new_record->>'status'");
    expect(result.sql).toContain("IF");
    expect(result.sql).toContain("_graph_posts_on_update");
  });

  test("supports complex user paths in notify actions", () => {
    const compiler = new DZQLCompiler();

    const entity = {
      tableName: "posts",
      labelField: "title",
      searchableFields: ["title"],
      permissionPaths: {
        view: [],
        create: [],
        update: [],
        delete: [],
      },
      graphRules: {
        on_update: {
          notify_followers: {
            description: "Notify followers via complex path",
            actions: [
              {
                type: "notify",
                users: ["@author_id->users.followers"],
                message: "Post updated",
              },
            ],
          },
        },
      },
    };

    const result = compiler.compile(entity);

    // Check for resolve_notification_path call for complex paths
    expect(result.sql).toContain("resolve_notification_path");
  });
});

describe("Field Defaults", () => {
  test("generates field defaults with custom field references", () => {
    const compiler = new DZQLCompiler();

    const entity = {
      tableName: "resources",
      labelField: "name",
      searchableFields: ["name"],
      permissionPaths: {
        view: [],
        create: [],
        update: [],
        delete: [],
      },
      fieldDefaults: {
        owner_id: "@user_id",
        created_by: "@user_id",
        created_at: "@now",
        modified_by: "@created_by", // References another field
        status: "draft",
      },
    };

    const result = compiler.compile(entity);

    // Check for field reference resolution
    expect(result.sql).toContain("p_data->>'created_by'");

    // Check for built-in variables
    expect(result.sql).toContain("p_user_id");
    expect(result.sql).toContain("NOW()");
  });

  test("generates built-in variable field defaults", () => {
    const compiler = new DZQLCompiler();

    const entity = {
      tableName: "tasks",
      labelField: "title",
      searchableFields: ["title"],
      permissionPaths: {
        view: [],
        create: [],
        update: [],
        delete: [],
      },
      fieldDefaults: {
        created_by: "@user_id",
        created_at: "@now",
        due_date: "@today",
      },
    };

    const result = compiler.compile(entity);

    // Check for variable substitution
    expect(result.sql).toContain("p_user_id");
    expect(result.sql).toContain("NOW()");
    expect(result.sql).toContain("CURRENT_DATE");
  });
});

describe("Permission Paths", () => {
  test("generates temporal filtering with {active} marker", () => {
    const compiler = new DZQLCompiler();

    const entity = {
      tableName: "venues",
      labelField: "name",
      searchableFields: ["name"],
      fkIncludes: { org: "organisations" },
      permissionPaths: {
        view: [],
        create: ["@org_id->acts_for[org_id=$]{active}.user_id"],
        update: ["@org_id->acts_for[org_id=$]{active}.user_id"],
        delete: ["@org_id->acts_for[org_id=$]{active}.user_id"],
      },
    };

    const result = compiler.compile(entity);

    // Check for temporal filtering
    expect(result.sql).toContain("valid_from");
    expect(result.sql).toContain("valid_to");

    // Check for proper temporal conditions
    expect(result.sql).toContain("valid_from <= NOW()");
    expect(result.sql).toContain("valid_to > NOW()");
    expect(result.sql).toContain("valid_to IS NULL");
  });
});

describe("Integration tests", () => {
  test("can compile venues domain", () => {
    const compiler = new DZQLCompiler();

    const venuesSQL = `
      select dzql.register_entity(
        'venues',
        'name',
        array['name', 'address', 'description'],
        '{"org": "organisations", "sites": "sites"}',
        false,
        '{}',
        jsonb_build_object(
          'ownership', array['@org_id->acts_for[org_id=$]{active}.user_id']
        ),
        jsonb_build_object(
          'create', array['@org_id->acts_for[org_id=$]{active}.user_id'],
          'update', array['@org_id->acts_for[org_id=$]{active}.user_id'],
          'delete', array['@org_id->acts_for[org_id=$]{active}.user_id'],
          'view', array[]::text[]
        )
      );
    `;

    const result = compiler.compileFromSQL(venuesSQL);

    expect(result.summary.successful).toBe(1);
    expect(result.results[0].tableName).toBe("venues");

    const sql = result.results[0].sql;

    // Check all operations are generated
    expect(sql).toContain("CREATE OR REPLACE FUNCTION get_venues");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION save_venues");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION delete_venues");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION lookup_venues");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION search_venues");

    // Check permission functions
    expect(sql).toContain("CREATE OR REPLACE FUNCTION can_create_venues");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION can_update_venues");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION can_delete_venues");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION can_view_venues");

    // Check FK expansions
    expect(sql).toContain("Expand org");
    expect(sql).toContain("Expand sites");

    // Check notification resolution
    expect(sql).toContain("resolve_notification_paths_venues");
  });
});

describe("Composite Primary Keys", () => {
  test("parses primary_key from graphRules", () => {
    const parser = new EntityParser();
    const entity = parser.parseFromObject({
      tableName: "product_task_template_dependencies",
      labelField: "template_id",
      primaryKey: ["template_id", "depends_on_template_id"],
    });

    expect(entity.primaryKey).toEqual([
      "template_id",
      "depends_on_template_id",
    ]);
  });

  test("defaults primaryKey to ['id'] when not specified", () => {
    const parser = new EntityParser();
    const entity = parser.parseFromObject({
      tableName: "todos",
      labelField: "title",
    });

    expect(entity.primaryKey).toEqual(["id"]);
  });

  test("generates composite primary key in event pk field", () => {
    const compiler = new DZQLCompiler();

    const entity = {
      tableName: "product_task_template_dependencies",
      labelField: "template_id",
      searchableFields: [],
      primaryKey: ["template_id", "depends_on_template_id"],
      permissionPaths: {
        view: [],
        create: [],
        update: [],
        delete: [],
      },
    };

    const result = compiler.compile(entity);

    // Check that the pk field uses composite primary key
    expect(result.sql).toContain(
      "jsonb_build_object('template_id', v_result.template_id, 'depends_on_template_id', v_result.depends_on_template_id)",
    );

    // Should NOT contain the old hardcoded 'id' pattern for pk
    expect(result.sql).not.toContain("jsonb_build_object('id', v_result.id)");
  });

  test("generates simple primary key when only one column", () => {
    const compiler = new DZQLCompiler();

    const entity = {
      tableName: "todos",
      labelField: "title",
      searchableFields: ["title"],
      primaryKey: ["id"],
      permissionPaths: {
        view: [],
        create: [],
        update: [],
        delete: [],
      },
    };

    const result = compiler.compile(entity);

    // Check that single-column pk still works
    expect(result.sql).toContain("jsonb_build_object('id', v_result.id)");
  });

  test("generates composite pk in graph rules notify action", () => {
    const compiler = new DZQLCompiler();

    const entity = {
      tableName: "product_task_template_dependencies",
      labelField: "template_id",
      searchableFields: [],
      primaryKey: ["template_id", "depends_on_template_id"],
      permissionPaths: {
        view: [],
        create: [],
        update: [],
        delete: [],
      },
      graphRules: {
        on_create: {
          notify_on_create: {
            description: "Notify on dependency creation",
            actions: [
              {
                type: "notify",
                users: ["@created_by"],
                message: "Dependency created",
              },
            ],
          },
        },
      },
    };

    const result = compiler.compile(entity);

    // Check that graph rules also use composite pk
    expect(result.sql).toContain(
      "jsonb_build_object('template_id', (p_record->>'template_id')::int, 'depends_on_template_id', (p_record->>'depends_on_template_id')::int)",
    );
  });

  test("parses primary_key from SQL graphRules", () => {
    const compiler = new DZQLCompiler();

    const sql = `
      select dzql.register_entity(
        'product_task_template_dependencies',
        'template_id',
        array[]::text[],
        '{}',
        false,
        '{}',
        '{}',
        '{}',
        jsonb_build_object(
          'primary_key', array['template_id', 'depends_on_template_id']
        )
      );
    `;

    const result = compiler.compileFromSQL(sql);

    expect(result.summary.successful).toBe(1);

    const compiledSQL = result.results[0].sql;

    // Check that composite pk is used
    expect(compiledSQL).toContain(
      "jsonb_build_object('template_id', v_result.template_id, 'depends_on_template_id', v_result.depends_on_template_id)",
    );
  });

  test("generates composite pk GET function with JSONB parameter", () => {
    const compiler = new DZQLCompiler();

    const entity = {
      tableName: "product_task_template_dependencies",
      labelField: "template_id",
      searchableFields: [],
      primaryKey: ["template_id", "depends_on_template_id"],
      permissionPaths: {
        view: [],
        create: [],
        update: [],
        delete: [],
      },
    };

    const result = compiler.compile(entity);

    // Check GET function signature uses p_pk JSONB instead of p_id INT
    expect(result.sql).toContain(
      "CREATE OR REPLACE FUNCTION get_product_task_template_dependencies(",
    );
    expect(result.sql).toContain("p_pk JSONB");
    expect(result.sql).not.toMatch(
      /get_product_task_template_dependencies\([^)]*p_id INT/,
    );

    // Check WHERE clause uses composite key
    expect(result.sql).toContain("template_id = (p_pk->>'template_id')::int");
    expect(result.sql).toContain(
      "depends_on_template_id = (p_pk->>'depends_on_template_id')::int",
    );
  });

  test("generates composite pk DELETE function with JSONB parameter", () => {
    const compiler = new DZQLCompiler();

    const entity = {
      tableName: "product_task_template_dependencies",
      labelField: "template_id",
      searchableFields: [],
      primaryKey: ["template_id", "depends_on_template_id"],
      permissionPaths: {
        view: [],
        create: [],
        update: [],
        delete: [],
      },
    };

    const result = compiler.compile(entity);

    // Check DELETE function signature uses p_pk JSONB instead of p_id INT
    expect(result.sql).toContain(
      "CREATE OR REPLACE FUNCTION delete_product_task_template_dependencies(",
    );
    expect(result.sql).toContain("p_pk JSONB");
    expect(result.sql).not.toMatch(
      /delete_product_task_template_dependencies\([^)]*p_id INT/,
    );

    // Check WHERE clause uses composite key
    expect(result.sql).toContain(
      "template_id = (p_pk->>'template_id')::int AND depends_on_template_id = (p_pk->>'depends_on_template_id')::int",
    );
  });

  test("simple pk entities still use p_id INT for backwards compatibility", () => {
    const compiler = new DZQLCompiler();

    const entity = {
      tableName: "todos",
      labelField: "title",
      searchableFields: ["title"],
      primaryKey: ["id"],
      permissionPaths: {
        view: [],
        create: [],
        update: [],
        delete: [],
      },
    };

    const result = compiler.compile(entity);

    // Check GET function uses p_id INT
    expect(result.sql).toMatch(/get_todos\(\s*p_user_id INT,\s*p_id INT/);

    // Check DELETE function uses p_id INT
    expect(result.sql).toMatch(/delete_todos\(\s*p_user_id INT,\s*p_id INT/);

    // Should use WHERE id = p_id
    expect(result.sql).toContain("WHERE id = p_id");
  });
});
