-- (M3) : buckets de teinte décalés de 15° pour que les rouges ne soient plus
-- coupés en deux (0 = 345°–15°). `color_key` est VIRTUAL : il suit. Neutres (C < 12) et
-- inconnus (13) inchangés.
UPDATE items
   SET color_bucket = CAST(((CAST(color_h AS INTEGER) + 15) % 360) / 30 AS INTEGER)
 WHERE color_h IS NOT NULL AND color_c IS NOT NULL AND color_c >= 12 AND color_bucket < 12;
