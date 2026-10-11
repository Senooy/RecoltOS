-- RecoltOS : schéma initial (ARCHI §4.3 et §4.5 + delta PLAN §4.2, ERRATA §G).
-- Possédé par WP-00 puis Fable ; gelé au tag m1 (ensuite : migrations 0002+).
-- Convention : `id INTEGER PRIMARY KEY` interne (rowid stable, FTS, clés étrangères) et
-- `uuid TEXT UNIQUE` exposé (IPC, noms de fichiers). Horodatages en ms epoch.
-- `PRAGMA user_version` est posé par `db/migrate.ts`, pas par ce fichier.
-- Pas de table d'embeddings (recherche visuelle supprimée de la V1).

-- ===================== AUTEURS (cache d'avatars partagé) =====================
CREATE TABLE authors (
  id                 INTEGER PRIMARY KEY,
  platform           TEXT    NOT NULL,                  -- x|instagram|cosmos|web
  handle             TEXT    NOT NULL COLLATE NOCASE,   -- sans '@'
  name               TEXT,
  avatar_url         TEXT,                              -- dernière URL distante connue (provenance)
  avatar_rel         TEXT,                              -- avatars/<platform>/<k>.jpg une fois téléchargé
  avatar_status      TEXT    NOT NULL DEFAULT 'none' CHECK (avatar_status IN ('none','ok','expired','failed')),
  sample_external_id TEXT,                              -- un id de post de cet auteur, pour item.refresh
  updated_at         INTEGER NOT NULL,                  -- sert aussi de ?v= pour l'avatar
  UNIQUE (platform, handle)
);

-- ===================== ITEMS =====================
CREATE TABLE items (
  id              INTEGER PRIMARY KEY,
  uuid            TEXT    NOT NULL UNIQUE,
  kind            TEXT    NOT NULL CHECK (kind IN ('image','video','tweet','url')),
  source          TEXT    NOT NULL DEFAULT 'local',   -- local|capture|web|x|instagram|cosmos (enum zod)
  external_id     TEXT,
  source_url      TEXT,
  author_id       INTEGER REFERENCES authors(id) ON DELETE SET NULL,
  title           TEXT,
  title_source    TEXT CHECK (title_source IN ('user','ai','source','import')),
  name_key        TEXT    NOT NULL DEFAULT (char(65535)), -- tri « Nom » ; U+FFFF = sans titre, en dernier
  notes           TEXT,
  cover_media_id  INTEGER REFERENCES item_media(id) ON DELETE SET NULL,
  media_count     INTEGER NOT NULL DEFAULT 1,
  palette         TEXT CHECK (palette IS NULL OR json_valid(palette)),                 -- ["#rrggbb", …] 1..8
  palette_lab     TEXT CHECK (palette_lab IS NULL OR json_valid(palette_lab)),         -- [[L,a,b], …] D65
  palette_weights TEXT CHECK (palette_weights IS NULL OR json_valid(palette_weights)), -- parts ; NULL = pondération par rang
  color_l         REAL, color_c REAL, color_h REAL,
  color_bucket    INTEGER NOT NULL DEFAULT 13,         -- 0..11 teinte, 12 neutre, 13 inconnu
  color_key       REAL GENERATED ALWAYS AS (color_bucket * 1000 + (100 - coalesce(color_l, 0))) VIRTUAL,
  post_meta       TEXT CHECK (post_meta IS NULL OR json_valid(post_meta)),             -- PostMetaSchema v1
  posted_at       INTEGER,
  ai_title        TEXT,
  ai_description  TEXT,
  ai_tags         TEXT CHECK (ai_tags IS NULL OR json_valid(ai_tags)),
  ocr_text        TEXT,
  ai_prompt       TEXT,
  ai_state        TEXT NOT NULL DEFAULT 'none' CHECK (ai_state IN ('none','queued','done','failed','skipped')),
  ai_provider     TEXT,                                -- claude|codex|gatheros
  ai_model        TEXT,
  ai_lang         TEXT,
  ai_excluded     INTEGER NOT NULL DEFAULT 0,          -- « Ne jamais envoyer à l'IA »
  ai_updated_at   INTEGER,
  origin          TEXT NOT NULL DEFAULT 'app',         -- app|extension|sync|capture|gatheros
  origin_id       TEXT,                                -- ex. id du save GatherOS
  legacy_hash     TEXT,                                -- content_hash GatherOS (non fiable pour les images)
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  viewed_at       INTEGER,
  view_count      INTEGER NOT NULL DEFAULT 0,
  hidden_at       INTEGER,
  deleted_at      INTEGER
);
CREATE UNIQUE INDEX ux_items_origin       ON items(origin, origin_id) WHERE origin_id IS NOT NULL;
CREATE INDEX ix_items_live_created        ON items(created_at DESC, id DESC) WHERE deleted_at IS NULL AND hidden_at IS NULL;
CREATE INDEX ix_items_live_name           ON items(name_key, id)            WHERE deleted_at IS NULL AND hidden_at IS NULL;
CREATE INDEX ix_items_live_color          ON items(color_key, id)           WHERE deleted_at IS NULL AND hidden_at IS NULL;
CREATE INDEX ix_items_live_kind           ON items(kind, created_at DESC)   WHERE deleted_at IS NULL AND hidden_at IS NULL;
CREATE INDEX ix_items_live_source         ON items(source, created_at DESC) WHERE deleted_at IS NULL AND hidden_at IS NULL;
CREATE INDEX ix_items_trash               ON items(deleted_at DESC, id DESC) WHERE deleted_at IS NOT NULL;
CREATE INDEX ix_items_hidden              ON items(hidden_at DESC, id DESC)  WHERE hidden_at IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX ix_items_viewed              ON items(viewed_at DESC)           WHERE viewed_at IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX ix_items_source_ext          ON items(source, external_id)      WHERE external_id IS NOT NULL;
CREATE INDEX ix_items_ai_pending          ON items(ai_state)                 WHERE ai_state IN ('queued','failed');
CREATE INDEX ix_items_author              ON items(author_id)                WHERE author_id IS NOT NULL;

-- ===================== MÉDIAS (1..n par item, position 0 = principal) =====================
CREATE TABLE item_media (
  id                INTEGER PRIMARY KEY,
  uuid              TEXT    NOT NULL UNIQUE,
  item_id           INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  position          INTEGER NOT NULL,
  role              TEXT    NOT NULL DEFAULT 'original' CHECK (role IN ('original','render','screenshot')),
  media_type        TEXT    NOT NULL CHECK (media_type IN ('image','video')),
  status            TEXT    NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','processing','remote','missing','failed')),
  file_rel          TEXT,                 -- items/<ab>/<uuid>.<ext> ; NULL si remote/missing
  mime              TEXT,
  width             INTEGER,
  height            INTEGER,
  file_size         INTEGER,
  duration_ms       INTEGER,
  has_audio         INTEGER,
  is_animated       INTEGER NOT NULL DEFAULT 0,
  playable          INTEGER NOT NULL DEFAULT 1,
  content_hash      TEXT,                 -- sha256 hex des octets stockés
  thumb_rel         TEXT,                 -- thumbs/<ab>/<uuid>.webp (800w q80)
  large_rel         TEXT,                 -- large/<ab>/<uuid>.webp (1440w)
  poster_rel        TEXT,                 -- posters/<ab>/<uuid>.jpg
  preview_rel       TEXT,                 -- previews/<ab>/<uuid>.mp4 (540p ≤ 8 s muet)
  display_rel       TEXT,                 -- display/<ab>/<uuid>.webp (HEIC/HEIF/TIFF/PSD)
  legacy_thumb_rel  TEXT,                 -- miniature GatherOS copiée, supprimée après media.derive
  derive_version    INTEGER NOT NULL DEFAULT 0,
  remote_url        TEXT,
  remote_poster_url TEXT,
  origin_id         TEXT,                 -- basename du fichier GatherOS
  created_at        INTEGER NOT NULL,
  UNIQUE (item_id, position)
);
CREATE INDEX ix_media_hash   ON item_media(content_hash) WHERE content_hash IS NOT NULL;
CREATE INDEX ix_media_status ON item_media(status)       WHERE status <> 'ok';

-- ===================== COLLECTIONS (imbriquées) =====================
CREATE TABLE collections (
  id            INTEGER PRIMARY KEY,
  uuid          TEXT    NOT NULL UNIQUE,
  parent_id     INTEGER REFERENCES collections(id) ON DELETE CASCADE,
  name          TEXT    NOT NULL,
  color         TEXT    NOT NULL DEFAULT '#007aff',
  cover_item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
  order_index   REAL    NOT NULL DEFAULT 0,
  ai_excluded   INTEGER NOT NULL DEFAULT 0,
  origin        TEXT    NOT NULL DEFAULT 'app',
  origin_id     TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  viewed_at     INTEGER
);
CREATE INDEX ix_collections_parent        ON collections(parent_id, order_index);
CREATE UNIQUE INDEX ux_collections_origin ON collections(origin, origin_id) WHERE origin_id IS NOT NULL;

CREATE TABLE collection_items (
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  item_id       INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  added_at      INTEGER NOT NULL,
  order_index   REAL,
  PRIMARY KEY (collection_id, item_id)
) WITHOUT ROWID;
CREATE INDEX ix_ci_item        ON collection_items(item_id);
CREATE INDEX ix_ci_coll_added  ON collection_items(collection_id, added_at DESC);

-- ===================== TAGS =====================
CREATE TABLE tags (
  id         INTEGER PRIMARY KEY,
  uuid       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,   -- trim, NFC, minuscules, espaces → '-' ; noms de source réservés
  color      TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE item_tags (
  item_id    INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag_id     INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  source     TEXT    NOT NULL DEFAULT 'user' CHECK (source IN ('user','ai','import')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (item_id, tag_id)
) WITHOUT ROWID;
CREATE INDEX ix_item_tags_tag ON item_tags(tag_id, item_id);

-- ===================== SPACES (toiles infinies) =====================
CREATE TABLE spaces (
  id               INTEGER PRIMARY KEY,
  uuid             TEXT    NOT NULL UNIQUE,
  name             TEXT    NOT NULL DEFAULT '',
  viewport         TEXT    NOT NULL DEFAULT '{"x":0,"y":0,"zoom":1}' CHECK (json_valid(viewport)),
  background       TEXT    NOT NULL DEFAULT 'dots' CHECK (background IN ('dots','grid','plain')),
  thumb_rel        TEXT,                -- réservé (vignette = rendu DOM réduit, aucune image en V1)
  thumb_updated_at INTEGER,             -- réservé
  order_index      REAL    NOT NULL DEFAULT 0,
  origin           TEXT    NOT NULL DEFAULT 'app',
  origin_id        TEXT,                -- id du board GatherOS
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  viewed_at        INTEGER,
  deleted_at       INTEGER
);
CREATE INDEX ix_spaces_updated       ON spaces(updated_at DESC) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX ux_spaces_origin ON spaces(origin, origin_id) WHERE origin_id IS NOT NULL;

CREATE TABLE space_nodes (
  id         INTEGER PRIMARY KEY,
  uuid       TEXT    NOT NULL UNIQUE,
  space_id   INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  type       TEXT    NOT NULL CHECK (type IN ('item','image','note','shape','text')),
  item_id    INTEGER REFERENCES items(id) ON DELETE SET NULL,  -- purge : « Élément supprimé »
  asset_rel  TEXT,                                             -- spaces/assets/<ab>/<sha256>.<ext>
  x          REAL    NOT NULL,
  y          REAL    NOT NULL,
  width      REAL    NOT NULL CHECK (width  >= 24),            -- MIN_NODE_SIZE
  height     REAL    NOT NULL CHECK (height >= 24),
  rotation   REAL    NOT NULL DEFAULT 0,
  z          INTEGER NOT NULL DEFAULT 0,
  locked     INTEGER NOT NULL DEFAULT 0,
  content    TEXT,
  style      TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(style)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX ix_space_nodes_space ON space_nodes(space_id, z);
CREATE INDEX ix_space_nodes_item  ON space_nodes(item_id)   WHERE item_id   IS NOT NULL;
CREATE INDEX ix_space_nodes_asset ON space_nodes(asset_rel) WHERE asset_rel IS NOT NULL;

-- ===================== IA : lots, journal des appels, Rediscover =====================
CREATE TABLE ai_batches (
  id          INTEGER PRIMARY KEY,
  uuid        TEXT    NOT NULL UNIQUE,
  label       TEXT    NOT NULL,
  scope       TEXT    NOT NULL CHECK (scope IN ('unanalyzed','regenerate-fr','all','import','collection')),
  total       INTEGER NOT NULL,
  state       TEXT    NOT NULL DEFAULT 'running' CHECK (state IN ('running','paused','done','cancelled')),
  options     TEXT CHECK (options IS NULL OR json_valid(options)),
  created_at  INTEGER NOT NULL,
  finished_at INTEGER
);

-- ===================== JOBS PERSISTANTS (file unique, priority DESC) =====================
CREATE TABLE jobs (
  id           INTEGER PRIMARY KEY,
  type         TEXT    NOT NULL CHECK (type IN ('media.derive','media.preview','media.download','remote.fetch',
                                                'avatar.fetch','ai.enrich','ai.prompt','purge.files')),
  item_id      INTEGER REFERENCES items(id) ON DELETE CASCADE,   -- NULL pour avatar.fetch, remote.fetch, purge.files
  dedupe_key   TEXT,                                             -- 'item:<id>', 'media:<id>', 'author:<id>', 'url:<sha1>'
  payload      TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(payload)),  -- {…, failedOn: []}
  state        TEXT    NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','done','failed','cancelled')),
  priority     INTEGER NOT NULL DEFAULT 0,                       -- MANUAL=100 … BACKGROUND=10 (src/shared/jobs.ts)
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_error   TEXT,                                             -- JSON {code,message}
  run_after    INTEGER NOT NULL DEFAULT 0,                       -- ≡ not_before
  batch_id     INTEGER REFERENCES ai_batches(id) ON DELETE SET NULL,
  provider     TEXT,                                             -- claude|codex, fixé à l'exécution
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX ix_jobs_pick          ON jobs(type, state, priority DESC, run_after, id) WHERE state = 'queued';
CREATE INDEX ix_jobs_running       ON jobs(type) WHERE state = 'running';
CREATE INDEX ix_jobs_batch         ON jobs(batch_id, state) WHERE batch_id IS NOT NULL;
CREATE UNIQUE INDEX ux_jobs_active ON jobs(type, dedupe_key) WHERE state IN ('queued','running') AND dedupe_key IS NOT NULL;

CREATE TABLE ai_calls (                         -- journal des envois et base du budget ; rétention 90 j
  id              INTEGER PRIMARY KEY,
  ts              INTEGER NOT NULL,
  job_id          INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  item_id         INTEGER REFERENCES items(id) ON DELETE SET NULL,
  priority        INTEGER,
  provider        TEXT    NOT NULL,
  model           TEXT,
  task            TEXT    NOT NULL,
  sent_files      TEXT    NOT NULL CHECK (json_valid(sent_files)),   -- [{name,bytes,width,height}]
  sent_text_chars INTEGER NOT NULL,
  prompt_sha256   TEXT    NOT NULL,
  duration_ms     INTEGER,
  outcome         TEXT    NOT NULL CHECK (outcome IN ('ok','error','rate_limited','cancelled','timeout','violation')),
  error_code      TEXT,
  usage           TEXT CHECK (usage IS NULL OR json_valid(usage))
);
CREATE INDEX ix_ai_calls_provider_ts ON ai_calls(provider, ts);
CREATE INDEX ix_ai_calls_ts          ON ai_calls(ts);

CREATE TABLE rediscover_log (
  id            INTEGER PRIMARY KEY,
  item_id       INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  session_id    TEXT    NOT NULL,
  shown_at      INTEGER NOT NULL,
  action        TEXT    NOT NULL CHECK (action IN ('keep','trash','collection','skip')),
  collection_id INTEGER REFERENCES collections(id) ON DELETE SET NULL
);
CREATE INDEX ix_rlog_item ON rediscover_log(item_id, shown_at DESC);

-- ===================== SYNCHRO (SYNC §6.3, PK `source`) =====================
CREATE TABLE sync_state (
  source               TEXT PRIMARY KEY CHECK (source IN ('x','instagram','cosmos')),
  enabled              INTEGER NOT NULL DEFAULT 0,
  allow_background_tab INTEGER NOT NULL DEFAULT 0,
  account_id           TEXT,
  account_handle       TEXT,
  status               TEXT    NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','running','ok','auth_required',
                                       'rate_limited','api_changed','waiting_for_tab','no_browser','error')),
  last_run_at          INTEGER,
  last_success_at      INTEGER,
  last_new_count       INTEGER NOT NULL DEFAULT 0,
  last_error           TEXT,
  total_synced         INTEGER NOT NULL DEFAULT 0,
  backfill_cursor      TEXT,
  backfill_done        INTEGER NOT NULL DEFAULT 0,
  backfill_anchor_at   INTEGER,
  backfill_pos         INTEGER NOT NULL DEFAULT 0,
  last_deep_at         INTEGER,
  cooldown_until       INTEGER,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  budget_day           TEXT,                          -- 'YYYY-MM-DD' (Instagram)
  budget_used          INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;

CREATE TABLE sync_runs (
  id          TEXT PRIMARY KEY,
  source      TEXT    NOT NULL CHECK (source IN ('x','instagram','cosmos')),
  mode        TEXT    NOT NULL,                       -- incremental|backfill|deep|passive
  reason      TEXT    NOT NULL,                       -- schedule|manual|hint|toggle|import|passive
  browser     TEXT,
  target      TEXT,                                   -- tab|sw|created_tab|assist
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  pages       INTEGER NOT NULL DEFAULT 0,
  new_items   INTEGER NOT NULL DEFAULT 0,
  known_items INTEGER NOT NULL DEFAULT 0,
  status      TEXT,
  error       TEXT
) WITHOUT ROWID;
CREATE INDEX ix_sync_runs_source ON sync_runs(source, started_at DESC);

CREATE TABLE sync_items (                             -- « déjà connu » au niveau publication
  source_key    TEXT PRIMARY KEY,                     -- 'x:<id>' | 'ig:<shortcode>' | 'cosmos:<id>'
  source        TEXT NOT NULL CHECK (source IN ('x','instagram','cosmos')),
  external_id   TEXT NOT NULL,
  item_id       INTEGER REFERENCES items(id) ON DELETE SET NULL,
  account_id    TEXT,
  first_seen_at INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  remote_sort   TEXT
) WITHOUT ROWID;
CREATE INDEX ix_sync_items_item ON sync_items(item_id) WHERE item_id IS NOT NULL;

CREATE TABLE sync_dismissed (                         -- supprimés par l'utilisateur : jamais ré-importés
  source       TEXT NOT NULL,
  external_id  TEXT NOT NULL,
  dismissed_at INTEGER NOT NULL,
  PRIMARY KEY (source, external_id)
) WITHOUT ROWID;

-- ===================== IMPORT / DIVERS =====================
CREATE TABLE import_runs (
  id             INTEGER PRIMARY KEY,
  kind           TEXT NOT NULL,               -- 'gatheros'
  source_path    TEXT NOT NULL,
  source_library TEXT,
  options        TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(options)),
  state          TEXT NOT NULL CHECK (state IN ('running','files_done','done','failed','cancelled')),
  phase          TEXT,
  progress       TEXT,
  report         TEXT,
  started_at     INTEGER NOT NULL,
  finished_at    INTEGER
);
-- Ce que l'utilisateur a retiré d'un import : le ré-import ne le recrée jamais.
CREATE TABLE import_tombstones (
  origin     TEXT    NOT NULL,                -- 'gatheros'
  entity     TEXT    NOT NULL CHECK (entity IN ('item','collection','membership')),
  origin_id  TEXT    NOT NULL,                -- id du save | id de collection | '<collectionId>:<saveId>'
  removed_at INTEGER NOT NULL,
  PRIMARY KEY (origin, entity, origin_id)
) WITHOUT ROWID;
CREATE TRIGGER trg_tomb_item AFTER DELETE ON items
WHEN old.origin = 'gatheros' AND old.origin_id IS NOT NULL BEGIN
  INSERT OR IGNORE INTO import_tombstones VALUES ('gatheros', 'item', old.origin_id, CAST(unixepoch('subsec') * 1000 AS INTEGER));
END;
CREATE TRIGGER trg_tomb_collection AFTER DELETE ON collections
WHEN old.origin = 'gatheros' AND old.origin_id IS NOT NULL BEGIN
  INSERT OR IGNORE INTO import_tombstones VALUES ('gatheros', 'collection', old.origin_id, CAST(unixepoch('subsec') * 1000 AS INTEGER));
END;
CREATE TRIGGER trg_tomb_membership AFTER DELETE ON collection_items BEGIN
  INSERT OR IGNORE INTO import_tombstones
  SELECT 'gatheros', 'membership', c.origin_id || ':' || i.origin_id, CAST(unixepoch('subsec') * 1000 AS INTEGER)
  FROM collections c, items i
  WHERE c.id = old.collection_id AND i.id = old.item_id AND c.origin = 'gatheros' AND i.origin = 'gatheros';
END;

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL CHECK (json_valid(value)),
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE search_history (
  query   TEXT PRIMARY KEY COLLATE NOCASE,
  used_at INTEGER NOT NULL,
  uses    INTEGER NOT NULL DEFAULT 1
) WITHOUT ROWID;

-- ===================== RECHERCHE PLEIN TEXTE (FTS5 avec contenu, ARCHI §4.5) =====================
CREATE VIRTUAL TABLE items_fts USING fts5(
  title, notes, post_text, ocr_text, ai_text, tags, url,
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '2 3'
);

CREATE VIEW items_fts_src AS
SELECT
  i.id AS item_id,
  coalesce(i.title,'') || ' ' || coalesce(i.ai_title,'')                                   AS title,
  coalesce(i.notes,'')                                                                     AS notes,
  CASE WHEN i.post_meta IS NULL THEN '' ELSE
    coalesce(i.post_meta ->> '$.text','')               || ' ' ||
    coalesce(i.post_meta ->> '$.author.name','')        || ' ' ||
    coalesce(i.post_meta ->> '$.author.handle','')      || ' ' ||
    coalesce(i.post_meta ->> '$.quoted.text','')        || ' ' ||
    coalesce(i.post_meta ->> '$.quoted.author.name','') || ' ' ||
    coalesce(i.post_meta ->> '$.quoted.author.handle','') || ' ' ||
    coalesce((SELECT group_concat(j.value ->> '$.text', ' ') FROM json_each(i.post_meta, '$.thread') j), '')
  END                                                                                      AS post_text,
  coalesce(i.ocr_text,'')                                                                  AS ocr_text,
  coalesce(i.ai_description,'') || ' ' ||
    coalesce((SELECT group_concat(value, ' ') FROM json_each(i.ai_tags)), '')              AS ai_text,
  coalesce((SELECT group_concat(t.name, ' ') FROM item_tags it JOIN tags t ON t.id = it.tag_id
            WHERE it.item_id = i.id), '')                                                  AS tags,
  coalesce(i.source_url,'')                                                                AS url
FROM items i;

CREATE TRIGGER trg_items_fts_ai AFTER INSERT ON items BEGIN
  INSERT INTO items_fts(rowid,title,notes,post_text,ocr_text,ai_text,tags,url)
  SELECT item_id,title,notes,post_text,ocr_text,ai_text,tags,url FROM items_fts_src WHERE item_id = new.id;
END;
CREATE TRIGGER trg_items_fts_au AFTER UPDATE OF title, ai_title, notes, post_meta, ocr_text, ai_description, ai_tags, source_url ON items BEGIN
  DELETE FROM items_fts WHERE rowid = old.id;
  INSERT INTO items_fts(rowid,title,notes,post_text,ocr_text,ai_text,tags,url)
  SELECT item_id,title,notes,post_text,ocr_text,ai_text,tags,url FROM items_fts_src WHERE item_id = new.id;
END;
CREATE TRIGGER trg_items_fts_ad AFTER DELETE ON items BEGIN
  DELETE FROM items_fts WHERE rowid = old.id;
END;
CREATE TRIGGER trg_item_tags_fts_ai AFTER INSERT ON item_tags BEGIN
  DELETE FROM items_fts WHERE rowid = new.item_id;
  INSERT INTO items_fts(rowid,title,notes,post_text,ocr_text,ai_text,tags,url)
  SELECT item_id,title,notes,post_text,ocr_text,ai_text,tags,url FROM items_fts_src WHERE item_id = new.item_id;
END;
CREATE TRIGGER trg_item_tags_fts_ad AFTER DELETE ON item_tags BEGIN
  DELETE FROM items_fts WHERE rowid = old.item_id;
  INSERT INTO items_fts(rowid,title,notes,post_text,ocr_text,ai_text,tags,url)
  SELECT item_id,title,notes,post_text,ocr_text,ai_text,tags,url FROM items_fts_src WHERE item_id = old.item_id;
END;
CREATE TRIGGER trg_tags_fts_au AFTER UPDATE OF name ON tags BEGIN
  DELETE FROM items_fts WHERE rowid IN (SELECT item_id FROM item_tags WHERE tag_id = new.id);
  INSERT INTO items_fts(rowid,title,notes,post_text,ocr_text,ai_text,tags,url)
  SELECT item_id,title,notes,post_text,ocr_text,ai_text,tags,url FROM items_fts_src
  WHERE item_id IN (SELECT item_id FROM item_tags WHERE tag_id = new.id);
END;
