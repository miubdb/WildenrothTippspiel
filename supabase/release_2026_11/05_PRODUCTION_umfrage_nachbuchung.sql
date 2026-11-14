-- PRODUCTION: rückwirkendes 100-Wildis-Dankeschön für die Winterumfrage 2026 (winter_2026_v2). NACH 03 und NACH dem Deploy.
-- Bucht ausschließlich die vorab mit der App-Validierung (lib/surveyValidation.ts#isCompleteForSubmission) geprüften
-- Teilnahmen. Geprüft am 14.11.2026: 1 vollständige Teilnahme. Hat sich der Datensatz seit der Prüfung verändert
-- (updated_at), oder gibt es inzwischen weitere/andere abgeschickte Teilnahmen, bricht das Skript ab, ohne zu buchen –
-- neue Teilnehmer erhalten ihr Dankeschön ohnehin automatisch über die App.
-- Beliebig oft ausführbar: ein zweiter Lauf bucht nichts (grant_survey_reward ist idempotent).
BEGIN;
CREATE TEMP TABLE _reward_targets (user_id uuid PRIMARY KEY, expected_updated_at timestamptz) ON COMMIT DROP;
INSERT INTO _reward_targets VALUES ('1168cfd3-5b28-4a29-823b-b2a7057ec05a', '2026-11-14 15:32:44.808+00');
CREATE TEMP TABLE _reward_before ON COMMIT DROP AS
  SELECT p.id, p.balance FROM public.profiles p;
DO $g$
DECLARE tgt record; r jsonb; n_granted int := 0;
BEGIN
  -- Prüfung 1: die abgeschickten V2-Teilnahmen sind GENAU die geprüften, unverändert
  IF EXISTS (
    SELECT 1 FROM public.survey_responses s
    WHERE s.survey_version = 'winter_2026_v2' AND s.submitted_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM _reward_targets t WHERE t.user_id = s.user_id)
      AND NOT EXISTS (SELECT 1 FROM public.balance_transactions b WHERE b.user_id = s.user_id AND b.kind = 'survey_reward' AND b.ref = 'winter_2026_v2')
  ) THEN
    RAISE EXCEPTION 'ABBRUCH: weitere abgeschickte, ungeprüfte Teilnahme ohne Buchung vorhanden – erst prüfen';
  END IF;
  FOR tgt IN SELECT * FROM _reward_targets LOOP
    IF NOT EXISTS (SELECT 1 FROM public.survey_responses s WHERE s.user_id = tgt.user_id AND s.survey_version = 'winter_2026_v2'
                   AND s.submitted_at IS NOT NULL AND s.updated_at = tgt.expected_updated_at) THEN
      RAISE EXCEPTION 'ABBRUCH: Teilnahme % wurde seit der Prüfung verändert oder ist nicht mehr abgeschickt', tgt.user_id;
    END IF;
    r := public.grant_survey_reward(tgt.user_id, 'winter_2026_v2');
    IF (r->>'granted')::boolean THEN n_granted := n_granted + 1;
    ELSIF r->>'reason' <> 'ALREADY_GRANTED' THEN RAISE EXCEPTION 'ABBRUCH: unerwartetes Ergebnis %', r; END IF;
  END LOOP;
  -- Prüfung 2: nur die Zielkonten haben sich verändert, jeweils um genau +100 (bzw. 0 wenn schon gebucht)
  IF EXISTS (SELECT 1 FROM public.profiles p JOIN _reward_before b ON b.id = p.id
             WHERE p.balance <> b.balance AND p.id NOT IN (SELECT user_id FROM _reward_targets)) THEN
    RAISE EXCEPTION 'ABBRUCH: fremdes Guthaben verändert';
  END IF;
  IF (SELECT sum(p.balance - b.balance) FROM public.profiles p JOIN _reward_before b ON b.id = p.id) <> n_granted * 100 THEN
    RAISE EXCEPTION 'ABBRUCH: Summe der Gutschriften stimmt nicht';
  END IF;
  RAISE NOTICE 'Neu gebucht: % Empfänger, % Wildis', n_granted, n_granted * 100;
END $g$;
COMMIT;
SELECT b.user_id, b.amount, b.created_at, p.balance AS guthaben_jetzt,
  (SELECT count(*) FROM public.balance_transactions WHERE kind='survey_reward' AND ref='winter_2026_v2') AS journal_zeilen_gesamt,
  (SELECT sum(amount) FROM public.balance_transactions WHERE kind='survey_reward' AND ref='winter_2026_v2') AS wildis_gesamt
FROM public.balance_transactions b JOIN public.profiles p ON p.id = b.user_id
WHERE b.kind = 'survey_reward' AND b.ref = 'winter_2026_v2';
