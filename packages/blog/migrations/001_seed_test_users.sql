-- Migration 001: Seed test users for blog
-- Uses register_user function to properly hash passwords

SELECT register_user('alice@blog.com', 'password123', '{"name": "Alice"}')
WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = 'alice@blog.com');

SELECT register_user('bob@blog.com', 'password123', '{"name": "Bob"}')
WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = 'bob@blog.com');
