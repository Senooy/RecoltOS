-- (M5): posts caught up by a backfill or a deep scroll and placed under a neighbor
-- older than the run ("N older posts recovered · Review").
ALTER TABLE sync_items ADD COLUMN recovered_at INTEGER;
CREATE INDEX ix_sync_items_recovered ON sync_items(recovered_at) WHERE recovered_at IS NOT NULL;
