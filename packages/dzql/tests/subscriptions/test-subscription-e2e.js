#!/usr/bin/env bun

/**
 * End-to-end test for live query subscriptions
 *
 * Tests the complete flow:
 * 1. Server setup with subscribable
 * 2. Client connects and subscribes
 * 3. Database change triggers notification
 * 4. Client receives update via callback
 */

import { spawn } from 'bun';
import { WebSocketManager } from '../src/client/ws.js';
import pg from 'pg';

const { Pool } = pg;

// Test configuration
const TEST_PORT = 3001;
const DB_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/dzql';
const WS_URL = `ws://localhost:${TEST_PORT}/ws`;

// Database pool
const db = new Pool({ connectionString: DB_URL });

// Test state
let serverProcess = null;
let testClient = null;
let receivedUpdates = [];

/**
 * Start test server
 */
async function startServer() {
  console.log('Starting test server...');

  serverProcess = spawn(['bun', 'src/server/index.js'], {
    cwd: '/home/user/dzql/packages/dzql',
    env: {
      ...process.env,
      PORT: TEST_PORT.toString(),
      NODE_ENV: 'test'
    },
    stdout: 'pipe',
    stderr: 'pipe'
  });

  // Wait for server to be ready
  let attempts = 0;
  while (attempts < 50) {
    try {
      const response = await fetch(`http://localhost:${TEST_PORT}/health`);
      if (response.ok) {
        console.log('✓ Server is ready');
        return;
      }
    } catch (e) {
      // Server not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 100));
    attempts++;
  }

  throw new Error('Server failed to start');
}

/**
 * Stop test server
 */
async function stopServer() {
  if (serverProcess) {
    serverProcess.kill();
    await new Promise(resolve => setTimeout(resolve, 500));
    console.log('✓ Server stopped');
  }
}

/**
 * Setup database schema and test data
 */
async function setupDatabase() {
  console.log('\nSetting up database...');

  // Clean up any existing test data
  await db.query(`
    DELETE FROM dzql.subscribables WHERE name = 'test_venue';
  `);

  // Register test subscribable
  await db.query(`
    SELECT dzql.register_subscribable(
      'test_venue',
      '{"subscribe": ["@id"]}'::jsonb,
      '{"venue_id": "int"}'::jsonb,
      'venues',
      '{}'::jsonb
    );
  `);

  // Deploy compiled functions (simplified test version)
  await db.query(`
    -- Permission check function
    CREATE OR REPLACE FUNCTION test_venue_can_subscribe(p_user_id INT, p_params JSONB)
    RETURNS BOOLEAN AS $$
    BEGIN
      -- For testing, allow all subscriptions
      RETURN TRUE;
    END;
    $$ LANGUAGE plpgsql STABLE;

    -- Query function
    CREATE OR REPLACE FUNCTION get_test_venue(p_params JSONB, p_user_id INT)
    RETURNS JSONB AS $$
    DECLARE
      v_venue_id INT;
      v_result JSONB;
    BEGIN
      v_venue_id := (p_params->>'venue_id')::int;

      SELECT jsonb_build_object(
        'id', id,
        'name', name,
        'updated_at', updated_at
      )
      INTO v_result
      FROM venues
      WHERE id = v_venue_id;

      RETURN v_result;
    END;
    $$ LANGUAGE plpgsql STABLE;

    -- Affected documents function
    CREATE OR REPLACE FUNCTION test_venue_affected_documents(
      p_table TEXT,
      p_op TEXT,
      p_old JSONB,
      p_new JSONB
    )
    RETURNS JSONB[] AS $$
    DECLARE
      v_result JSONB[];
    BEGIN
      -- Only trigger on venues table
      IF p_table != 'venues' THEN
        RETURN ARRAY[]::JSONB[];
      END IF;

      -- Return affected venue_id as subscription params
      IF p_op = 'insert' OR p_op = 'update' THEN
        v_result := ARRAY[jsonb_build_object('venue_id', (p_new->>'id')::int)];
      ELSIF p_op = 'delete' THEN
        v_result := ARRAY[jsonb_build_object('venue_id', (p_old->>'id')::int)];
      END IF;

      RETURN v_result;
    END;
    $$ LANGUAGE plpgsql STABLE;
  `);

  // Ensure we have a test venue
  await db.query(`
    INSERT INTO venues (id, name, org_id)
    VALUES (999, 'Test Venue', 1)
    ON CONFLICT (id) DO UPDATE SET name = 'Test Venue';
  `);

  console.log('✓ Database setup complete');
}

/**
 * Cleanup database
 */
async function cleanupDatabase() {
  await db.query(`
    DROP FUNCTION IF EXISTS test_venue_can_subscribe;
    DROP FUNCTION IF EXISTS get_test_venue;
    DROP FUNCTION IF EXISTS test_venue_affected_documents;
    DELETE FROM dzql.subscribables WHERE name = 'test_venue';
    DELETE FROM venues WHERE id = 999;
  `);

  await db.end();
  console.log('✓ Database cleaned up');
}

/**
 * Test subscription flow
 */
async function testSubscription() {
  console.log('\nTesting subscription flow...');

  // Create WebSocket client
  testClient = new WebSocketManager(WS_URL);

  // Connect
  await testClient.connect();
  console.log('✓ Client connected');

  // Authenticate (using test user)
  const authResult = await testClient.call('auth.login', {
    email: 'test@example.com',
    password: 'test123'
  });

  console.log('✓ Client authenticated:', authResult.user?.email || 'test user');

  // Subscribe to test_venue
  receivedUpdates = [];

  const subscription = await testClient.api.subscribe_test_venue(
    { venue_id: 999 },
    (data) => {
      console.log('📬 Received update:', JSON.stringify(data));
      receivedUpdates.push(data);
    }
  );

  console.log('✓ Subscribed with ID:', subscription.subscription_id.slice(0, 8) + '...');
  console.log('  Initial data:', JSON.stringify(subscription.data));

  // Verify initial data
  if (!subscription.data || subscription.data.id !== 999) {
    throw new Error('Initial subscription data is incorrect');
  }

  // Wait a moment for subscription to be fully registered
  await new Promise(resolve => setTimeout(resolve, 200));

  // Trigger a database change
  console.log('\n📝 Triggering database update...');
  await db.query(`
    UPDATE venues
    SET name = 'Updated Test Venue', updated_at = NOW()
    WHERE id = 999;
  `);

  // Wait for notification to propagate
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Verify we received the update
  if (receivedUpdates.length === 0) {
    throw new Error('No updates received after database change');
  }

  console.log('✓ Received', receivedUpdates.length, 'update(s)');

  const lastUpdate = receivedUpdates[receivedUpdates.length - 1];
  if (lastUpdate.name !== 'Updated Test Venue') {
    throw new Error(`Update data incorrect: expected "Updated Test Venue", got "${lastUpdate.name}"`);
  }

  console.log('✓ Update data is correct');

  // Unsubscribe
  await subscription.unsubscribe();
  console.log('✓ Unsubscribed');

  // Close connection
  testClient.close();
  console.log('✓ Client disconnected');
}

/**
 * Run all tests
 */
async function runTests() {
  console.log('==================================');
  console.log('Live Query Subscriptions E2E Test');
  console.log('==================================');

  try {
    // Setup
    await setupDatabase();
    await startServer();

    // Run test
    await testSubscription();

    // Success
    console.log('\n==================================');
    console.log('✓ All tests passed!');
    console.log('==================================\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    // Cleanup
    try {
      await stopServer();
      await cleanupDatabase();
    } catch (e) {
      console.error('Cleanup error:', e.message);
    }
  }
}

// Run tests
runTests();
