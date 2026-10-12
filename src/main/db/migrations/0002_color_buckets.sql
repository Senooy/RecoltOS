-- (M3): hue buckets shifted by 15° so that reds are no longer
-- split in two (0 = 345°–15°). `color_key` is VIRTUAL: it follows. Neutrals (C < 12) and
-- unknown (13) left unchanged.
UPDATE items
   SET color_bucket = CAST(((CAST(color_h AS INTEGER) + 15) % 360) / 30 AS INTEGER)
 WHERE color_h IS NOT NULL AND color_c IS NOT NULL AND color_c >= 12 AND color_bucket < 12;
