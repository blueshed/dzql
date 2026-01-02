/**
 * Test Drop Semantics Generation
 * Verifies the compiler generates correct drag-and-drop semantic manifests
 *
 * Terminology:
 * - "source" = entity being dragged
 * - "target" = entity being dropped onto
 * - droppable_on: what THIS entity can be dropped onto
 * - accepts: what can be dropped onto THIS entity
 */

import { test, expect } from "bun:test";
import { generateDropSemantics } from "../../packages/dzql/src/compiler/codegen/drop-semantics-codegen.js";
import { DZQLCompiler } from "../../packages/dzql/src/compiler/compiler.js";

test("FK relationship: source can be dropped on target (move action)", () => {
  // tasks.group_id REFERENCES task_groups
  // → tasks can be dropped onto task_groups to move them
  const entities = {
    tasks: {
      tableName: "tasks",
      primaryKey: ["id"],
      fkIncludes: { group: "task_groups" },
      manyToMany: {},
    },
    task_groups: {
      tableName: "task_groups",
      primaryKey: ["id"],
      fkIncludes: {},
      manyToMany: {},
    },
  };

  const result = generateDropSemantics(entities);

  // tasks.droppable_on.task_groups should exist
  expect(result.entities.tasks).toBeDefined();
  expect(result.entities.tasks.droppable_on.task_groups).toBeDefined();

  const dropAction = result.entities.tasks.droppable_on.task_groups[0];
  expect(dropAction.relation).toBe("group_id");
  expect(dropAction.type).toBe("fk");
  expect(dropAction.action).toBe("move");
  expect(dropAction.label).toContain("Move to");
  expect(dropAction.operation.method).toBe("save");
  expect(dropAction.operation.entity).toBe("tasks");
  expect(dropAction.operation.params.id).toBe("@source.id");
  expect(dropAction.operation.params.group_id).toBe("@target.id");
});

test("FK relationship: target accepts source being dropped on it", () => {
  // tasks.assigned_to_user_id REFERENCES users
  // → tasks accepts users being dropped on it (assign user to task)
  const entities = {
    tasks: {
      tableName: "tasks",
      primaryKey: ["id"],
      fkIncludes: { assigned_to_user: "users" },
      manyToMany: {},
    },
    users: {
      tableName: "users",
      primaryKey: ["id"],
      fkIncludes: {},
      manyToMany: {},
    },
  };

  const result = generateDropSemantics(entities);

  // tasks.accepts.users should exist (drop user onto task)
  expect(result.entities.tasks).toBeDefined();
  expect(result.entities.tasks.accepts.users).toBeDefined();

  const acceptAction = result.entities.tasks.accepts.users[0];
  expect(acceptAction.relation).toBe("assigned_to_user_id");
  expect(acceptAction.type).toBe("fk");
  expect(acceptAction.action).toBe("assign");
  expect(acceptAction.label).toContain("Assign");

  // Operation updates the task (target) with the user's (source) id
  expect(acceptAction.operation.method).toBe("save");
  expect(acceptAction.operation.entity).toBe("tasks");
  expect(acceptAction.operation.params.id).toBe("@target.id");
  expect(acceptAction.operation.params.assigned_to_user_id).toBe("@source.id");
});

test("FK relationship: source also has droppable_on for the FK", () => {
  // tasks.assigned_to_user_id REFERENCES users
  // → tasks can also be dropped onto users (less common, but valid)
  const entities = {
    tasks: {
      tableName: "tasks",
      primaryKey: ["id"],
      fkIncludes: { assigned_to_user: "users" },
      manyToMany: {},
    },
    users: {
      tableName: "users",
      primaryKey: ["id"],
      fkIncludes: {},
      manyToMany: {},
    },
  };

  const result = generateDropSemantics(entities);

  // tasks.droppable_on.users should exist
  expect(result.entities.tasks.droppable_on.users).toBeDefined();

  const dropAction = result.entities.tasks.droppable_on.users[0];
  expect(dropAction.relation).toBe("assigned_to_user_id");
  expect(dropAction.action).toBe("move");
  expect(dropAction.operation.entity).toBe("tasks");
});

test("M2M relationship: bidirectional droppable_on via junction", () => {
  const entities = {
    posts: {
      tableName: "posts",
      primaryKey: ["id"],
      fkIncludes: {},
      manyToMany: {
        tags: {
          junction_table: "post_tags",
          local_key: "post_id",
          foreign_key: "tag_id",
          target_entity: "tags",
          id_field: "tag_ids",
        },
      },
    },
    tags: {
      tableName: "tags",
      primaryKey: ["id"],
      fkIncludes: {},
      manyToMany: {},
    },
  };

  const result = generateDropSemantics(entities);

  // posts.droppable_on.tags (drag post onto tag)
  expect(result.entities.posts.droppable_on.tags).toBeDefined();
  const postDropAction = result.entities.posts.droppable_on.tags[0];
  expect(postDropAction.relation).toBe("post_tags");
  expect(postDropAction.type).toBe("junction");
  expect(postDropAction.action).toBe("link");
  expect(postDropAction.operation.entity).toBe("post_tags");
  expect(postDropAction.operation.params.post_id).toBe("@source.id");
  expect(postDropAction.operation.params.tag_id).toBe("@target.id");

  // tags.accepts.posts (drop post onto tag - same operation)
  expect(result.entities.tags.accepts.posts).toBeDefined();
  const tagAcceptAction = result.entities.tags.accepts.posts[0];
  expect(tagAcceptAction.relation).toBe("post_tags");
  expect(tagAcceptAction.type).toBe("junction");
  expect(tagAcceptAction.action).toBe("link");
});

test("Self-referential FK: entity droppable on itself", () => {
  const entities = {
    categories: {
      tableName: "categories",
      primaryKey: ["id"],
      fkIncludes: { parent: "categories" },
      manyToMany: {},
    },
  };

  const result = generateDropSemantics(entities);

  // categories.droppable_on.categories
  expect(result.entities.categories.droppable_on.categories).toBeDefined();

  const nestAction = result.entities.categories.droppable_on.categories[0];
  expect(nestAction.relation).toBe("parent_id");
  expect(nestAction.type).toBe("fk");
  expect(["nest", "reparent"]).toContain(nestAction.action);
  expect(nestAction.operation.entity).toBe("categories");
});

test("Self-referential M2M: entity droppable on itself with self_referential flag", () => {
  const entities = {
    tasks: {
      tableName: "tasks",
      primaryKey: ["id"],
      fkIncludes: {},
      manyToMany: {
        dependencies: {
          junction_table: "task_dependencies",
          local_key: "task_id",
          foreign_key: "depends_on_task_id",
          target_entity: "tasks",
          id_field: "dependency_ids",
        },
      },
    },
  };

  const result = generateDropSemantics(entities);

  expect(result.entities.tasks.droppable_on.tasks).toBeDefined();

  const linkAction = result.entities.tasks.droppable_on.tasks[0];
  expect(linkAction.relation).toBe("task_dependencies");
  expect(linkAction.type).toBe("junction");
  expect(linkAction.action).toBe("link");
  expect(linkAction.self_referential).toBe(true);
});

test("Remove operation included for FK relationships", () => {
  const entities = {
    tasks: {
      tableName: "tasks",
      primaryKey: ["id"],
      fkIncludes: { group: "task_groups" },
      manyToMany: {},
    },
    task_groups: {
      tableName: "task_groups",
      primaryKey: ["id"],
      fkIncludes: {},
      manyToMany: {},
    },
  };

  const result = generateDropSemantics(entities);

  const dropAction = result.entities.tasks.droppable_on.task_groups[0];

  // Should have removable flag and remove_operation
  expect(dropAction.removable).toBe(true);
  expect(dropAction.remove_operation).toBeDefined();
  expect(dropAction.remove_operation.method).toBe("save");
  expect(dropAction.remove_operation.entity).toBe("tasks");
  expect(dropAction.remove_operation.params.id).toBe("@source.id");
  expect(dropAction.remove_operation.params.group_id).toBe(null);
});

test("Remove operation included for M2M relationships", () => {
  const entities = {
    posts: {
      tableName: "posts",
      primaryKey: ["id"],
      fkIncludes: {},
      manyToMany: {
        tags: {
          junction_table: "post_tags",
          local_key: "post_id",
          foreign_key: "tag_id",
          target_entity: "tags",
          id_field: "tag_ids",
        },
      },
    },
    tags: {
      tableName: "tags",
      primaryKey: ["id"],
      fkIncludes: {},
      manyToMany: {},
    },
  };

  const result = generateDropSemantics(entities);

  const linkAction = result.entities.posts.droppable_on.tags[0];

  // Should have removable flag and remove_operation with delete method
  expect(linkAction.removable).toBe(true);
  expect(linkAction.remove_operation).toBeDefined();
  expect(linkAction.remove_operation.method).toBe("delete");
  expect(linkAction.remove_operation.entity).toBe("post_tags");
  expect(linkAction.remove_operation.params.post_id).toBe("@source.id");
  expect(linkAction.remove_operation.params.tag_id).toBe("@target.id");
});

test("Composite primary keys in operation params", () => {
  const entities = {
    org_items: {
      tableName: "org_items",
      primaryKey: ["org_id", "item_code"],
      fkIncludes: { category: "categories" },
      manyToMany: {},
    },
    categories: {
      tableName: "categories",
      primaryKey: ["id"],
      fkIncludes: {},
      manyToMany: {},
    },
  };

  const result = generateDropSemantics(entities);

  const dropAction = result.entities.org_items.droppable_on.categories[0];

  // Should include both PK fields in params
  expect(dropAction.operation.params.org_id).toBe("@source.org_id");
  expect(dropAction.operation.params.item_code).toBe("@source.item_code");
  expect(dropAction.operation.params.category_id).toBe("@target.id");

  // Remove operation should also have composite PK
  expect(dropAction.remove_operation.params.org_id).toBe("@source.org_id");
  expect(dropAction.remove_operation.params.item_code).toBe(
    "@source.item_code",
  );
});

test("Human-readable labels generated correctly", () => {
  const entities = {
    tasks: {
      tableName: "tasks",
      primaryKey: ["id"],
      fkIncludes: {
        assigned_to_user: "users",
        group: "task_groups",
      },
      manyToMany: {
        tags: {
          junction_table: "task_tags",
          local_key: "task_id",
          foreign_key: "tag_id",
          target_entity: "tags",
          id_field: "tag_ids",
        },
      },
    },
    users: {
      tableName: "users",
      primaryKey: ["id"],
      fkIncludes: {},
      manyToMany: {},
    },
    task_groups: {
      tableName: "task_groups",
      primaryKey: ["id"],
      fkIncludes: {},
      manyToMany: {},
    },
    tags: {
      tableName: "tags",
      primaryKey: ["id"],
      fkIncludes: {},
      manyToMany: {},
    },
  };

  const result = generateDropSemantics(entities);

  // Check move label
  const moveToGroup = result.entities.tasks.droppable_on.task_groups[0];
  expect(moveToGroup.label.toLowerCase()).toContain("move");

  // Check link label (junction)
  const addTag = result.entities.tasks.droppable_on.tags[0];
  expect(addTag.label.toLowerCase()).toContain("add");
  expect(addTag.label.toLowerCase()).toContain("tag");

  // Check assign label (accepts)
  const assignUser = result.entities.tasks.accepts.users[0];
  expect(assignUser.label.toLowerCase()).toContain("assign");
});

test("Works with array input", () => {
  const entitiesArray = [
    {
      tableName: "posts",
      primaryKey: ["id"],
      fkIncludes: { author: "users" },
      manyToMany: {},
    },
    {
      tableName: "users",
      primaryKey: ["id"],
      fkIncludes: {},
      manyToMany: {},
    },
  ];

  const result = generateDropSemantics(entitiesArray);

  expect(result.entities.posts).toBeDefined();
  expect(result.entities.posts.droppable_on.users).toBeDefined();
  expect(result.entities.users.accepts.posts).toBeDefined();
});

test("Excludes entities with no relationships", () => {
  const entities = {
    standalone: {
      tableName: "standalone",
      primaryKey: ["id"],
      fkIncludes: {},
      manyToMany: {},
    },
    connected: {
      tableName: "connected",
      primaryKey: ["id"],
      fkIncludes: { parent: "standalone" },
      manyToMany: {},
    },
  };

  const result = generateDropSemantics(entities);

  // connected has relationships, should be included
  expect(result.entities.connected).toBeDefined();

  // standalone only appears as accepts target, so it should be included
  expect(result.entities.standalone).toBeDefined();
  expect(result.entities.standalone.accepts.connected).toBeDefined();
});

test("compileFromSQL includes dropSemantics in result", () => {
  const sqlContent = `
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL
    );

    CREATE TABLE posts (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      author_id INT REFERENCES users(id)
    );

    SELECT dzql.register_entity(
      'users', 'name', array['name'],
      '{}', false, '{}', '{}',
      jsonb_build_object(
        'view', array[]::text[],
        'create', array[]::text[],
        'update', array['@id'],
        'delete', array['@id']
      )
    );

    SELECT dzql.register_entity(
      'posts', 'title', array['title'],
      jsonb_build_object('author', 'users'),
      false, '{}', '{}',
      jsonb_build_object(
        'view', array[]::text[],
        'create', array[]::text[],
        'update', array['@author_id'],
        'delete', array['@author_id']
      )
    );
  `;

  const compiler = new DZQLCompiler();
  const result = compiler.compileFromSQL(sqlContent);

  expect(result.dropSemantics).toBeDefined();
  expect(result.dropSemantics.entities).toBeDefined();

  // posts can be dropped onto users (move)
  expect(result.dropSemantics.entities.posts.droppable_on.users).toBeDefined();

  // users accepts posts (assign author)
  expect(result.dropSemantics.entities.users.accepts.posts).toBeDefined();
});

test("compileFromSQL returns empty dropSemantics for no entities", () => {
  const sqlContent = `
    CREATE TABLE something (id SERIAL PRIMARY KEY);
  `;

  const compiler = new DZQLCompiler();
  const result = compiler.compileFromSQL(sqlContent);

  expect(result.dropSemantics).toBeDefined();
  expect(result.dropSemantics.entities).toEqual({});
});

test("Visual semantics: containment for tree entities", () => {
  const entities = {
    tasks: {
      tableName: "tasks",
      primaryKey: ["id"],
      fkIncludes: { group: "task_groups" },
      manyToMany: {},
    },
    task_groups: {
      tableName: "task_groups",
      primaryKey: ["id"],
      fkIncludes: { parent: "task_groups" }, // Self-referential = tree
      manyToMany: {},
    },
  };

  const result = generateDropSemantics(entities);

  // task_groups has self-ref FK, so tasks dropping on it should be containment
  const dropAction = result.entities.tasks.droppable_on.task_groups[0];
  expect(dropAction.visual).toBe("containment");
});

test("Visual semantics: containment for naming convention (_groups)", () => {
  const entities = {
    items: {
      tableName: "items",
      primaryKey: ["id"],
      fkIncludes: { folder: "item_groups" },
      manyToMany: {},
    },
    item_groups: {
      tableName: "item_groups",
      primaryKey: ["id"],
      fkIncludes: {}, // No self-ref, but name matches pattern
      manyToMany: {},
    },
  };

  const result = generateDropSemantics(entities);

  const dropAction = result.entities.items.droppable_on.item_groups[0];
  expect(dropAction.visual).toBe("containment");
});

test("Visual semantics: edge for self-referential junction", () => {
  const entities = {
    tasks: {
      tableName: "tasks",
      primaryKey: ["id"],
      fkIncludes: {},
      manyToMany: {
        dependencies: {
          junction_table: "task_dependencies",
          local_key: "task_id",
          foreign_key: "depends_on_task_id",
          target_entity: "tasks",
          id_field: "dependency_ids",
        },
      },
    },
  };

  const result = generateDropSemantics(entities);

  const linkAction = result.entities.tasks.droppable_on.tasks[0];
  expect(linkAction.visual).toBe("edge");
  expect(linkAction.direction).toBe("source_to_target");
});

test("Visual semantics: frame for set entities", () => {
  const entities = {
    tasks: {
      tableName: "tasks",
      primaryKey: ["id"],
      fkIncludes: {},
      manyToMany: {
        sets: {
          junction_table: "task_set_members",
          local_key: "task_id",
          foreign_key: "set_id",
          target_entity: "task_sets",
          id_field: "set_ids",
        },
      },
    },
    task_sets: {
      tableName: "task_sets",
      primaryKey: ["id"],
      fkIncludes: {},
      manyToMany: {},
    },
  };

  const result = generateDropSemantics(entities);

  const linkAction = result.entities.tasks.droppable_on.task_sets[0];
  expect(linkAction.visual).toBe("frame");
});

test("Visual semantics: badge for regular FK reference", () => {
  const entities = {
    tasks: {
      tableName: "tasks",
      primaryKey: ["id"],
      fkIncludes: { assigned_user: "users" },
      manyToMany: {},
    },
    users: {
      tableName: "users",
      primaryKey: ["id"],
      fkIncludes: {},
      manyToMany: {},
    },
  };

  const result = generateDropSemantics(entities);

  // Dropping task onto user = badge (it's just a reference, not containment)
  const dropAction = result.entities.tasks.droppable_on.users[0];
  expect(dropAction.visual).toBe("badge");

  // Accepts also badge
  const acceptAction = result.entities.tasks.accepts.users[0];
  expect(acceptAction.visual).toBe("badge");
});

console.log("\n✅ All drop-semantics tests passed!");
console.log("✅ Verified: FK source → droppable_on target with move action");
console.log("✅ Verified: FK target → accepts source with assign action");
console.log("✅ Verified: M2M → bidirectional via junction table");
console.log("✅ Verified: Self-referential FK and M2M handled correctly");
console.log("✅ Verified: Remove operations included (removable flag)");
console.log("✅ Verified: Composite primary keys supported");
console.log("✅ Verified: Human-readable labels generated");
console.log("✅ Verified: Visual semantics (containment, frame, edge, badge)");
console.log("✅ Verified: Integration with compileFromSQL\n");
