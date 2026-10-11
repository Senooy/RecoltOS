-- WP-56 (M5) : publications rattrapées par un backfill ou un parcours profond et placées sous un voisin
-- plus ancien que le run (SYNC §3.6, « N publications plus anciennes récupérées · Revoir »).
ALTER TABLE sync_items ADD COLUMN recovered_at INTEGER;
CREATE INDEX ix_sync_items_recovered ON sync_items(recovered_at) WHERE recovered_at IS NOT NULL;
