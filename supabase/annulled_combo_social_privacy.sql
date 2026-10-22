-- Sozialansicht / Alle Tipps: Eine Annullierung ist KEIN Spielbeginn.
-- Eine Kombi bleibt Dritten vor dem Beginn ihres ersten tatsächlichen
-- (nicht annullierten/verschobenen) Legs vollständig verborgen.
-- Bereits gestartete Kombis bleiben öffentlich, annulierte Einzeltipps
-- hingegen sofort sichtbar (sie sind unwiderruflich neutralisiert).
--
-- Sicherheitsrelevant: Die Anpfiff-Prüfung wird AUCH in der DB-Funktion
-- korrigiert, damit der ursprünglich geplante Anpfiff eines ANNULLED-Spiels
-- später nicht versehentlich sämtliche künftigen Kombi-Legs freischaltet.
--
-- Keinerlei Änderung an bets/combo_bets/matches oder Guthaben.
CREATE OR REPLACE FUNCTION private.combo_has_started(p_combo_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.bets b2
    JOIN public.matches m2 ON m2.id = b2.match_id
    WHERE b2.combo_id = p_combo_id
      AND b2.status NOT IN ('void', 'neutralized')
      AND m2.status NOT IN ('postponed', 'annulled')
      AND (
        b2.status IN ('won', 'lost')
        OR m2.status IN ('live', 'finished')
        OR m2.match_date <= now()
      )
  );
$function$;

-- Kein vorzeitiges Durchsickern einer neutralisierten Kombi-Auswahl:
-- Der bestehende Kombi-Anpfiff-Check öffnet deren gesamte Sichtbarkeit,
-- aber eine Annullierung allein (auch nach ihrem ursprünglich geplanten
-- Termin) tut das ausdrücklich NICHT.
ALTER POLICY bets_select_own ON public.bets
USING (
  (user_id = (SELECT auth.uid()))
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = (SELECT auth.uid()) AND p.is_admin
  )
  OR (
    combo_id IS NULL
    AND (
      EXISTS (
        SELECT 1 FROM public.matches m
        WHERE m.id = bets.match_id AND m.match_date <= now()
      )
      OR (
        (SELECT auth.uid()) IS NOT NULL
        AND status = 'neutralized'
        AND neutralized_reason = 'match_annulled'
        AND EXISTS (
          SELECT 1 FROM public.matches m
          WHERE m.id = bets.match_id AND m.status = 'annulled'
        )
      )
    )
  )
  OR (
    combo_id IS NOT NULL
    AND private.combo_has_started(combo_id::bigint)
  )
);

-- Vorher gab schon die Kombi-Metadaten (Einsatz, Quote, Status) preis,
-- sobald eines ihrer Spiele annulliert war. Das ist bei vorzeitiger
-- Stornierbarkeit ebenfalls nicht zulässig.
ALTER POLICY combo_bets_select_own ON public.combo_bets
USING (
  ((SELECT auth.uid()) = user_id)
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = (SELECT auth.uid()) AND p.is_admin
  )
  OR private.combo_has_started(combo_bets.id::bigint)
);
