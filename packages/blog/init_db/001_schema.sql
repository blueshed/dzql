-- ============================================================================
-- Blog Application Entity Definitions
-- Tables and DZQL entity registrations
-- ============================================================================

-- Create tables
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS posts (
  id SERIAL PRIMARY KEY,
  title VARCHAR(500) NOT NULL,
  content TEXT NOT NULL,
  summary TEXT,
  author_id INT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS comments (
  id SERIAL PRIMARY KEY,
  content TEXT NOT NULL,
  post_id INT REFERENCES posts(id),
  author_id INT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Seed data will be added after auth functions are loaded
-- See init_db/003_seed.sql for user registration

-- ============================================================================
