-- ============================================================
-- Wildenroth & Schöngeising 25/26 Daten → prior_season_matches
-- Ihre Kreisklasse 1-Spiele aus der matches-Tabelle übernehmen,
-- damit das xG-Modell sie für die 26/27-Saison kennt.
-- Im Supabase Dashboard → SQL Editor ausführen
-- ============================================================

INSERT INTO prior_season_matches
  (season, league_name, league_level, league_number, home_team, away_team, home_score, away_score, match_date)
SELECT
  '25/26',
  'Kreisklasse Gruppe 1 Zugspitze',
  'kreisklasse',
  '310089',  -- Liganummer Kreisklasse Gr. 1 Zugspitze
  ht.name,
  at.name,
  m.home_score,
  m.away_score,
  m.match_date::date
FROM matches m
JOIN teams ht ON ht.id = m.home_team_id
JOIN teams at ON at.id = m.away_team_id
WHERE m.status = 'finished'
  AND m.home_score IS NOT NULL
  AND m.away_score IS NOT NULL
  AND m.match_date < '2026-08-01'
ON CONFLICT ON CONSTRAINT unique_match DO NOTHING;
