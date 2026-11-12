-- Nur Lesen. In Production UND in der Sandbox ausführen und die Ergebnisse vergleichen: sie müssen für Saison 26/27
-- Zeile für Zeile identisch sein (Spieltage 1–15 unverändert übernommen).
select 'matches (seit 2026-08-01)' k, count(*)::text v from matches where match_date >= '2026-08-01'
union all select 'matches finished', count(*)::text from matches where match_date >= '2026-08-01' and status = 'finished'
union all select 'bets 26/27', count(*)::text from bets where season = '26/27'
union all select 'combo_bets 26/27', count(*)::text from combo_bets where season = '26/27'
union all select 'Summe Einsatz Einzelwetten 26/27', coalesce(sum(stake),0)::text from bets where season = '26/27' and combo_id is null
union all select 'Summe Einsatz Kombis 26/27', coalesce(sum(stake),0)::text from combo_bets where season = '26/27'
union all select 'Summe Auszahlung bets 26/27', coalesce(sum(payout),0)::text from bets where season = '26/27'
union all select 'Summe Auszahlung Kombis 26/27', coalesce(sum(payout),0)::text from combo_bets where season = '26/27'
union all select 'bets pending', count(*)::text from bets where season = '26/27' and status = 'pending'
union all select 'profiles', count(*)::text from profiles
union all select 'profiles gelöscht', count(*)::text from profiles where deleted_at is not null
union all select 'Pokalspiel(e)', count(*)::text from matches where competition_type = 'cup' and match_date >= '2026-08-01'
union all select 'Hash Wett-IDs', md5(string_agg(id::text, ',' order by id)) from bets where season = '26/27'
union all select 'Hash Kombi-IDs', md5(string_agg(id::text, ',' order by id)) from combo_bets where season = '26/27'
order by 1;
