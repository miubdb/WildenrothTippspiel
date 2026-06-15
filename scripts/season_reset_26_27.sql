-- ============================================================
-- Saison-Reset 26/27
-- Im Supabase Dashboard → SQL Editor ausführen
-- ============================================================

-- 1. Alle Spieler-Guthaben auf 1.000 € zurücksetzen
UPDATE profiles SET balance = 1000.00;

-- 2. season-Spalte zu bets hinzufügen (falls noch nicht vorhanden)
ALTER TABLE bets ADD COLUMN IF NOT EXISTS season TEXT DEFAULT '26/27';

-- 3. Alle bestehenden Wetten aus der 25/26-Saison markieren
--    (alle die vor 2026-08-01 erstellt wurden)
UPDATE bets SET season = '25/26' WHERE created_at < '2026-08-01 00:00:00+00';

-- 4. season-Spalte zu combo_bets hinzufügen
ALTER TABLE combo_bets ADD COLUMN IF NOT EXISTS season TEXT DEFAULT '26/27';

UPDATE combo_bets SET season = '25/26' WHERE created_at < '2026-08-01 00:00:00+00';

-- 5. Saisonabschluss-Snapshot: aktuellen Stand vor dem Reset speichern
--    (Falls Tabelle noch nicht existiert)
CREATE TABLE IF NOT EXISTS season_snapshots (
  id          SERIAL PRIMARY KEY,
  season      TEXT NOT NULL,
  user_id     UUID NOT NULL REFERENCES profiles(id),
  final_rank  INTEGER,
  final_balance NUMERIC(10,2) NOT NULL,
  total_bets  INTEGER,
  total_won   INTEGER,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (season, user_id)
);

-- 6. 25/26-Abschluss-Snapshot aus aktuellen Daten speichern
INSERT INTO season_snapshots (season, user_id, final_balance, total_bets, total_won)
SELECT
  '25/26',
  p.id,
  p.balance,
  COUNT(b.id) FILTER (WHERE b.season = '25/26'),
  COUNT(b.id) FILTER (WHERE b.season = '25/26' AND b.status = 'won')
FROM profiles p
LEFT JOIN bets b ON b.user_id = p.id
GROUP BY p.id, p.balance
ON CONFLICT (season, user_id) DO NOTHING;
