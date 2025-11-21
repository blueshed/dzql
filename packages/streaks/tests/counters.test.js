import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { sql, db } from "dzql";

const PREFIX = `COUNTERS_TEST_${Date.now()}`;
let aliceId;
let bobId;

beforeAll(async () => {
  // Create test users
  const alice = await sql`SELECT dzql.register_user(${PREFIX + '_alice@test.com'}, 'password')`;
  const bob = await sql`SELECT dzql.register_user(${PREFIX + '_bob@test.com'}, 'password')`;

  aliceId = alice[0].register_user.user_id;
  bobId = bob[0].register_user.user_id;
});

afterAll(async () => {
  // Clean up in dependency order
  await sql`DELETE FROM streak_logs WHERE streak_id IN (SELECT id FROM streaks WHERE user_id IN (${aliceId}, ${bobId}))`;
  await sql`DELETE FROM streaks WHERE user_id IN (${aliceId}, ${bobId})`;
  await sql`DELETE FROM users WHERE id IN (${aliceId}, ${bobId})`;
});

describe("Streak Counters & Milestones", () => {

  test("first log sets streaks to 1", async () => {
    const streak = await db.api.save.streaks({ user_id: aliceId, name: PREFIX + "_Counter Test 1" }, aliceId);
    const today = new Date().toISOString().split('T')[0];

    await db.api.save.streak_logs({ streak_id: streak.id, log_date: today }, aliceId);

    const updated = await db.api.get.streaks({ id: streak.id }, aliceId);
    expect(updated.current_streak).toBe(1);
    expect(updated.best_streak).toBe(1);
    expect(updated.last_logged_at).toBe(today);
  });

  test("consecutive logs increment current_streak", async () => {
    const streak = await db.api.save.streaks({ user_id: aliceId, name: PREFIX + "_Counter Test 2" }, aliceId);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // Log yesterday
    await db.api.save.streak_logs({ streak_id: streak.id, log_date: yesterday.toISOString().split('T')[0] }, aliceId);
    // Log today
    await db.api.save.streak_logs({ streak_id: streak.id, log_date: today.toISOString().split('T')[0] }, aliceId);

    const updated = await db.api.get.streaks({ id: streak.id }, aliceId);
    expect(updated.current_streak).toBe(2);
    expect(updated.best_streak).toBe(2);
  });

  test("missing a day resets current_streak but preserves best_streak", async () => {
    const streak = await db.api.save.streaks({ user_id: aliceId, name: PREFIX + "_Counter Test 3" }, aliceId);
    const today = new Date();
    const day1 = new Date(today);
    day1.setDate(day1.getDate() - 3);
    const day2 = new Date(today);
    day2.setDate(day2.getDate() - 2);
    // day 3 is missed
    const day4 = new Date(today);

    await db.api.save.streak_logs({ streak_id: streak.id, log_date: day1.toISOString().split('T')[0] }, aliceId);
    await db.api.save.streak_logs({ streak_id: streak.id, log_date: day2.toISOString().split('T')[0] }, aliceId);

    let updated = await db.api.get.streaks({ id: streak.id }, aliceId);
    expect(updated.current_streak).toBe(0); // Correct: streak is not "current" if last log was 2 days ago
    expect(updated.best_streak).toBe(2);

    // Log today after missing a day
    await db.api.save.streak_logs({ streak_id: streak.id, log_date: day4.toISOString().split('T')[0] }, aliceId);
    updated = await db.api.get.streaks({ id: streak.id }, aliceId);
    expect(updated.current_streak).toBe(1); // Reset
    expect(updated.best_streak).toBe(2); // Preserved
  });

  test("deleting a log correctly recalculates streaks", async () => {
    const streak = await db.api.save.streaks({ user_id: aliceId, name: PREFIX + "_Counter Test 4" }, aliceId);
    const today = new Date();
    const day1 = new Date(today);
    day1.setDate(day1.getDate() - 2);
    const day2 = new Date(today);
    day2.setDate(day2.getDate() - 1);
    const day3 = new Date(today);

    const day1Str = day1.toISOString().split('T')[0];
    const day2Str = day2.toISOString().split('T')[0];
    const day3Str = day3.toISOString().split('T')[0];

    await db.api.save.streak_logs({ streak_id: streak.id, log_date: day1Str }, aliceId);
    await db.api.save.streak_logs({ streak_id: streak.id, log_date: day2Str }, aliceId);
    await db.api.save.streak_logs({ streak_id: streak.id, log_date: day3Str }, aliceId);

    let updated = await db.api.get.streaks({ id: streak.id }, aliceId);
    expect(updated.current_streak).toBe(3);
    expect(updated.best_streak).toBe(3);

    // Delete the middle log, breaking the streak
    await db.api.delete.streak_logs({ streak_id: streak.id, log_date: day2Str }, aliceId);

    updated = await db.api.get.streaks({ id: streak.id }, aliceId);
    expect(updated.current_streak).toBe(1); // Only today's log counts
    expect(updated.best_streak).toBe(1); // The longest chain is now 1
  });

  test("milestone hit creates a dzql.events record", async () => {
    const streak = await db.api.save.streaks({ user_id: aliceId, name: PREFIX + "_Milestone Test" }, aliceId);
    const today = new Date();
    const day1 = new Date(today);
    day1.setDate(day1.getDate() - 2);
    const day2 = new Date(today);
    day2.setDate(day2.getDate() - 1);
    const day3 = new Date(today);

    // Clear old events for this test
    await sql`DELETE FROM dzql.events WHERE table_name = 'streaks' AND op = 'milestone'`;

    await db.api.save.streak_logs({ streak_id: streak.id, log_date: day1.toISOString().split('T')[0] }, aliceId);
    await db.api.save.streak_logs({ streak_id: streak.id, log_date: day2.toISOString().split('T')[0] }, aliceId);

    // This log should hit the milestone of 3
    await db.api.save.streak_logs({ streak_id: streak.id, log_date: day3.toISOString().split('T')[0] }, aliceId);

    const events = await sql`
      SELECT * FROM dzql.events
      WHERE table_name = 'streaks'
        AND op = 'milestone'
        AND (data->>'streak_id')::int = ${streak.id}
    `;

    expect(events.length).toBe(1);
    const event = events[0];
    expect(event.op).toBe("milestone");
    expect(event.data.milestone).toBe(3);
    expect(event.data.streak_id).toBe(streak.id);
    expect(event.user_id).toBe(aliceId);
  });

});
