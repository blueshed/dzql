/**
 * Soft Delete Tests
 *
 * Tests that soft delete works correctly:
 * - Sets deleted_at timestamp instead of removing row
 * - Deleted records excluded from search results
 * - Deleted records excluded from lookup
 * - Can still retrieve by ID for audit/recovery
 * - Hard delete when soft_delete=false
 *
 * Contract: TEST_CONTRACT.md Section 12
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { setupTests, createTestUser, testName } from "../setup/test-helpers.js";

const { sql } = setupTests();

describe("Soft Delete", () => {
  let testUserId;

  beforeAll(async () => {
    // Create soft-delete enabled table
    await sql`DROP TABLE IF EXISTS articles CASCADE`;
    await sql`
      CREATE TABLE articles (
        id serial PRIMARY KEY,
        title text NOT NULL,
        author_id int,
        deleted_at timestamptz
      )
    `;

    // Register with soft_delete=true
    await sql`
      SELECT dzql.register_entity(
        'articles',
        'title',
        array['title'],
        '{}',
        true,  -- soft_delete enabled
        '{}',
        '{}',
        jsonb_build_object(
          'view', array[]::text[],
          'create', array[]::text[],
          'update', array[]::text[],
          'delete', array[]::text[]
        )
      )
    `;

    // Create hard-delete table for comparison
    await sql`DROP TABLE IF EXISTS logs CASCADE`;
    await sql`
      CREATE TABLE logs (
        id serial PRIMARY KEY,
        message text NOT NULL
      )
    `;

    // Register with soft_delete=false
    await sql`
      SELECT dzql.register_entity(
        'logs',
        'message',
        array['message'],
        '{}',
        false,  -- hard delete
        '{}',
        '{}',
        jsonb_build_object(
          'view', array[]::text[],
          'create', array[]::text[],
          'update', array[]::text[],
          'delete', array[]::text[]
        )
      )
    `;

    const user = await createTestUser(sql);
    testUserId = user.user_id;
  });

  test("Soft delete sets deleted_at timestamp", async () => {
    const created = await sql`
      SELECT dzql.save_articles(${sql.json({
        title: testName("ToDelete"),
        author_id: testUserId,
      })}, ${testUserId}) as article
    `;
    const articleId = created[0].article.id;

    // Delete it
    const deleted = await sql`
      SELECT dzql.delete_articles(${sql.json({ id: articleId })}, ${testUserId}) as result
    `;

    // Check database directly
    const check = await sql`
      SELECT deleted_at FROM articles WHERE id = ${articleId}
    `;

    expect(check.length).toBe(1);
    expect(check[0].deleted_at).not.toBeNull();
    expect(new Date(check[0].deleted_at)).toBeInstanceOf(Date);
  });

  test("Soft deleted records excluded from search", async () => {
    // FIXED: generic_search now filters deleted_at IS NULL
    // Create two articles
    const article1 = await sql`
      SELECT dzql.save_articles(${sql.json({
        title: testName("Active"),
        author_id: testUserId,
      })}, ${testUserId}) as article
    `;

    const article2 = await sql`
      SELECT dzql.save_articles(${sql.json({
        title: testName("ToBeDeleted"),
        author_id: testUserId,
      })}, ${testUserId}) as article
    `;
    const article2Id = article2[0].article.id;

    // Delete article2
    await sql`
      SELECT dzql.delete_articles(${sql.json({ id: article2Id })}, ${testUserId})
    `;

    // Search should not return deleted article
    const search = await sql`
      SELECT dzql.search_articles(${sql.json({})}, ${testUserId}) as result
    `;

    const articleIds = search[0].result.data.map((a) => a.id);
    expect(articleIds).not.toContain(article2Id);
  });

  test("Soft deleted records excluded from lookup", async () => {
    // FIXED: generic_lookup now filters deleted_at IS NULL
    const created = await sql`
      SELECT dzql.save_articles(${sql.json({
        title: testName("DeletedLookup"),
        author_id: testUserId,
      })}, ${testUserId}) as article
    `;
    const articleId = created[0].article.id;

    // Delete it
    await sql`
      SELECT dzql.delete_articles(${sql.json({ id: articleId })}, ${testUserId})
    `;

    // Lookup should not include deleted
    const lookup = await sql`
      SELECT dzql.lookup_articles(${sql.json({})}, ${testUserId}) as result
    `;

    const lookupIds = lookup[0].result.map((item) => item.value);
    expect(lookupIds).not.toContain(articleId);
  });

  test("Can still retrieve soft deleted by ID (for audit)", async () => {
    const created = await sql`
      SELECT dzql.save_articles(${sql.json({
        title: testName("AuditTest"),
        author_id: testUserId,
      })}, ${testUserId}) as article
    `;
    const articleId = created[0].article.id;

    // Delete it
    await sql`
      SELECT dzql.delete_articles(${sql.json({ id: articleId })}, ${testUserId})
    `;

    // Should still be able to get it by ID
    const fetched = await sql`
      SELECT dzql.get_articles(${sql.json({ id: articleId })}, ${testUserId}) as article
    `;

    expect(fetched[0].article.id).toBe(articleId);
    expect(fetched[0].article.deleted_at).not.toBeNull();
  });

  test("Hard delete removes row from database", async () => {
    const created = await sql`
      SELECT dzql.save_logs(${sql.json({
        message: testName("HardDelete"),
      })}, ${testUserId}) as log
    `;
    const logId = created[0].log.id;

    // Delete it
    await sql`
      SELECT dzql.delete_logs(${sql.json({ id: logId })}, ${testUserId}) as result
    `;

    // Row should be completely gone
    const check = await sql`
      SELECT * FROM logs WHERE id = ${logId}
    `;

    expect(check.length).toBe(0);
  });

  test("Delete creates event with correct operation", async () => {
    const created = await sql`
      SELECT dzql.save_articles(${sql.json({
        title: testName("EventTest"),
        author_id: testUserId,
      })}, ${testUserId}) as article
    `;
    const articleId = created[0].article.id;

    // Delete it
    await sql`
      SELECT dzql.delete_articles(${sql.json({ id: articleId })}, ${testUserId})
    `;

    // Check event was created
    const events = await sql`
      SELECT * FROM dzql.events
      WHERE table_name = 'articles'
      AND pk->>'id' = ${articleId.toString()}
      AND op = 'delete'
      ORDER BY event_id DESC
      LIMIT 1
    `;

    expect(events.length).toBe(1);
    expect(events[0].op).toBe("delete");
    // DELETE events now include full record data for subscription resolution
    expect(events[0].data).not.toBeNull();
    expect(events[0].data.id).toBeDefined();
  });

  test("Multiple soft deletes update timestamp", async () => {
    const created = await sql`
      SELECT dzql.save_articles(${sql.json({
        title: testName("MultiDelete"),
        author_id: testUserId,
      })}, ${testUserId}) as article
    `;
    const articleId = created[0].article.id;

    // First delete
    await sql`
      SELECT dzql.delete_articles(${sql.json({ id: articleId })}, ${testUserId})
    `;

    const firstCheck = await sql`
      SELECT deleted_at FROM articles WHERE id = ${articleId}
    `;
    const firstDeletedAt = firstCheck[0].deleted_at;

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Delete again (should update timestamp)
    await sql`
      SELECT dzql.delete_articles(${sql.json({ id: articleId })}, ${testUserId})
    `;

    const secondCheck = await sql`
      SELECT deleted_at FROM articles WHERE id = ${articleId}
    `;
    const secondDeletedAt = secondCheck[0].deleted_at;

    expect(new Date(secondDeletedAt).getTime()).toBeGreaterThan(
      new Date(firstDeletedAt).getTime(),
    );
  });
});
