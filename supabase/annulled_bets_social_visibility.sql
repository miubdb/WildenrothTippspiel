-- Social view: an annulled selection is public as soon as the final annulment
-- has been stored, even before the original scheduled kickoff.
-- IMPORTANT: no new access to any pending/won/lost leg on a future match.
-- Their existing per-leg visibility gate via private.combo_has_started remains.
-- Only the matching combo HEADER (stake/status/total odds) may be displayed.
--
-- Preserve the previously installed SELECT policy conditions unchanged and
-- append the final-annulment exception. No new table/column, no bets mutation.
ALTER POLICY bets_select_own ON public.bets
USING (
  (user_id = (SELECT auth.uid()))
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = (SELECT auth.uid()) AND p.is_admin
  )
  OR (
    combo_id IS NULL
    AND EXISTS (
      SELECT 1 FROM public.matches m
      WHERE m.id = bets.match_id AND m.match_date <= now()
    )
  )
  OR (
    combo_id IS NOT NULL
    AND private.combo_has_started(combo_id::bigint)
  )
  OR (
    status = 'neutralized'
    AND neutralized_reason = 'match_annulled'
    AND EXISTS (
      SELECT 1 FROM public.matches m
      WHERE m.id = bets.match_id AND m.status = 'annulled'
    )
  )
);

ALTER POLICY combo_bets_select_own ON public.combo_bets
USING (
  ((SELECT auth.uid()) = user_id)
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = (SELECT auth.uid()) AND p.is_admin
  )
  OR EXISTS (
    SELECT 1 FROM public.bets b JOIN public.matches m ON m.id = b.match_id
    WHERE b.combo_id = combo_bets.id AND m.match_date <= now()
  )
  OR EXISTS (
    SELECT 1 FROM public.bets b JOIN public.matches m ON m.id = b.match_id
    WHERE b.combo_id = combo_bets.id
      AND b.status = 'neutralized'
      AND b.neutralized_reason = 'match_annulled'
      AND m.status = 'annulled'
  )
);
