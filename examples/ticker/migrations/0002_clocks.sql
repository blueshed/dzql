-- The clock: which city's time this session's clock shows. One row per session, made on first
-- write; a session with none shows CLOCK_TZ (Europe/Zurich).
CREATE TABLE clocks (
  session_id  TEXT PRIMARY KEY,
  tz          TEXT NOT NULL
);
