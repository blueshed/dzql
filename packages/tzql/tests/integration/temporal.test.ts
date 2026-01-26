import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { V2TestDatabase } from "./setup.js";
import { generateIR } from "../../src/cli/compiler/ir.js";
import { generateEntitySQL, generateSchemaSQL } from "../../src/cli/codegen/sql.js";
import type { DomainConfig } from "../../src/shared/ir.js";

/**
 * Integration tests for temporal entities with refField (versioned entities)
 *
 * Temporal entities have:
 * - refField: stable identifier across versions (from a sequence)
 * - validFrom: start of validity period
 * - validTo: end of validity period (NULL = current version)
 *
 * Save behavior:
 * - No ref: INSERT new entity (sequence assigns ref)
 * - Has ref: Close current version (set validTo = now()), INSERT new version
 *
 * Get behavior:
 * - By ref: returns current version (validTo IS NULL)
 * - By ref + as_of: returns version at that time
 * - By id: returns specific version
 *
 * Delete behavior:
 * - Closes current version (set validTo = now())
 *
 * Search behavior:
 * - Only returns current versions (validTo IS NULL)
 */

// Domain with a temporal entity
const temporalDomain: DomainConfig = {
  entities: {
    documents: {
      schema: {
        id: 'serial PRIMARY KEY',
        ref: 'int NOT NULL',
        title: 'text NOT NULL',
        content: 'text',
        author_id: 'int',
        valid_from: 'timestamptz NOT NULL DEFAULT now()',
        valid_to: 'timestamptz'
      },
      label: 'title',
      searchable: ['title', 'content'],
      temporal: {
        refField: 'ref',
        validFrom: 'valid_from',
        validTo: 'valid_to',
        sequence: 'documents_ref_seq'
      },
      permissions: {
        view: ['TRUE'],
        create: [],
        update: ['@author_id'],
        delete: ['@author_id']
      },
      fieldDefaults: {
        author_id: '@user_id'
      }
    }
  },
  subscribables: {}
};

describe("Temporal Entities with refField", () => {
  let db: V2TestDatabase;
  let sql: any;
  let ir: any;

  beforeAll(async () => {
    db = new V2TestDatabase();
    sql = await db.setup();
    ir = generateIR(temporalDomain);

    // Apply core schema
    await sql`CREATE SCHEMA IF NOT EXISTS dzql_v2`;
    await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
    await sql`CREATE SEQUENCE IF NOT EXISTS dzql_v2.commit_seq`;
    await sql`
      CREATE TABLE IF NOT EXISTS dzql_v2.events (
        id bigserial PRIMARY KEY,
        commit_id bigint NOT NULL,
        table_name text NOT NULL,
        op text NOT NULL,
        pk jsonb NOT NULL,
        data jsonb,
        old_data jsonb,
        user_id int,
        affected_keys text[] DEFAULT ARRAY[]::text[],
        notify_users int[] DEFAULT ARRAY[]::int[],
        created_at timestamptz DEFAULT now()
      )
    `;
    await sql`
      CREATE OR REPLACE FUNCTION dzql_v2.compute_affected_keys(
        p_table TEXT, p_op TEXT, p_data JSONB
      ) RETURNS TEXT[] LANGUAGE plpgsql IMMUTABLE AS $$
      BEGIN RETURN ARRAY[]::text[]; END; $$
    `;

    // Create documents table with sequence
    const schemaSQL = generateSchemaSQL('documents', ir.entities.documents);
    await sql.unsafe(schemaSQL);

    // Apply entity functions
    const entitySQL = generateEntitySQL('documents', ir.entities.documents);
    await sql.unsafe(entitySQL);
  });

  afterAll(async () => {
    await db.teardown();
  });

  describe("INSERT (new entity)", () => {
    test("creates new entity with auto-assigned ref", async () => {
      const result = await sql`
        SELECT dzql_v2.save_documents(1, ${sql.json({
          title: 'First Document',
          content: 'Hello World'
        })}) as doc
      `;

      const doc = result[0].doc;
      expect(doc.id).toBeDefined();
      expect(doc.ref).toBeDefined();
      expect(doc.title).toBe('First Document');
      expect(doc.content).toBe('Hello World');
      expect(doc.author_id).toBe(1); // From @user_id default
      expect(doc.valid_from).toBeDefined();
      expect(doc.valid_to).toBeNull();
    });

    test("each new entity gets unique ref from sequence", async () => {
      const doc1 = await sql`
        SELECT dzql_v2.save_documents(1, ${sql.json({ title: 'Doc A' })}) as doc
      `;
      const doc2 = await sql`
        SELECT dzql_v2.save_documents(1, ${sql.json({ title: 'Doc B' })}) as doc
      `;

      expect(doc1[0].doc.ref).not.toBe(doc2[0].doc.ref);
    });
  });

  describe("UPDATE (versioned)", () => {
    test("update creates new version and closes old one", async () => {
      // Create document
      const created = await sql`
        SELECT dzql_v2.save_documents(1, ${sql.json({
          title: 'Original Title',
          content: 'Original Content'
        })}) as doc
      `;
      const ref = created[0].doc.ref;
      const originalId = created[0].doc.id;

      // Small delay to ensure different timestamps
      await new Promise(r => setTimeout(r, 50));

      // Update by ref
      const updated = await sql`
        SELECT dzql_v2.save_documents(1, ${sql.json({
          ref: ref,
          title: 'Updated Title'
        })}) as doc
      `;

      const updatedDoc = updated[0].doc;

      // New version should have same ref but different id
      expect(updatedDoc.ref).toBe(ref);
      expect(updatedDoc.id).not.toBe(originalId);
      expect(updatedDoc.title).toBe('Updated Title');
      // Content should be copied from previous version
      expect(updatedDoc.content).toBe('Original Content');
      expect(updatedDoc.valid_to).toBeNull();

      // Old version should be closed
      const oldVersion = await sql`
        SELECT * FROM documents WHERE id = ${originalId}
      `;
      expect(oldVersion[0].valid_to).not.toBeNull();
    });

    test("partial update copies unchanged fields from current version", async () => {
      const created = await sql`
        SELECT dzql_v2.save_documents(1, ${sql.json({
          title: 'Title',
          content: 'Content'
        })}) as doc
      `;
      const ref = created[0].doc.ref;

      // Update only title
      const updated = await sql`
        SELECT dzql_v2.save_documents(1, ${sql.json({
          ref: ref,
          title: 'New Title'
        })}) as doc
      `;

      expect(updated[0].doc.title).toBe('New Title');
      expect(updated[0].doc.content).toBe('Content'); // Copied forward
      expect(updated[0].doc.author_id).toBe(1); // Copied forward
    });
  });

  describe("GET", () => {
    test("get by ref returns current version", async () => {
      const created = await sql`
        SELECT dzql_v2.save_documents(1, ${sql.json({
          title: 'Get Test'
        })}) as doc
      `;
      const ref = created[0].doc.ref;

      // Update to create a new version
      await sql`
        SELECT dzql_v2.save_documents(1, ${sql.json({
          ref: ref,
          title: 'Updated Get Test'
        })})
      `;

      // Get by ref should return current version
      const result = await sql`
        SELECT dzql_v2.get_documents(1, ${sql.json({ ref: ref })}) as doc
      `;

      expect(result[0].doc.title).toBe('Updated Get Test');
      expect(result[0].doc.valid_to).toBeNull();
    });

    test("get by id returns specific version", async () => {
      const created = await sql`
        SELECT dzql_v2.save_documents(1, ${sql.json({
          title: 'Version Test'
        })}) as doc
      `;
      const originalId = created[0].doc.id;

      // Update to create new version
      await sql`
        SELECT dzql_v2.save_documents(1, ${sql.json({
          ref: created[0].doc.ref,
          title: 'New Version'
        })})
      `;

      // Get by original id should return that specific version
      const result = await sql`
        SELECT dzql_v2.get_documents(1, ${sql.json({ id: originalId })}) as doc
      `;

      expect(result[0].doc.title).toBe('Version Test');
    });

    test("get by ref with as_of returns version at that time", async () => {
      const created = await sql`
        SELECT dzql_v2.save_documents(1, ${sql.json({
          title: 'Time Travel Test v1'
        })}) as doc
      `;
      const ref = created[0].doc.ref;

      // Record time after first version
      await new Promise(r => setTimeout(r, 100));
      const midpoint = new Date().toISOString();
      await new Promise(r => setTimeout(r, 100));

      // Update to v2
      await sql`
        SELECT dzql_v2.save_documents(1, ${sql.json({
          ref: ref,
          title: 'Time Travel Test v2'
        })})
      `;

      // Get at midpoint should return v1
      const result = await sql`
        SELECT dzql_v2.get_documents(1, ${sql.json({ ref: ref, as_of: midpoint })}) as doc
      `;

      expect(result[0].doc.title).toBe('Time Travel Test v1');
    });
  });

  describe("DELETE (temporal)", () => {
    test("delete closes current version", async () => {
      const created = await sql`
        SELECT dzql_v2.save_documents(1, ${sql.json({
          title: 'To Delete'
        })}) as doc
      `;
      const ref = created[0].doc.ref;
      const id = created[0].doc.id;

      // Delete by ref
      await sql`
        SELECT dzql_v2.delete_documents(1, ${sql.json({ ref: ref })})
      `;

      // Row should still exist but with valid_to set
      const check = await sql`SELECT * FROM documents WHERE id = ${id}`;
      expect(check.length).toBe(1);
      expect(check[0].valid_to).not.toBeNull();

      // Get by ref should return null (no current version)
      const result = await sql`
        SELECT dzql_v2.get_documents(1, ${sql.json({ ref: ref })}) as doc
      `;
      expect(result[0].doc).toBeNull();
    });
  });

  describe("SEARCH", () => {
    test("search only returns current versions", async () => {
      // Create a document and update it
      const created = await sql`
        SELECT dzql_v2.save_documents(1, ${sql.json({
          title: 'Search Test Original'
        })}) as doc
      `;
      const ref = created[0].doc.ref;

      await sql`
        SELECT dzql_v2.save_documents(1, ${sql.json({
          ref: ref,
          title: 'Search Test Updated'
        })})
      `;

      // Search should only return the current version
      const result = await sql`
        SELECT dzql_v2.search_documents(1, ${sql.json({
          filters: { ref: { eq: ref } }
        })}) as docs
      `;

      const docs = result.map((r: any) => r.docs);
      expect(docs.length).toBe(1);
      expect(docs[0].title).toBe('Search Test Updated');
    });

    test("deleted documents not returned in search", async () => {
      const created = await sql`
        SELECT dzql_v2.save_documents(1, ${sql.json({
          title: 'Search Delete Test'
        })}) as doc
      `;
      const ref = created[0].doc.ref;

      await sql`
        SELECT dzql_v2.delete_documents(1, ${sql.json({ ref: ref })})
      `;

      // Search for this specific ref should return empty
      const result = await sql`
        SELECT dzql_v2.search_documents(1, ${sql.json({
          filters: { ref: { eq: ref } }
        })}) as docs
      `;

      expect(result.length).toBe(0);
    });
  });

  describe("HISTORY", () => {
    test("get_history returns all versions ordered by valid_from desc", async () => {
      const created = await sql`
        SELECT dzql_v2.save_documents(1, ${sql.json({
          title: 'History Test v1'
        })}) as doc
      `;
      const ref = created[0].doc.ref;

      await new Promise(r => setTimeout(r, 50));
      await sql`
        SELECT dzql_v2.save_documents(1, ${sql.json({
          ref: ref,
          title: 'History Test v2'
        })})
      `;

      await new Promise(r => setTimeout(r, 50));
      await sql`
        SELECT dzql_v2.save_documents(1, ${sql.json({
          ref: ref,
          title: 'History Test v3'
        })})
      `;

      const history = await sql`
        SELECT dzql_v2.get_documents_history(1, ${sql.json({ ref: ref })}) as versions
      `;

      const versions = history[0].versions;
      expect(versions.length).toBe(3);
      // Most recent first
      expect(versions[0].title).toBe('History Test v3');
      expect(versions[1].title).toBe('History Test v2');
      expect(versions[2].title).toBe('History Test v1');
    });
  });
});
