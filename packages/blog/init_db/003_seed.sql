-- Seed Data
-- Create initial users using register_user function

DO $$
DECLARE
  v_alice_profile JSONB;
  v_bob_profile JSONB;
BEGIN
  -- Register Alice (password: password123)
  BEGIN
    v_alice_profile := register_user('alice@blog.com', 'password123');
    RAISE NOTICE 'Created user: %', v_alice_profile->>'email';
  EXCEPTION
    WHEN unique_violation THEN
      RAISE NOTICE 'User alice@blog.com already exists';
  END;

  -- Register Bob (password: password123)
  BEGIN
    v_bob_profile := register_user('bob@blog.com', 'password123');
    RAISE NOTICE 'Created user: %', v_bob_profile->>'email';
  EXCEPTION
    WHEN unique_violation THEN
      RAISE NOTICE 'User bob@blog.com already exists';
  END;
END $$;
