-- A price board. One document, the market: a quote per symbol, ticked by a feed. And a
-- watchlist per session: which symbols this person's board shows, undoable like any write.
CREATE TABLE quotes (
  symbol      TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  price       REAL NOT NULL,
  prev        REAL NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE watchlists (
  session_id  TEXT NOT NULL,
  symbol      TEXT NOT NULL REFERENCES quotes(symbol),
  seq         INTEGER NOT NULL,
  PRIMARY KEY (session_id, symbol)
);

-- The market as it opens: made-up names, made-up prices, so nothing here is anyone's advice.
INSERT INTO quotes (symbol, name, price, prev, updated_at) VALUES
  ('ALPH', 'Alpha Systems',        189.42, 189.42, 0),
  ('BRVO', 'Bravo Foods',           64.10,  64.10, 0),
  ('CHRL', 'Charlie Metals',        12.87,  12.87, 0),
  ('DLTA', 'Delta Shipping',       231.05, 231.05, 0),
  ('ECHO', 'Echo Networks',         41.66,  41.66, 0),
  ('FXTR', 'Foxtrot Energy',        98.30,  98.30, 0),
  ('GOLF', 'Golf Leisure',          27.15,  27.15, 0),
  ('HOTL', 'Hotel Holdings',       155.80, 155.80, 0),
  ('INDA', 'India Textiles',         8.92,   8.92, 0),
  ('JULT', 'Juliet Pharma',        312.44, 312.44, 0),
  ('KILO', 'Kilo Freight',          73.21,  73.21, 0),
  ('LIMA', 'Lima Water',            19.48,  19.48, 0),
  ('MIKE', 'Mike Semiconductors',  402.77, 402.77, 0),
  ('NOVA', 'November Air',          56.09,  56.09, 0),
  ('OSCR', 'Oscar Media',           33.60,  33.60, 0),
  ('PAPA', 'Papa Retail',          121.15, 121.15, 0);
