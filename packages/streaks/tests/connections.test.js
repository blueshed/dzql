import { test, expect, beforeAll, afterAll } from "bun:test";
import { sql, db } from "dzql";

const PREFIX = `CONN_TEST_${Date.now()}`;
let aliceId, bobId, charlieId;
let aliceEmail, bobEmail, charlieEmail;

beforeAll(async () => {
  // Create test users
  aliceEmail = `${PREFIX}_alice@test.com`;
  bobEmail = `${PREFIX}_bob@test.com`;
  charlieEmail = `${PREFIX}_charlie@test.com`;

  const alice = await sql`SELECT dzql.register_user(${aliceEmail}, ${'password123'})`;
  aliceId = alice[0].register_user.user_id;

  const bob = await sql`SELECT dzql.register_user(${bobEmail}, ${'password123'})`;
  bobId = bob[0].register_user.user_id;

  const charlie = await sql`SELECT dzql.register_user(${charlieEmail}, ${'password123'})`;
  charlieId = charlie[0].register_user.user_id;
});

afterAll(async () => {
  // Clean up
  await sql`DELETE FROM share_connections WHERE email_a LIKE ${PREFIX + '%'} OR email_b LIKE ${PREFIX + '%'}`;
  await sql`DELETE FROM users WHERE email LIKE ${PREFIX + '%'}`;
});

test("create connection request", async () => {
    const result = await db.api.create_share_connection(aliceId, { target_email: bobEmail });

    expect(result.email_a).toBe(aliceEmail);
    expect(result.email_b).toBe(bobEmail);
    expect(result.valid_from).toBeNull();  // Pending - no reciprocal yet
    expect(result.valid_to).toBeNull();
});

test("connection not mutual yet", async () => {
    // Check mutual_connections view
    const mutual = await sql`
      SELECT * FROM mutual_connections
      WHERE (email_a = ${aliceEmail} AND email_b = ${bobEmail})
         OR (email_a = ${bobEmail} AND email_b = ${aliceEmail})
    `;

    expect(mutual.length).toBe(0);  // Not mutual yet - only Alice requested
});

test("bob creates reciprocal connection", async () => {
    const result = await db.api.create_share_connection(bobId, { target_email: aliceEmail });

    // This activates Alice's pending row (alice->bob)
    expect(result.email_a).toBe(aliceEmail);
    expect(result.email_b).toBe(bobEmail);
    expect(result.valid_from).not.toBeNull();  // Now active!
});

test("connection is now mutual", async () => {
    const mutual = await sql`
      SELECT * FROM mutual_connections
      WHERE (email_a = ${aliceEmail} AND email_b = ${bobEmail})
         OR (email_a = ${bobEmail} AND email_b = ${aliceEmail})
    `;

    expect(mutual.length).toBe(1);  // Single row: alice->bob with valid_from set
});

test("alice can see bob's streaks", async () => {
    // Create a streak as Bob
    const bobStreak = await db.api.save.streaks({
      name: PREFIX + "_Bob's Streak"
    }, bobId);

    // Alice can view it
    const viewed = await db.api.get.streaks({ id: bobStreak.id }, aliceId);
    expect(viewed.name).toBe(PREFIX + "_Bob's Streak");
});

test("bob can see alice's streaks", async () => {
    // Create a streak as Alice
    const aliceStreak = await db.api.save.streaks({
      name: PREFIX + "_Alice's Streak"
    }, aliceId);

    // Bob can view it
    const viewed = await db.api.get.streaks({ id: aliceStreak.id }, bobId);
    expect(viewed.name).toBe(PREFIX + "_Alice's Streak");
});

test("charlie cannot see alice's streaks", async () => {
    const aliceStreak = await db.api.save.streaks({
      name: PREFIX + "_Alice Private"
    }, aliceId);

    // Charlie has no connection
    await expect(
      db.api.get.streaks({ id: aliceStreak.id }, charlieId)
    ).rejects.toThrow(/Permission denied|record not found/);
});

test("alice closes connection", async () => {
    const result = await db.api.close_share_connection(aliceId, { target_email: bobEmail });
    expect(result.success).toBe(true);
});

test("connection no longer mutual", async () => {
    const mutual = await sql`
      SELECT * FROM mutual_connections
      WHERE (email_a = ${aliceEmail} AND email_b = ${bobEmail})
         OR (email_a = ${bobEmail} AND email_b = ${aliceEmail})
    `;

    expect(mutual.length).toBe(0);  // Connection broken
});

test("alice cannot see bob's streaks anymore", async () => {
    const bobStreak = await db.api.save.streaks({
      name: PREFIX + "_Bob's New Streak"
    }, bobId);

    await expect(
      db.api.get.streaks({ id: bobStreak.id }, aliceId)
    ).rejects.toThrow(/Permission denied|record not found/);
});

test("connection can be reopened", async () => {
    // Alice creates new request
    await db.api.create_share_connection(aliceId, { target_email: bobEmail });

    // Bob makes it mutual again
    await db.api.create_share_connection(bobId, { target_email: aliceEmail });

    // Should have new row created (temporal history preserved)
    const history = await sql`
      SELECT * FROM share_connections
      WHERE email_a = ${aliceEmail} AND email_b = ${bobEmail}
      ORDER BY id
    `;

    expect(history.length).toBe(2);  // Historical + new row
    expect(history[0].valid_to).not.toBeNull();  // First row closed
    expect(history[1].valid_to).toBeNull();  // New row active
    expect(history[1].valid_from).not.toBeNull();  // Now mutual
});

test("idempotent - creating active connection again returns existing", async () => {
    const result1 = await db.api.create_share_connection(aliceId, { target_email: charlieEmail });
    const result2 = await db.api.create_share_connection(aliceId, { target_email: charlieEmail });

    expect(result1.valid_from).toBe(result2.valid_from);
    expect(result1.email_a).toBe(result2.email_a);
    expect(result1.email_b).toBe(result2.email_b);
});

test("single row activated when reciprocal request made", async () => {
    // Clean up any existing Alice<->Charlie connections first
    await db.api.close_share_connection(aliceId, { target_email: charlieEmail });
    await db.api.close_share_connection(charlieId, { target_email: aliceEmail });

    // Alice requests Charlie - creates pending row
    const result1 = await db.api.create_share_connection(aliceId, { target_email: charlieEmail });
    expect(result1.email_a).toBe(aliceEmail);
    expect(result1.email_b).toBe(charlieEmail);
    expect(result1.valid_from).toBeNull();  // Pending

    // Charlie requests Alice - activates Alice's row
    const result2 = await db.api.create_share_connection(charlieId, { target_email: aliceEmail });
    expect(result2.email_a).toBe(aliceEmail);  // Same row!
    expect(result2.email_b).toBe(charlieEmail);
    expect(result2.valid_from).not.toBeNull();  // Now active

    // Only one row exists (activated)
    const rows = await sql`
      SELECT * FROM share_connections
      WHERE ((email_a = ${aliceEmail} AND email_b = ${charlieEmail})
         OR (email_a = ${charlieEmail} AND email_b = ${aliceEmail}))
        AND valid_to IS NULL
    `;
    expect(rows.length).toBe(1);
});
