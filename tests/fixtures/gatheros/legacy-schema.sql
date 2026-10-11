CREATE TABLE board_items (
  id           TEXT PRIMARY KEY,
  board_id     TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  x            REAL NOT NULL,
  y            REAL NOT NULL,
  width        REAL,
  height       REAL,
  rotation     REAL DEFAULT 0,
  z_index      INTEGER NOT NULL DEFAULT 0,
  data         TEXT NOT NULL DEFAULT '{}',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE TABLE boards (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  thumb_path   TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
, order_index INTEGER DEFAULT 0);
CREATE TABLE collection_items (
  collection_id  TEXT REFERENCES collections(id) ON DELETE CASCADE,
  save_id        TEXT REFERENCES saves(id) ON DELETE CASCADE,
  added_at       INTEGER NOT NULL,
  PRIMARY KEY (collection_id, save_id)
);
CREATE TABLE collections (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL,
  created_at  INTEGER NOT NULL
, order_index INTEGER DEFAULT 0, parent_id TEXT, cover_save_id TEXT);
CREATE TABLE dismissed_tweets (
  tweet_key     TEXT PRIMARY KEY,
  dismissed_at  INTEGER NOT NULL
);
CREATE TABLE save_tags (
  save_id  TEXT REFERENCES saves(id) ON DELETE CASCADE,
  tag_id   TEXT REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (save_id, tag_id)
);
CREATE TABLE saves (
  id          TEXT PRIMARY KEY,
  file_path   TEXT NOT NULL,
  thumb_path  TEXT NOT NULL,
  title       TEXT,
  source_url  TEXT,
  width       INTEGER,
  height      INTEGER,
  file_size   INTEGER,
  palette     TEXT,
  created_at  INTEGER NOT NULL
, ai_description TEXT, embedding BLOB, ocr_text TEXT, ai_prompt TEXT, deleted_at INTEGER, meta TEXT, notes TEXT, content_hash TEXT, palette_lab TEXT, kind TEXT NOT NULL DEFAULT 'image', tweet_meta TEXT, source TEXT NOT NULL DEFAULT 'x', preview_path TEXT, view_count INTEGER NOT NULL DEFAULT 0, viewed_at INTEGER, hidden_at INTEGER);
CREATE VIRTUAL TABLE saves_fts USING fts5(
        save_id UNINDEXED,
        title,
        ocr_text,
        tweet_text,
        tokenize = 'unicode61 remove_diacritics 2'
      );
CREATE TABLE tags (
  id    TEXT PRIMARY KEY,
  name  TEXT UNIQUE NOT NULL
);
CREATE INDEX idx_board_items_board_id ON board_items (board_id);
CREATE INDEX idx_boards_updated_at ON boards (updated_at DESC);
CREATE INDEX idx_saves_content_hash ON saves(content_hash);
CREATE INDEX idx_saves_created_at ON saves (created_at DESC);
CREATE INDEX idx_saves_live_created ON saves (created_at DESC) WHERE deleted_at IS NULL;
CREATE TRIGGER saves_fts_ad AFTER DELETE ON saves BEGIN
        DELETE FROM saves_fts WHERE save_id = old.id;
      END;
CREATE TRIGGER saves_fts_ai AFTER INSERT ON saves BEGIN
        INSERT INTO saves_fts (save_id, title, ocr_text, tweet_text)
        VALUES (new.id, COALESCE(new.title,''), COALESCE(new.ocr_text,''), 
      COALESCE(json_extract((CASE WHEN json_valid(new.tweet_meta) THEN new.tweet_meta END),'$.caption'),'') || ' ' ||
      COALESCE(json_extract((CASE WHEN json_valid(new.tweet_meta) THEN new.tweet_meta END),'$.authorName'),'') || ' ' ||
      COALESCE(json_extract((CASE WHEN json_valid(new.tweet_meta) THEN new.tweet_meta END),'$.authorHandle'),'') || ' ' ||
      COALESCE(json_extract((CASE WHEN json_valid(new.tweet_meta) THEN new.tweet_meta END),'$.thread'),'') || ' ' ||
      COALESCE(json_extract((CASE WHEN json_valid(new.tweet_meta) THEN new.tweet_meta END),'$.quoted.caption'),'') || ' ' ||
      COALESCE(json_extract((CASE WHEN json_valid(new.tweet_meta) THEN new.tweet_meta END),'$.quoted.authorName'),'') || ' ' ||
      COALESCE(json_extract((CASE WHEN json_valid(new.tweet_meta) THEN new.tweet_meta END),'$.quoted.authorHandle'),''));
      END;
CREATE TRIGGER saves_fts_au
      AFTER UPDATE OF title, ocr_text, tweet_meta ON saves BEGIN
        DELETE FROM saves_fts WHERE save_id = new.id;
        INSERT INTO saves_fts (save_id, title, ocr_text, tweet_text)
        VALUES (new.id, COALESCE(new.title,''), COALESCE(new.ocr_text,''), 
      COALESCE(json_extract((CASE WHEN json_valid(new.tweet_meta) THEN new.tweet_meta END),'$.caption'),'') || ' ' ||
      COALESCE(json_extract((CASE WHEN json_valid(new.tweet_meta) THEN new.tweet_meta END),'$.authorName'),'') || ' ' ||
      COALESCE(json_extract((CASE WHEN json_valid(new.tweet_meta) THEN new.tweet_meta END),'$.authorHandle'),'') || ' ' ||
      COALESCE(json_extract((CASE WHEN json_valid(new.tweet_meta) THEN new.tweet_meta END),'$.thread'),'') || ' ' ||
      COALESCE(json_extract((CASE WHEN json_valid(new.tweet_meta) THEN new.tweet_meta END),'$.quoted.caption'),'') || ' ' ||
      COALESCE(json_extract((CASE WHEN json_valid(new.tweet_meta) THEN new.tweet_meta END),'$.quoted.authorName'),'') || ' ' ||
      COALESCE(json_extract((CASE WHEN json_valid(new.tweet_meta) THEN new.tweet_meta END),'$.quoted.authorHandle'),''));
      END;
