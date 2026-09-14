-- The wedding's tables, from the brief's "The model, derived from the stories" / "the rest"
-- (apples_pears/examples/wedding/brief.md). One wedding; households addressed by their invitation
-- code; guests standing on a household; a minifigure standing on each guest, one each. The
-- kernel's own migrations share this database (and so do another example's, if run against the
-- same file), so no table here is named `sessions`: this example's per-connection document is a
-- `visit`.
PRAGMA foreign_keys = ON;

-- The one thing everything belongs to. The couple arrive by its code, as a household arrives by
-- theirs: every subject is a code, there is no users table. The welcome (names, message, picture)
-- lives here too, since there is one welcome per wedding.
CREATE TABLE weddings (
  id          INTEGER PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  day         TEXT NOT NULL,
  deadline    TEXT,
  name1       TEXT NOT NULL,
  name2       TEXT NOT NULL,
  venue       TEXT,
  message     TEXT,
  picture_key TEXT
);

-- One invitation, one code, one answer. `plus_ones` is how many more the household may name
-- beyond those the couple named. The code may be left NULL on insert: the trigger below mints one
-- from the email at once, so no code-less row is ever visible outside that statement.
CREATE TABLE households (
  id          INTEGER PRIMARY KEY,
  wedding_id  INTEGER NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  code        TEXT UNIQUE,
  email       TEXT NOT NULL,
  plus_ones   INTEGER NOT NULL DEFAULT 0,
  answer      TEXT CHECK (answer IN ('yes', 'maybe', 'no')),
  message     TEXT
);

CREATE TRIGGER households_mint_code AFTER INSERT ON households WHEN NEW.code IS NULL BEGIN
  -- the part of the email before the @, up to six letters, upper-case, then the id so it never collides: grace@example.com -> GRACE3
  UPDATE households SET code = upper(substr(email, 1, min(6, instr(email, '@') - 1))) || NEW.id WHERE id = NEW.id;
END;

-- A person the couple named on the invitation, a plus-one the household named, or someone an ask
-- brought in (`named_by`). `coming` is the household's word on each, null until said.
CREATE TABLE guests (
  id            INTEGER PRIMARY KEY,
  household_id  INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  named_by      TEXT NOT NULL DEFAULT 'couple' CHECK (named_by IN ('couple', 'household', 'ask')),
  coming        INTEGER
);

-- A guest's little Lego self, one each, blank until built (built_at null). Whether it stands in
-- the photo is the household's answer and the guest's coming, never a field here.
CREATE TABLE minifigures (
  guest_id    INTEGER PRIMARY KEY REFERENCES guests(id) ON DELETE CASCADE,
  skin        TEXT NOT NULL,
  hair        TEXT NOT NULL CHECK (hair IN ('none', 'short', 'bob', 'long', 'curls')),
  hair_color  TEXT NOT NULL,
  top         TEXT NOT NULL,
  legs        TEXT NOT NULL,
  face        TEXT NOT NULL CHECK (face IN ('smile', 'grin', 'wink', 'wry', 'exasperated', 'laugh')),
  attitude    TEXT NOT NULL CHECK (attitude IN ('waving', 'nodding', 'laughing', 'cool', 'photo-bombing')),
  built_at    TEXT
);

-- Every guest arrives with a blank minifigure, so a write to it is always a replace of a field on a
-- row that exists, and the household's photo always has a figure to draw for everyone named.
CREATE TRIGGER guests_make_minifigure AFTER INSERT ON guests BEGIN
  INSERT INTO minifigures (guest_id, skin, hair, hair_color, top, legs, face, attitude, built_at)
  VALUES (NEW.id, '#F2C86A', 'none', '#2B2B33', '#1E3F8F', '#2B2B33', 'smile', 'nodding', NULL);
END;

-- A stage of the meal the couple design: the starter, the main, dessert, the toast.
CREATE TABLE courses (
  id          INTEGER PRIMARY KEY,
  wedding_id  INTEGER NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  seq         INTEGER NOT NULL
);

-- Food on offer in a course, with its dietary marks (a comma-separated list: "v, gf").
CREATE TABLE dishes (
  id          INTEGER PRIMARY KEY,
  course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  dietary     TEXT,
  seq         INTEGER NOT NULL,
  UNIQUE (id, course_id)
);

-- Drink on offer in a course.
CREATE TABLE drinks (
  id          INTEGER PRIMARY KEY,
  course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  UNIQUE (id, course_id)
);

-- A guest's pick in a course: a dish, a drink, or both, one row per guest per course. The
-- composite foreign keys make a dish or drink belong to the choice's own course.
CREATE TABLE choices (
  id          INTEGER PRIMARY KEY,
  guest_id    INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  dish_id     INTEGER,
  drink_id    INTEGER,
  UNIQUE (guest_id, course_id),
  FOREIGN KEY (dish_id, course_id) REFERENCES dishes(id, course_id),
  FOREIGN KEY (drink_id, course_id) REFERENCES drinks(id, course_id)
);

-- A household asking to bring someone else, by name; the couple reply yes or no. A yes makes a
-- guest, and `guest_id` remembers which, so a later no (or an undo) can take them back out.
CREATE TABLE asks (
  id            INTEGER PRIMARY KEY,
  household_id  INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  asked_at      TEXT NOT NULL,
  reply         TEXT CHECK (reply IN ('yes', 'no')),
  guest_id      INTEGER REFERENCES guests(id) ON DELETE SET NULL
);

-- On the gift list; claimed by a household or by nobody, or shared (the honeymoon fund), claimed by
-- any number. A claim is a row of its own, so a household sees its own claims and every other
-- household sees only how many a gift has, never whose.
CREATE TABLE gifts (
  id           INTEGER PRIMARY KEY,
  wedding_id   INTEGER NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  link         TEXT,
  picture_key  TEXT,
  seq          INTEGER NOT NULL,
  shared       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE gift_claims (
  id            INTEGER PRIMARY KEY,
  gift_id       INTEGER NOT NULL REFERENCES gifts(id) ON DELETE CASCADE,
  household_id  INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  claimed_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (gift_id, household_id)
);

-- A gift that is not shared takes one claim: the store refuses a second, so it is the store that
-- says "taken" when two households claim at once, not the client.
CREATE TRIGGER gifts_one_claim BEFORE INSERT ON gift_claims BEGIN
  SELECT RAISE(ABORT, 'taken: this gift is already claimed')
  WHERE (SELECT shared FROM gifts WHERE id = NEW.gift_id) = 0 AND EXISTS (SELECT 1 FROM gift_claims WHERE gift_id = NEW.gift_id);
END;

-- A part of the day: a name, a time, a place.
CREATE TABLE events (
  id          INTEGER PRIMARY KEY,
  wedding_id  INTEGER NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  when_at     TEXT,
  where_at    TEXT,
  notes       TEXT,
  seq         INTEGER NOT NULL
);

-- A place to sleep and how to get there.
CREATE TABLE places (
  id           INTEGER PRIMARY KEY,
  wedding_id   INTEGER NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  notes        TEXT,
  link         TEXT,
  picture_key  TEXT,
  seq          INTEGER NOT NULL
);

-- The pictures the couple keep (the welcome's, a gift's, a place's), by key: bytes in the same
-- database as everything else, so the example needs no bucket. Served by this example's own
-- /pictures/<key> route.
CREATE TABLE pictures (
  key         TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  bytes       BLOB NOT NULL,
  created_at  INTEGER NOT NULL
);

-- A visit: what one session (the kernel's session_id cookie) is doing on the site. `code` is who
-- they are, a household's or the couple's, null before they enter one; `ui` is where they are --
-- the page, which drawer is open, how a collection is being read -- as JSON, since the kernel
-- renders the whole page server-side and the client keeps no state of its own; `note` is the one
-- line the welcome says back (a code not recognised, a resend acknowledged).
CREATE TABLE visits (
  id          TEXT PRIMARY KEY,
  code        TEXT,
  ui          TEXT NOT NULL DEFAULT '{}',
  note        TEXT,
  created_at  INTEGER NOT NULL
);
