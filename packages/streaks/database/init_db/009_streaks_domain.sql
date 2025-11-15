-- Streaks: Social Habit Tracking Application
-- Build habits with friends through daily logging and social accountability

SET search_path = public, dzql;

-- === Domain Tables ===

-- Streaks: The habits people are tracking
CREATE TABLE IF NOT EXISTS streaks (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  current_streak INT DEFAULT 0 CHECK (current_streak >= 0),
  best_streak INT DEFAULT 0 CHECK (best_streak >= 0),
  total_logs INT DEFAULT 0 CHECK (total_logs >= 0),
  last_logged_at DATE
);

CREATE INDEX idx_streaks_user_id ON streaks(user_id);
CREATE INDEX idx_streaks_current_streak ON streaks(current_streak DESC);

-- Streak Logs: Daily check-ins
-- Composite PK enforces one log per streak per day (atomicity)
CREATE TABLE IF NOT EXISTS streak_logs (
  streak_id INT NOT NULL REFERENCES streaks(id) ON DELETE CASCADE,
  log_date DATE NOT NULL,
  notes TEXT,
  logged_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (streak_id, log_date)
);

CREATE INDEX idx_streak_logs_streak_id ON streak_logs(streak_id);
CREATE INDEX idx_streak_logs_date ON streak_logs(log_date DESC);

-- Share Connections: Single-row mutual connection model with temporal tracking
-- One row per connection request
-- valid_from NULL = pending (waiting for reciprocal request)
-- valid_from set = active mutual connection (reciprocal request found)
-- valid_to set = connection closed by either party (historical record)
CREATE TABLE IF NOT EXISTS share_connections (
  id SERIAL PRIMARY KEY,
  email_a TEXT NOT NULL,
  email_b TEXT NOT NULL,
  created_at DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_from DATE,
  valid_to DATE,
  CHECK (email_a != email_b)
);

CREATE INDEX idx_share_connections_email_a ON share_connections(email_a) WHERE valid_to IS NULL;
CREATE INDEX idx_share_connections_email_b ON share_connections(email_b) WHERE valid_to IS NULL;

-- Helper view: active mutual connections
-- Converts emails to user IDs for permission path resolution
CREATE OR REPLACE VIEW mutual_connections AS
SELECT
  u1.id as user1_id,
  u2.id as user2_id,
  c.email_a,
  c.email_b,
  c.valid_from
FROM share_connections c
JOIN users u1 ON u1.email = c.email_a
JOIN users u2 ON u2.email = c.email_b
WHERE c.valid_from IS NOT NULL
  AND c.valid_to IS NULL;

-- Streak Shares: Who can see which streaks
-- No row = completely private (only creator sees)
-- Composite PK prevents sharing with same person twice
CREATE TABLE IF NOT EXISTS streak_shares (
  streak_id INT NOT NULL REFERENCES streaks(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shared_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (streak_id, user_id)
);

CREATE INDEX idx_streak_shares_user_id ON streak_shares(user_id);
CREATE INDEX idx_streak_shares_streak_id ON streak_shares(streak_id);

-- Streak Reactions: Social engagement (fire, heart, clap, like)
-- UNIQUE constraint prevents giving same reaction twice
CREATE TABLE IF NOT EXISTS streak_reactions (
  id SERIAL PRIMARY KEY,
  streak_id INT NOT NULL REFERENCES streaks(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction_type TEXT NOT NULL CHECK (reaction_type IN ('fire', 'heart', 'clap', 'like')),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (streak_id, user_id, reaction_type)
);

CREATE INDEX idx_streak_reactions_streak_id ON streak_reactions(streak_id);
CREATE INDEX idx_streak_reactions_user_id ON streak_reactions(user_id);

-- === Entity Registration ===

-- Register streaks
SELECT dzql.register_entity(
  'streaks',
  'name',
  array['name', 'description'],
  jsonb_build_object(
    'creator', 'users',
    'shares', 'streak_shares',
    'logs', 'streak_logs',
    'reactions', 'streak_reactions'
  ),
  false,
  '{}'::jsonb,
  jsonb_build_object(
    'owner', array['@user_id'],
    'mutual_connections', array['@user_id->mutual_connections[user1_id=$].user2_id', '@user_id->mutual_connections[user2_id=$].user1_id']
  ),
  jsonb_build_object(
    'view', array[
      '@user_id',
      '@user_id->mutual_connections[user1_id=$].user2_id',
      '@user_id->mutual_connections[user2_id=$].user1_id'
    ],
    'create', array[]::text[],
    'update', array['@user_id'],
    'delete', array['@user_id']
  ),
  jsonb_build_object(
    'on_delete', jsonb_build_object(
      'cascade_shares', jsonb_build_object(
        'description', 'Delete all shares when streak deleted',
        'actions', jsonb_build_array(
          jsonb_build_object(
            'type', 'delete',
            'entity', 'streak_shares',
            'match', jsonb_build_object('streak_id', '@id')
          )
        )
      ),
      'cascade_logs', jsonb_build_object(
        'description', 'Delete all logs when streak deleted',
        'actions', jsonb_build_array(
          jsonb_build_object(
            'type', 'delete',
            'entity', 'streak_logs',
            'match', jsonb_build_object('streak_id', '@id')
          )
        )
      ),
      'cascade_reactions', jsonb_build_object(
        'description', 'Delete all reactions when streak deleted',
        'actions', jsonb_build_array(
          jsonb_build_object(
            'type', 'delete',
            'entity', 'streak_reactions',
            'match', jsonb_build_object('streak_id', '@id')
          )
        )
      )
    )
  )
);

-- Register streak_logs
SELECT dzql.register_entity(
  'streak_logs',
  'log_date',
  array['notes'],
  jsonb_build_object('streak', 'streaks'),
  false,
  '{}'::jsonb,
  jsonb_build_object(
    'streak_owner', array['@streak_id->streaks.user_id'],
    'mutual_connections', array[
      '@streak_id->streaks.user_id->mutual_connections[user1_id=$].user2_id',
      '@streak_id->streaks.user_id->mutual_connections[user2_id=$].user1_id'
    ]
  ),
  jsonb_build_object(
    'view', array[
      '@streak_id->streaks.user_id',
      '@streak_id->streaks.user_id->mutual_connections[user1_id=$].user2_id',
      '@streak_id->streaks.user_id->mutual_connections[user2_id=$].user1_id'
    ],
    'create', array['@streak_id->streaks.user_id'],
    'update', array['@streak_id->streaks.user_id'],
    'delete', array['@streak_id->streaks.user_id']
  ),
  jsonb_build_object(
    'on_create', jsonb_build_object(
      'increment_total', jsonb_build_object(
        'description', 'Increment total logs count',
        'actions', jsonb_build_array(
          jsonb_build_object(
            'type', 'execute',
            'function', '_increment_streak_total',
            'params', jsonb_build_object('p_streak_id', '@streak_id')
          )
        )
      )
    ),
    'on_delete', jsonb_build_object(
      'decrement_total', jsonb_build_object(
        'description', 'Decrement total logs count when log deleted',
        'actions', jsonb_build_array(
          jsonb_build_object(
            'type', 'execute',
            'function', '_decrement_streak_total',
            'params', jsonb_build_object('p_streak_id', '@streak_id')
          )
        )
      )
    )
  )
);

-- Register share_connections entity
SELECT dzql.register_entity(
  'share_connections',
  'id',
  array[]::text[],
  '{}'::jsonb,
  false,
  jsonb_build_object('valid_from', 'valid_from', 'valid_to', 'valid_to'),
  jsonb_build_object(
    'involved_parties', array[
      '@email_a->users[email=$].id',
      '@email_b->users[email=$].id'
    ]
  ),
  jsonb_build_object(
    'view', array[]::text[],  -- Anyone can view active connections via mutual_connections view
    'create', array[]::text[],  -- Use create_share_connection function
    'update', array[]::text[],  -- No updates
    'delete', array[]::text[]   -- Use close_share_connection function
  ),
  '{}'::jsonb
);

-- Helper functions for share_connections

-- Function to create/reopen a connection
CREATE OR REPLACE FUNCTION create_share_connection(
  p_user_id INT,
  p_target_email TEXT
) RETURNS JSONB AS $$
DECLARE
  v_my_email TEXT;
  v_reciprocal RECORD;
  v_existing RECORD;
  v_result JSONB;
BEGIN
  -- Get my email from user_id
  SELECT email INTO v_my_email FROM users WHERE id = p_user_id;

  IF v_my_email IS NULL THEN
    RAISE EXCEPTION 'User not found: %', p_user_id;
  END IF;

  -- Verify target user exists
  IF NOT EXISTS(SELECT 1 FROM users WHERE email = p_target_email) THEN
    RAISE EXCEPTION 'Target user not found: %', p_target_email;
  END IF;

  -- Check if row (my_email, target_email) already exists and is active
  SELECT * INTO v_existing
  FROM share_connections
  WHERE email_a = v_my_email
    AND email_b = p_target_email
    AND valid_to IS NULL
  ORDER BY id DESC
  LIMIT 1;

  IF FOUND THEN
    -- Already exists and active - return existing
    RETURN jsonb_build_object(
      'id', v_existing.id,
      'email_a', v_existing.email_a,
      'email_b', v_existing.email_b,
      'created_at', v_existing.created_at,
      'valid_from', v_existing.valid_from,
      'valid_to', v_existing.valid_to
    );
  END IF;

  -- Check if reciprocal row (target_email, my_email) exists and is active
  SELECT * INTO v_reciprocal
  FROM share_connections
  WHERE email_a = p_target_email
    AND email_b = v_my_email
    AND valid_to IS NULL
  ORDER BY id DESC
  LIMIT 1;

  IF FOUND THEN
    -- Reciprocal exists! Activate it by setting valid_from
    DECLARE
      v_before JSONB;
    BEGIN
      -- Capture before state
      SELECT to_jsonb(c.*) INTO v_before FROM share_connections c WHERE id = v_reciprocal.id;

      -- Perform update
      UPDATE share_connections
      SET valid_from = CURRENT_DATE
      WHERE id = v_reciprocal.id
      RETURNING jsonb_build_object(
        'id', id,
        'email_a', email_a,
        'email_b', email_b,
        'created_at', created_at,
        'valid_from', valid_from,
        'valid_to', valid_to
      ) INTO v_result;

      -- Create event for notification
      INSERT INTO dzql.events (table_name, op, pk, before, after, user_id, notify_users)
      VALUES (
        'share_connections',
        'update',
        jsonb_build_object('id', v_reciprocal.id),
        v_before,
        v_result,
        p_user_id,
        dzql.resolve_notification_paths('share_connections', v_result)
      );

      RETURN v_result;
    END;
  END IF;

  -- No existing or reciprocal row - create new pending row
  INSERT INTO share_connections (email_a, email_b, valid_from, valid_to)
  VALUES (v_my_email, p_target_email, NULL, NULL)
  RETURNING jsonb_build_object(
    'id', id,
    'email_a', email_a,
    'email_b', email_b,
    'created_at', created_at,
    'valid_from', valid_from,
    'valid_to', valid_to
  ) INTO v_result;

  -- Create event for notification
  INSERT INTO dzql.events (table_name, op, pk, before, after, user_id, notify_users)
  VALUES (
    'share_connections',
    'insert',
    jsonb_build_object('id', (v_result->>'id')::int),
    NULL,
    v_result,
    p_user_id,
    dzql.resolve_notification_paths('share_connections', v_result)
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to close a connection (either party can close)
CREATE OR REPLACE FUNCTION close_share_connection(
  p_user_id INT,
  p_target_email TEXT
) RETURNS JSONB AS $$
DECLARE
  v_my_email TEXT;
  v_connection RECORD;
  v_before JSONB;
  v_after JSONB;
BEGIN
  -- Get my email from user_id
  SELECT email INTO v_my_email FROM users WHERE id = p_user_id;

  IF v_my_email IS NULL THEN
    RAISE EXCEPTION 'User not found: %', p_user_id;
  END IF;

  -- Verify target user exists
  IF NOT EXISTS(SELECT 1 FROM users WHERE email = p_target_email) THEN
    RAISE EXCEPTION 'Target user not found: %', p_target_email;
  END IF;

  -- Find and close connection where I'm email_a or email_b
  SELECT * INTO v_connection
  FROM share_connections
  WHERE ((email_a = v_my_email AND email_b = p_target_email)
     OR (email_a = p_target_email AND email_b = v_my_email))
    AND valid_to IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'No active connection found');
  END IF;

  -- Capture before state
  SELECT to_jsonb(c.*) INTO v_before FROM share_connections c WHERE id = v_connection.id;

  -- Close the connection
  UPDATE share_connections
  SET valid_to = CURRENT_DATE
  WHERE id = v_connection.id
  RETURNING to_jsonb(share_connections.*) INTO v_after;

  -- Create event for notification
  INSERT INTO dzql.events (table_name, op, pk, before, after, user_id, notify_users)
  VALUES (
    'share_connections',
    'update',
    jsonb_build_object('id', v_connection.id),
    v_before,
    v_after,
    p_user_id,
    dzql.resolve_notification_paths('share_connections', v_after)
  );

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Note: share_connections entity already registered above

-- Register streak_shares
SELECT dzql.register_entity(
  'streak_shares',
  'user_id',
  array[]::text[],
  jsonb_build_object(
    'streak', 'streaks',
    'user', 'users'
  ),
  false,
  '{}'::jsonb,
  jsonb_build_object(
    'shared_user', array['@user_id'],
    'streak_owner', array['@streak_id->streaks.user_id']
  ),
  jsonb_build_object(
    'view', array[
      '@streak_id->streaks.user_id',
      '@user_id'
    ],
    'create', array['@streak_id->streaks.user_id'],
    'update', array[]::text[],
    'delete', array[
      '@streak_id->streaks.user_id',
      '@user_id'
    ]
  ),
  '{}'::jsonb
);

-- Register streak_reactions
SELECT dzql.register_entity(
  'streak_reactions',
  'reaction_type',
  array['comment'],
  jsonb_build_object(
    'streak', 'streaks',
    'user', 'users'
  ),
  false,
  '{}'::jsonb,
  jsonb_build_object(
    'streak_owner', array['@streak_id->streaks.user_id'],
    'reactor', array['@user_id']
  ),
  jsonb_build_object(
    'view', array[
      '@streak_id->streaks.user_id',
      '@streak_id->streaks.user_id->mutual_connections[user1_id=$].user2_id',
      '@streak_id->streaks.user_id->mutual_connections[user2_id=$].user1_id',
      '@user_id'
    ],
    'create', array[
      '@streak_id->streaks.user_id',
      '@streak_id->streaks.user_id->mutual_connections[user1_id=$].user2_id',
      '@streak_id->streaks.user_id->mutual_connections[user2_id=$].user1_id'
    ],
    'update', array['@user_id'],
    'delete', array['@user_id']
  ),
  '{}'::jsonb
);

-- === Helper Functions ===

-- Internal function to increment streak total_logs (not callable by clients)
CREATE OR REPLACE FUNCTION _increment_streak_total(p_streak_id INT)
RETURNS JSONB AS $$
BEGIN
  UPDATE streaks SET total_logs = total_logs + 1 WHERE id = p_streak_id;
  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql;

-- Internal function to decrement streak total_logs (not callable by clients)
CREATE OR REPLACE FUNCTION _decrement_streak_total(p_streak_id INT)
RETURNS JSONB AS $$
BEGIN
  UPDATE streaks SET total_logs = total_logs - 1 WHERE id = p_streak_id;
  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql;

-- === Sample Data ===

-- Sample users
SELECT dzql.register_user('alice@streaks.app', 'password123');
SELECT dzql.register_user('bob@streaks.app', 'password123');

-- Sample streaks
INSERT INTO streaks (user_id, name, description, icon) VALUES
  ((SELECT id FROM users WHERE email = 'alice@streaks.app'),
   'Morning Run', '5K every morning', '🏃‍♀️'),
  ((SELECT id FROM users WHERE email = 'alice@streaks.app'),
   'Meditation', '10 minutes daily meditation', '🧘‍♀️'),
  ((SELECT id FROM users WHERE email = 'bob@streaks.app'),
   'Reading', 'Read for 30 minutes', '📚')
ON CONFLICT DO NOTHING;

-- Sample share
INSERT INTO streak_shares (streak_id, user_id) VALUES
  ((SELECT id FROM streaks WHERE name = 'Morning Run'),
   (SELECT id FROM users WHERE email = 'bob@streaks.app'))
ON CONFLICT DO NOTHING;

-- Sample log
INSERT INTO streak_logs (streak_id, log_date, notes) VALUES
  ((SELECT id FROM streaks WHERE name = 'Morning Run'),
   CURRENT_DATE,
   'Great run today!')
ON CONFLICT DO NOTHING;
