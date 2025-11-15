import { test, expect, beforeAll, afterAll } from "bun:test";
import { sql, db } from "dzql";

const PREFIX = `NOTIF_TEST_${Date.now()}`;
let aliceEmail, bobEmail;
let aliceId, bobId;

beforeAll(async () => {
  // Create test users
  aliceEmail = `${PREFIX}_alice@test.com`;
  bobEmail = `${PREFIX}_bob@test.com`;

  const alice = await sql`SELECT dzql.register_user(${aliceEmail}, ${'password'})`;
  aliceId = alice[0].register_user.user_id;

  const bob = await sql`SELECT dzql.register_user(${bobEmail}, ${'password'})`;
  bobId = bob[0].register_user.user_id;
});

afterAll(async () => {
  // Cleanup
  await sql`DELETE FROM share_connections WHERE email_a LIKE ${PREFIX + '%'} OR email_b LIKE ${PREFIX + '%'}`;
  await sql`DELETE FROM users WHERE email LIKE ${PREFIX + '%'}`;
});

test("share_connections is registered for notifications", async () => {
  // Check that entity is registered for notifications
  const entity = await sql`
    SELECT * FROM dzql.entities WHERE table_name = 'share_connections'
  `;

  expect(entity.length).toBe(1);
  expect(entity[0].table_name).toBe('share_connections');

  // Verify notification paths are set up
  const paths = entity[0].permission_paths;
  expect(paths.view).toBeDefined();
  expect(Array.isArray(paths.view)).toBe(true);
});

test("connections can be created and will generate events", async () => {
  // Create connection using db.api (this should trigger notification)
  const result = await db.api.create_share_connection(aliceId, { target_email: bobEmail });

  expect(result.email_a).toBe(aliceEmail);
  expect(result.email_b).toBe(bobEmail);
  expect(result.valid_to).toBeNull();

  // Verify it's in the database
  const connections = await sql`
    SELECT * FROM share_connections
    WHERE email_a = ${aliceEmail}
    AND email_b = ${bobEmail}
    AND valid_to IS NULL
  `;

  expect(connections.length).toBe(1);
});

test("closing connection updates row", async () => {
  const result = await db.api.close_share_connection(aliceId, { target_email: bobEmail });

  expect(result.success).toBe(true);

  // Verify it's closed
  const connections = await sql`
    SELECT * FROM share_connections
    WHERE email_a = ${aliceEmail}
    AND email_b = ${bobEmail}
    AND valid_to IS NOT NULL
  `;

  expect(connections.length).toBe(1);
  expect(connections[0].valid_to).not.toBeNull();
});
