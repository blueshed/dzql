/**
 * Field Defaults Runtime Tests
 *
 * Tests that field defaults are actually applied at runtime:
 * - @user_id resolves to current user
 * - @now resolves to current timestamp
 * - @today resolves to current date
 * - Literal values are inserted
 * - Defaults only applied on INSERT (not UPDATE)
 * - Explicit values override defaults
 *
 * Contract: TEST_CONTRACT.md Section 5
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { setupTests, createTestUser, testName } from "../setup/test-helpers.js";

const { sql } = setupTests();

describe("Field Defaults (Generic Mode)", () => {
  let testUserId;

  beforeAll(async () => {
    // Create schema with various default-able fields
    await sql`DROP TABLE IF EXISTS tasks CASCADE`;
    await sql`
      CREATE TABLE tasks (
        id serial PRIMARY KEY,
        title text NOT NULL,
        owner_id int,
        created_by int,
        created_at timestamptz,
        due_date date,
        status text,
        priority int
      )
    `;

    // Register entity with field defaults
    await sql`
      SELECT dzql.register_entity(
        'tasks',
        'title',
        array['title'],
        '{}',
        false,
        '{}',
        '{}',
        jsonb_build_object(
          'view', array[]::text[],
          'create', array[]::text[],
          'update', array[]::text[],
          'delete', array[]::text[]
        ),
        '{}',
        jsonb_build_object(
          'owner_id', '@user_id',
          'created_by', '@user_id',
          'created_at', '@now',
          'due_date', '@today',
          'status', 'pending',
          'priority', '3'
        )
      )
    `;

    const user = await createTestUser(sql);
    testUserId = user.user_id;
  });

  test("@user_id resolves to current user", async () => {
    const task = await sql`
      SELECT dzql.save_tasks(${sql.json({
        title: testName("Task"),
      })}, ${testUserId}) as task
    `;

    expect(task[0].task.owner_id).toBe(testUserId);
    expect(task[0].task.created_by).toBe(testUserId);
  });

  test("@now resolves to current timestamp", async () => {
    const task = await sql`
      SELECT dzql.save_tasks(${sql.json({
        title: testName("TimestampTask"),
      })}, ${testUserId}) as task
    `;

    expect(task[0].task.created_at).not.toBeNull();
  });

  test("@today resolves to current date", async () => {
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

    const task = await sql`
      SELECT dzql.save_tasks(${sql.json({
        title: testName("DateTask"),
      })}, ${testUserId}) as task
    `;

    expect(task[0].task.due_date).toBe(today);
  });

  test("Literal string value is applied", async () => {
    const task = await sql`
      SELECT dzql.save_tasks(${sql.json({
        title: testName("StatusTask"),
      })}, ${testUserId}) as task
    `;

    expect(task[0].task.status).toBe("pending");
  });

  test("Literal number value is applied", async () => {
    const task = await sql`
      SELECT dzql.save_tasks(${sql.json({
        title: testName("PriorityTask"),
      })}, ${testUserId}) as task
    `;

    expect(task[0].task.priority).toBe(3);
  });

  test("Explicit value overrides default", async () => {
    const customUserId = 999;
    const customDate = "2025-12-31";

    const task = await sql`
      SELECT dzql.save_tasks(${sql.json({
        title: testName("CustomTask"),
        owner_id: customUserId,
        due_date: customDate,
        status: "in-progress",
        priority: 1,
      })}, ${testUserId}) as task
    `;

    expect(task[0].task.owner_id).toBe(customUserId);
    expect(task[0].task.due_date).toBe(customDate);
    expect(task[0].task.status).toBe("in-progress");
    expect(task[0].task.priority).toBe(1);
  });

  test("Defaults NOT applied on UPDATE", async () => {
    // Create task with defaults
    const created = await sql`
      SELECT dzql.save_tasks(${sql.json({
        title: testName("UpdateTask"),
      })}, ${testUserId}) as task
    `;
    const taskId = created[0].task.id;
    const originalOwnerId = created[0].task.owner_id;
    const originalCreatedAt = created[0].task.created_at;

    // Wait a bit to ensure timestamp would be different if re-applied
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Update the task
    const updated = await sql`
      SELECT dzql.save_tasks(${sql.json({
        id: taskId,
        title: "Updated Title",
      })}, ${testUserId}) as task
    `;

    // Defaults should NOT be re-applied
    expect(updated[0].task.owner_id).toBe(originalOwnerId);
    expect(updated[0].task.created_at).toBe(originalCreatedAt);
  });

  test("All defaults applied together", async () => {
    const task = await sql`
      SELECT dzql.save_tasks(${sql.json({
        title: testName("AllDefaultsTask"),
      })}, ${testUserId}) as task
    `;

    // All defaults should be present
    expect(task[0].task.owner_id).toBe(testUserId);
    expect(task[0].task.created_by).toBe(testUserId);
    expect(task[0].task.created_at).toBeDefined();
    expect(task[0].task.due_date).toBeDefined();
    expect(task[0].task.status).toBe("pending");
    expect(task[0].task.priority).toBe(3);
  });

  test("Partial explicit values with remaining defaults", async () => {
    const task = await sql`
      SELECT dzql.save_tasks(${sql.json({
        title: testName("MixedTask"),
        status: "urgent", // Override this default
        // Other defaults should still apply
      })}, ${testUserId}) as task
    `;

    expect(task[0].task.status).toBe("urgent"); // Explicit
    expect(task[0].task.owner_id).toBe(testUserId); // Default
    expect(task[0].task.priority).toBe(3); // Default
  });
});
