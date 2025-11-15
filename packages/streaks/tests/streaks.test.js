import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { sql, db } from "dzql";

const PREFIX = `STREAKS_TEST_${Date.now()}`;
let aliceId;
let bobId;
let charlieId;

beforeAll(async () => {
  // Create test users
  const alice = await sql`SELECT dzql.register_user(${PREFIX + '_alice@test.com'}, 'password')`;
  const bob = await sql`SELECT dzql.register_user(${PREFIX + '_bob@test.com'}, 'password')`;
  const charlie = await sql`SELECT dzql.register_user(${PREFIX + '_charlie@test.com'}, 'password')`;

  aliceId = alice[0].register_user.user_id;
  bobId = bob[0].register_user.user_id;
  charlieId = charlie[0].register_user.user_id;
});

afterAll(async () => {
  // Clean up in dependency order
  await sql`DELETE FROM streak_reactions WHERE streak_id IN (SELECT id FROM streaks WHERE user_id IN (${aliceId}, ${bobId}, ${charlieId}))`;
  await sql`DELETE FROM streak_logs WHERE streak_id IN (SELECT id FROM streaks WHERE user_id IN (${aliceId}, ${bobId}, ${charlieId}))`;
  await sql`DELETE FROM streak_shares WHERE streak_id IN (SELECT id FROM streaks WHERE user_id IN (${aliceId}, ${bobId}, ${charlieId}))`;
  await sql`DELETE FROM streaks WHERE user_id IN (${aliceId}, ${bobId}, ${charlieId})`;
  await sql`DELETE FROM users WHERE id IN (${aliceId}, ${bobId}, ${charlieId})`;
});

describe("Streaks - Basic CRUD", () => {
  test("create streak with default counters", async () => {
    const streak = await db.api.save.streaks({
      user_id: aliceId,
      name: PREFIX + "_Morning Run",
      description: "5K every morning",
      icon: "🏃‍♀️"
    }, aliceId);

    expect(streak.name).toBe(PREFIX + "_Morning Run");
    expect(streak.description).toBe("5K every morning");
    expect(streak.icon).toBe("🏃‍♀️");
    expect(streak.current_streak).toBe(0);
    expect(streak.best_streak).toBe(0);
    expect(streak.total_logs).toBe(0);
    expect(streak.user_id).toBe(aliceId);
  });

  test("owner can view their own streak", async () => {
    const created = await db.api.save.streaks({
      user_id: aliceId,
      name: PREFIX + "_Private Meditation"
    }, aliceId);

    const viewed = await db.api.get.streaks({ id: created.id }, aliceId);
    expect(viewed.id).toBe(created.id);
    expect(viewed.name).toBe(PREFIX + "_Private Meditation");
  });

  test("owner can update their streak", async () => {
    const created = await db.api.save.streaks({
      user_id: aliceId,
      name: PREFIX + "_Original Name"
    }, aliceId);

    const updated = await db.api.save.streaks({
      id: created.id,
      name: PREFIX + "_Updated Name",
      description: "New description"
    }, aliceId);

    expect(updated.name).toBe(PREFIX + "_Updated Name");
    expect(updated.description).toBe("New description");
  });

  test("owner can delete their streak", async () => {
    const created = await db.api.save.streaks({
      user_id: aliceId,
      name: PREFIX + "_To Delete"
    }, aliceId);

    await db.api.delete.streaks({ id: created.id }, aliceId);

    await expect(
      db.api.get.streaks({ id: created.id }, aliceId)
    ).rejects.toThrow();
  });
});

describe("Streaks - Permissions & Sharing", () => {
  test("cannot view unshared streak", async () => {
    const streak = await db.api.save.streaks({
      user_id: aliceId,
      name: PREFIX + "_Private Streak"
    }, aliceId);

    // Bob cannot view (not shared)
    await expect(
      db.api.get.streaks({ id: streak.id }, bobId)
    ).rejects.toThrow();
  });

  test("can view streak after being shared", async () => {
    const streak = await db.api.save.streaks({
      user_id: aliceId,
      name: PREFIX + "_Shared Streak"
    }, aliceId);

    // Create mutual connection (both users must request)
    await db.api.create_share_connection(aliceId, { target_email: PREFIX + '_bob@test.com' });
    await db.api.create_share_connection(bobId, { target_email: PREFIX + '_alice@test.com' });

    // Now Bob can view (due to mutual connection)
    const viewed = await db.api.get.streaks({ id: streak.id }, bobId);
    expect(viewed.id).toBe(streak.id);
    expect(viewed.name).toBe(PREFIX + "_Shared Streak");
  });

  test("sharing with same person twice is idempotent", async () => {
    const streak = await db.api.save.streaks({
      user_id: aliceId,
      name: PREFIX + "_Duplicate Share Test"
    }, aliceId);

    // First connection request
    const conn1 = await db.api.create_share_connection(aliceId, { target_email: PREFIX + '_bob@test.com' });

    // Second connection request is idempotent
    const conn2 = await db.api.create_share_connection(aliceId, { target_email: PREFIX + '_bob@test.com' });

    // Verify both return same connection (idempotent)
    expect(conn2.requester_email).toBe(conn1.requester_email);
    expect(conn2.target_email).toBe(conn1.target_email);
    expect(conn2.valid_from).toBe(conn1.valid_from);
  });

  test("can revoke access by deleting share", async () => {
    const streak = await db.api.save.streaks({
      user_id: aliceId,
      name: PREFIX + "_Revoke Test"
    }, aliceId);

    // Create mutual connection
    await db.api.create_share_connection(aliceId, { target_email: PREFIX + '_bob@test.com' });
    await db.api.create_share_connection(bobId, { target_email: PREFIX + '_alice@test.com' });

    // Bob can view
    await db.api.get.streaks({ id: streak.id }, bobId);

    // Alice closes her connection to Bob (breaks mutual connection)
    await db.api.close_share_connection(aliceId, { target_email: PREFIX + '_bob@test.com' });

    // Bob can no longer view (connection no longer mutual)
    await expect(
      db.api.get.streaks({ id: streak.id }, bobId)
    ).rejects.toThrow();
  });

  test("shared user can also revoke their own access", async () => {
    const streak = await db.api.save.streaks({
      user_id: aliceId,
      name: PREFIX + "_Self Revoke Test"
    }, aliceId);

    // Create mutual connection
    await db.api.create_share_connection(aliceId, { target_email: PREFIX + '_bob@test.com' });
    await db.api.create_share_connection(bobId, { target_email: PREFIX + '_alice@test.com' });

    // Bob can close his own connection
    await db.api.close_share_connection(bobId, { target_email: PREFIX + '_alice@test.com' });

    // Bob can no longer view (connection no longer mutual)
    await expect(
      db.api.get.streaks({ id: streak.id }, bobId)
    ).rejects.toThrow();
  });

  test("non-owner cannot update streak", async () => {
    const streak = await db.api.save.streaks({
      user_id: aliceId,
      name: PREFIX + "_No Edit Test"
    }, aliceId);

    await db.api.save.streak_shares({
      streak_id: streak.id,
      user_id: bobId
    }, aliceId);

    // Bob can view but not update
    await expect(
      db.api.save.streaks({
        id: streak.id,
        name: "Hacked!"
      }, bobId)
    ).rejects.toThrow();
  });

  test("non-owner cannot delete streak", async () => {
    const streak = await db.api.save.streaks({
      user_id: aliceId,
      name: PREFIX + "_No Delete Test"
    }, aliceId);

    await db.api.save.streak_shares({
      streak_id: streak.id,
      user_id: bobId
    }, aliceId);

    await expect(
      db.api.delete.streaks({ id: streak.id }, bobId)
    ).rejects.toThrow();
  });
});

describe("Streak Logs - Tracking & Counters", () => {
  test("can log a streak", async () => {
    const streak = await db.api.save.streaks({
      user_id: aliceId,
      name: PREFIX + "_Log Test"
    }, aliceId);

    const today = new Date().toISOString().split('T')[0];

    const log = await db.api.save.streak_logs({
      streak_id: streak.id,
      log_date: today,
      notes: "Felt great today!"
    }, aliceId);

    expect(log.streak_id).toBe(streak.id);
    expect(log.notes).toBe("Felt great today!");
  });

  test("logging same day twice is idempotent (atomicity)", async () => {
    const streak = await db.api.save.streaks({
      user_id: aliceId,
      name: PREFIX + "_Atomic Test"
    }, aliceId);

    const today = new Date().toISOString().split('T')[0];

    // First log succeeds
    const log1 = await db.api.save.streak_logs({
      streak_id: streak.id,
      log_date: today,
      notes: "First entry"
    }, aliceId);

    // Second log is idempotent (UPSERT behavior)
    const log2 = await db.api.save.streak_logs({
      streak_id: streak.id,
      log_date: today,
      notes: "Updated entry"
    }, aliceId);

    // Verify both have same composite key
    expect(log2.streak_id).toBe(log1.streak_id);
    expect(log2.log_date).toBe(log1.log_date);

    // Verify notes were updated
    expect(log2.notes).toBe("Updated entry");

    // Verify only one record exists for today
    const logs = await db.api.search.streak_logs({
      filters: {
        streak_id: { eq: streak.id },
        log_date: { eq: today }
      }
    }, aliceId);
    expect(logs.data.length).toBe(1);
  });

  test("streak counter updates on first log", async () => {
    const streak = await db.api.save.streaks({
      user_id: aliceId,
      name: PREFIX + "_Counter Test 1"
    }, aliceId);

    const today = new Date().toISOString().split('T')[0];

    await db.api.save.streak_logs({
      streak_id: streak.id,
      log_date: today
    }, aliceId);

    const updated = await db.api.get.streaks({ id: streak.id }, aliceId);
    expect(updated.total_logs).toBe(1);
  });

  test("only owner can log their streak", async () => {
    const streak = await db.api.save.streaks({
      user_id: aliceId,
      name: PREFIX + "_Owner Only Log"
    }, aliceId);

    await db.api.save.streak_shares({
      streak_id: streak.id,
      user_id: bobId
    }, aliceId);

    const today = new Date().toISOString().split('T')[0];

    // Bob cannot log (even though they can view)
    await expect(
      db.api.save.streak_logs({
        streak_id: streak.id,
        log_date: today
      }, bobId)
    ).rejects.toThrow();
  });

  test("shared user can view logs", async () => {
    const streak = await db.api.save.streaks({
      user_id: aliceId,
      name: PREFIX + "_View Logs Test"
    }, aliceId);

    const today = new Date().toISOString().split('T')[0];

    await db.api.save.streak_logs({
      streak_id: streak.id,
      log_date: today,
      notes: "Secret note"
    }, aliceId);

    // Create mutual connection
    await db.api.create_share_connection(aliceId, { target_email: PREFIX + '_bob@test.com' });
    await db.api.create_share_connection(bobId, { target_email: PREFIX + '_alice@test.com' });

    // Bob can view the log via search (due to mutual connection)
    const logs = await db.api.search.streak_logs({
      filters: { streak_id: streak.id }
    }, bobId);

    expect(logs.data.length).toBe(1);
    expect(logs.data[0].notes).toBe("Secret note");
  });

  test("total_logs decrements when log deleted", async () => {
    const streak = await db.api.save.streaks({
      user_id: aliceId,
      name: PREFIX + "_Delete Log Test"
    }, aliceId);

    const today = new Date().toISOString().split('T')[0];

    await db.api.save.streak_logs({
      streak_id: streak.id,
      log_date: today
    }, aliceId);

    let updated = await db.api.get.streaks({ id: streak.id }, aliceId);
    expect(updated.total_logs).toBe(1);

    await db.api.delete.streak_logs({
      streak_id: streak.id,
      log_date: today
    }, aliceId);

    updated = await db.api.get.streaks({ id: streak.id }, aliceId);
    expect(updated.total_logs).toBe(0);
  });
});

describe("Streak Reactions - Social Features", () => {
  test("can react to shared streak", async () => {
    const streak = await db.api.save.streaks({
      user_id: aliceId,
      name: PREFIX + "_React Test"
    }, aliceId);

    // Create mutual connection
    await db.api.create_share_connection(aliceId, { target_email: PREFIX + '_bob@test.com' });
    await db.api.create_share_connection(bobId, { target_email: PREFIX + '_alice@test.com' });

    const reaction = await db.api.save.streak_reactions({
      streak_id: streak.id,
      user_id: bobId,
      reaction_type: "fire",
      comment: "You got this! 🔥"
    }, bobId);

    expect(reaction.reaction_type).toBe("fire");
    expect(reaction.comment).toBe("You got this! 🔥");
  });

  test("cannot react to streak without access", async () => {
    const streak = await db.api.save.streaks({
      user_id: aliceId,
      name: PREFIX + "_No Access React"
    }, aliceId);

    // Charlie has no connection to Alice
    await expect(
      db.api.save.streak_reactions({
        streak_id: streak.id,
        user_id: charlieId,
        reaction_type: "fire"
      }, charlieId)
    ).rejects.toThrow();
  });

  test("cannot give same reaction twice", async () => {
    const streak = await db.api.save.streaks({
      user_id: aliceId,
      name: PREFIX + "_Duplicate Reaction"
    }, aliceId);

    // Create mutual connection
    await db.api.create_share_connection(aliceId, { target_email: PREFIX + '_bob@test.com' });
    await db.api.create_share_connection(bobId, { target_email: PREFIX + '_alice@test.com' });

    // First reaction succeeds
    await db.api.save.streak_reactions({
      streak_id: streak.id,
      user_id: bobId,
      reaction_type: "fire"
    }, bobId);

    // Same reaction fails (UNIQUE constraint)
    await expect(
      db.api.save.streak_reactions({
        streak_id: streak.id,
        user_id: bobId,
        reaction_type: "fire"
      }, bobId)
    ).rejects.toThrow();
  });

  test("can give different reaction types", async () => {
    const streak = await db.api.save.streaks({
      user_id: aliceId,
      name: PREFIX + "_Multiple Reactions"
    }, aliceId);

    // Create mutual connection
    await db.api.create_share_connection(aliceId, { target_email: PREFIX + '_bob@test.com' });
    await db.api.create_share_connection(bobId, { target_email: PREFIX + '_alice@test.com' });

    // Multiple different reactions OK
    await db.api.save.streak_reactions({
      streak_id: streak.id,
      user_id: bobId,
      reaction_type: "fire"
    }, bobId);

    await db.api.save.streak_reactions({
      streak_id: streak.id,
      user_id: bobId,
      reaction_type: "heart"
    }, bobId);

    const reactions = await db.api.search.streak_reactions({
      filters: { streak_id: streak.id }
    }, aliceId);

    expect(reactions.data.length).toBe(2);
  });

  test("user can delete their own reaction", async () => {
    const streak = await db.api.save.streaks({
      user_id: aliceId,
      name: PREFIX + "_Delete Reaction"
    }, aliceId);

    // Create mutual connection
    await db.api.create_share_connection(aliceId, { target_email: PREFIX + '_bob@test.com' });
    await db.api.create_share_connection(bobId, { target_email: PREFIX + '_alice@test.com' });

    const reaction = await db.api.save.streak_reactions({
      streak_id: streak.id,
      user_id: bobId,
      reaction_type: "fire"
    }, bobId);

    await db.api.delete.streak_reactions({ id: reaction.id }, bobId);

    await expect(
      db.api.get.streak_reactions({ id: reaction.id }, bobId)
    ).rejects.toThrow();
  });
});

describe("Cascade Deletes", () => {
  test("deleting streak cascades to shares, logs, and reactions", async () => {
    const streak = await db.api.save.streaks({
      user_id: aliceId,
      name: PREFIX + "_Cascade Test"
    }, aliceId);

    // Create mutual connection
    await db.api.create_share_connection(aliceId, { target_email: PREFIX + '_bob@test.com' });
    await db.api.create_share_connection(bobId, { target_email: PREFIX + '_alice@test.com' });

    // Create log
    const today = new Date().toISOString().split('T')[0];
    await db.api.save.streak_logs({
      streak_id: streak.id,
      log_date: today
    }, aliceId);

    // Create reaction
    await db.api.save.streak_reactions({
      streak_id: streak.id,
      user_id: bobId,
      reaction_type: "fire"
    }, bobId);

    // Delete streak
    await db.api.delete.streaks({ id: streak.id }, aliceId);

    // Verify all children deleted (note: no more streak_shares, connections are separate)
    const logs = await sql`SELECT * FROM streak_logs WHERE streak_id = ${streak.id}`;
    const reactions = await sql`SELECT * FROM streak_reactions WHERE streak_id = ${streak.id}`;

    expect(logs.length).toBe(0);
    expect(reactions.length).toBe(0);
  });
});

describe("Search & Lookup", () => {
  test("can search streaks by name", async () => {
    await db.api.save.streaks({
      user_id: aliceId,
      name: PREFIX + "_Search Running"
    }, aliceId);

    await db.api.save.streaks({
      user_id: aliceId,
      name: PREFIX + "_Search Meditation"
    }, aliceId);

    const results = await db.api.search.streaks({
      filters: {
        name: { ilike: `%${PREFIX}_Search%` }
      }
    }, aliceId);

    expect(results.data.length).toBeGreaterThanOrEqual(2);
  });

  test("lookup returns label-value pairs", async () => {
    await db.api.save.streaks({
      user_id: aliceId,
      name: PREFIX + "_Lookup Test"
    }, aliceId);

    const results = await db.api.lookup.streaks({
      p_filter: PREFIX + "_Lookup"
    }, aliceId);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('label');
    expect(results[0]).toHaveProperty('value');
  });
});
