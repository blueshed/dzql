-- Demo data: Nick & Nora's wedding, two households, the courses, a waiting ask, the gifts
-- (with their drawings), the day, where to stay and the venues they chose between. The couple's code is NICK; the households'
-- are OKAFOR and BEN. Run once, into empty tables (../delta.ts). Ids are numbers, as delta's serials name them.
INSERT INTO wedding_weddings (id, day, deadline, name1, name2, venue, message, picture_key) VALUES
  (1, '2027-04-02', NULL, 'Nick', 'Nora', 'The Mount Without, Bristol', 'We can''t wait to celebrate with you.', NULL);

-- the couple's code, kept apart from the wedding's row, which every household reads
INSERT INTO wedding_couples (id, weddings_id, code) VALUES (1, 1, 'NICK');

INSERT INTO wedding_households (id, weddings_id, code, email, plus_ones, answer, message) VALUES
  (1, 1, 'OKAFOR', 'ada@example.com', 1, 'yes', 'Cannot wait.'),
  (2, 1, 'BEN',    'ben@example.com', 0, NULL, NULL);

-- every guest wears a blank minifigure (the columns' defaults) until built; guest 2's is built
INSERT INTO wedding_guests (id, households_id, name, named_by, coming) VALUES
  (1, 1, 'Ada Okafor', 'couple', 1), (2, 1, 'Femi Okafor', 'couple', 1), (3, 2, 'Ben Achterberg', 'couple', NULL);

UPDATE wedding_guests SET
  skin = '#E0A97A', hair = 'short', hair_color = '#2B2B33', top = '#1E3F8F', legs = '#2B2B33',
  face = 'grin', attitude = 'cool', built_at = '2026-09-01T09:00:00Z'
  WHERE id = 2;
UPDATE wedding_guests SET top = '#7FAE4E' WHERE id = 3; -- Ben, not yet built, in green

INSERT INTO wedding_courses (id, weddings_id, name, seq) VALUES
  (1, 1, 'Starter', 1), (2, 1, 'Main', 2), (3, 1, 'Dessert', 3), (4, 1, 'The toast', 4);

INSERT INTO wedding_dishes (id, courses_id, name, dietary, seq) VALUES
  (1, 1, 'Pea and mint soup', 'v', 1),
  (2, 1, 'Burrata', 'v, gf', 2),
  (3, 1, 'Devon crab', NULL, 3),
  (4, 2, 'Roast beef', 'gf', 1),
  (5, 2, 'Sea bass', 'gf', 2),
  (6, 2, 'Wild mushroom risotto', 'v, gf', 3),
  (7, 3, 'Lemon tart', 'v', 1),
  (8, 3, 'Chocolate torte', NULL, 2);

INSERT INTO wedding_drinks (id, courses_id, name, seq) VALUES
  (1, 1, 'Prosecco', 1), (2, 1, 'Elderflower', 2),
  (3, 2, 'Rioja', 1), (4, 2, 'Picpoul', 2), (5, 2, 'Water', 3),
  (6, 4, 'Champagne', 1), (7, 4, 'A cocktail', 2), (8, 4, 'Something soft', 3);

INSERT INTO wedding_asks (id, households_id, name, asked_at, reply) VALUES
  (1, 1, 'Kemi Okafor', '2026-09-01T08:00:00Z', NULL);

INSERT INTO wedding_gifts (id, weddings_id, name, description, link, picture_key, seq, shared) VALUES
  (1, 1, 'Le Creuset casserole', 'The big red one.', NULL, 'seed/casserole.svg', 1, 0),
  (2, 1, 'Honeymoon fund', 'Towards the trip to Kerala. Any amount, from anyone.', NULL, 'seed/honeymoon.svg', 2, 1),
  (3, 1, 'A set of good knives', 'Sharp, please.', NULL, 'seed/knives.svg', 3, 0);

INSERT INTO wedding_events (id, weddings_id, name, when_at, where_at, notes, seq) VALUES
  (1, 1, 'Ceremony', '2027-04-02T13:00', 'The Mount Without', NULL, 1),
  (2, 1, 'Wedding breakfast', '2027-04-02T14:30', 'The Mount Without', NULL, 2),
  (3, 1, 'Evening party', '2027-04-02T19:00', 'The Mount Without', NULL, 3);

INSERT INTO wedding_places (id, weddings_id, name, notes, link, picture_key, seq) VALUES
  (1, 1, 'The Mount Without rooms', 'A few rooms on site, first come first served.', NULL, 'seed/mount-without.svg', 1),
  (2, 1, 'Brooks Guesthouse', '10 minutes'' walk.', NULL, 'seed/guesthouse.svg', 2);

INSERT INTO wedding_venues (id, weddings_id, name, notes, picture_key) VALUES
  (1, 1, 'The Mount Without', 'Booked for the day.', NULL),
  (2, 1, 'Clifton Observatory', 'Too small for the party.', NULL);

-- The seed's own drawings, in the same store the couple's uploads go to.
INSERT INTO wedding_pictures (key, type, bytes, created_at) VALUES
  ('seed/casserole.svg', 'image/svg+xml', CAST('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240" role="img" aria-label="a red casserole"><rect width="320" height="240" fill="#F3EDE0"/><ellipse cx="160" cy="200" rx="120" ry="12" fill="#E9E1CD"/><rect x="34" y="122" width="30" height="18" rx="9" fill="#63243C"/><rect x="256" y="122" width="30" height="18" rx="9" fill="#63243C"/><rect x="56" y="104" width="208" height="92" rx="24" fill="#7B2F4B"/><rect x="66" y="82" width="188" height="30" rx="15" fill="#63243C"/><rect x="148" y="66" width="24" height="20" rx="8" fill="#C9A227"/><rect x="80" y="126" width="26" height="46" rx="10" fill="#8F3E5E" opacity="0.8"/></svg>' AS BLOB), 0),
  ('seed/honeymoon.svg', 'image/svg+xml', CAST('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240" role="img" aria-label="a suitcase by the sea"><rect width="320" height="240" fill="#F3EDE0"/><circle cx="250" cy="66" r="28" fill="#C9A227"/><rect x="0" y="150" width="320" height="90" fill="#1E3F8F"/><path d="M0 158 Q20 148 40 158 T80 158 T120 158 T160 158 T200 158 T240 158 T280 158 T320 158 V172 Q300 162 280 172 T240 172 T200 172 T160 172 T120 172 T80 172 T40 172 T0 172 Z" fill="#4A6BC4" opacity="0.7"/><rect x="104" y="92" width="44" height="18" rx="7" fill="#2B2B33"/><rect x="62" y="104" width="128" height="88" rx="12" fill="#7B2F4B"/><rect x="62" y="132" width="128" height="8" fill="#63243C"/><rect x="116" y="126" width="20" height="20" rx="4" fill="#C9A227"/></svg>' AS BLOB), 0),
  ('seed/knives.svg', 'image/svg+xml', CAST('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240" role="img" aria-label="three kitchen knives on a board"><rect width="320" height="240" fill="#F3EDE0"/><rect x="34" y="34" width="252" height="172" rx="18" fill="#E0C070"/><rect x="48" y="48" width="224" height="144" rx="12" fill="#E9D48A" opacity="0.6"/><g transform="translate(70 70)"><path d="M0 8 L118 0 L140 8 L118 16 Z" fill="#F3EDE0" stroke="#C9C2B2" stroke-width="1.5"/><rect x="-62" y="0" width="64" height="16" rx="6" fill="#2B2B33"/><circle cx="-44" cy="8" r="2.5" fill="#C9A227"/><circle cx="-18" cy="8" r="2.5" fill="#C9A227"/></g><g transform="translate(78 112)"><path d="M0 8 L92 1 L108 8 L92 15 Z" fill="#F3EDE0" stroke="#C9C2B2" stroke-width="1.5"/><rect x="-56" y="0" width="58" height="16" rx="6" fill="#2B2B33"/><circle cx="-40" cy="8" r="2.5" fill="#C9A227"/><circle cx="-16" cy="8" r="2.5" fill="#C9A227"/></g><g transform="translate(86 154)"><path d="M0 8 L62 3 L74 8 L62 13 Z" fill="#F3EDE0" stroke="#C9C2B2" stroke-width="1.5"/><rect x="-50" y="0" width="52" height="16" rx="6" fill="#2B2B33"/><circle cx="-34" cy="8" r="2.5" fill="#C9A227"/><circle cx="-14" cy="8" r="2.5" fill="#C9A227"/></g></svg>' AS BLOB), 0),
  ('seed/mount-without.svg', 'image/svg+xml', CAST('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240" role="img" aria-label="a church with a tower"><rect width="320" height="240" fill="#F3EDE0"/><rect x="0" y="196" width="320" height="44" fill="#7FAE4E"/><rect x="112" y="96" width="168" height="100" fill="#E9E1CD"/><path d="M104 100 L196 52 L288 100 Z" fill="#1E3F8F"/><rect x="44" y="60" width="64" height="136" fill="#E9E1CD"/><path d="M38 62 L76 18 L114 62 Z" fill="#1E3F8F"/><path d="M66 90 a10 10 0 0 1 20 0 v26 h-20 z" fill="#1E3F8F"/><path d="M66 136 a10 10 0 0 1 20 0 v26 h-20 z" fill="#1E3F8F"/><path d="M140 120 a11 11 0 0 1 22 0 v30 h-22 z" fill="#1E3F8F"/><path d="M230 120 a11 11 0 0 1 22 0 v30 h-22 z" fill="#1E3F8F"/><path d="M180 150 a16 16 0 0 1 32 0 v46 h-32 z" fill="#C9A227"/><circle cx="196" cy="86" r="9" fill="#C9A227"/></svg>' AS BLOB), 0),
  ('seed/guesthouse.svg', 'image/svg+xml', CAST('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240" role="img" aria-label="a guesthouse"><rect width="320" height="240" fill="#F3EDE0"/><rect x="0" y="196" width="320" height="44" fill="#7FAE4E"/><rect x="70" y="84" width="180" height="112" fill="#C97D83"/><path d="M58 88 L160 34 L262 88 Z" fill="#1E3F8F"/><rect x="196" y="44" width="18" height="34" fill="#2B2B33"/><rect x="92" y="104" width="30" height="34" rx="3" fill="#F3EDE0" stroke="#1E3F8F" stroke-width="3"/><rect x="145" y="104" width="30" height="34" rx="3" fill="#F3EDE0" stroke="#1E3F8F" stroke-width="3"/><rect x="198" y="104" width="30" height="34" rx="3" fill="#F3EDE0" stroke="#1E3F8F" stroke-width="3"/><rect x="92" y="152" width="30" height="34" rx="3" fill="#F3EDE0" stroke="#1E3F8F" stroke-width="3"/><rect x="198" y="152" width="30" height="34" rx="3" fill="#F3EDE0" stroke="#1E3F8F" stroke-width="3"/><path d="M146 196 v-36 a14 14 0 0 1 28 0 v36 z" fill="#C9A227"/><rect x="134" y="66" width="52" height="14" rx="4" fill="#F3EDE0"/><rect x="140" y="71" width="40" height="4" rx="2" fill="#1E3F8F"/></svg>' AS BLOB), 0);
