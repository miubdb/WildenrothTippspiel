import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { getMatchXG, oddsFromXG } from '@/lib/odds'
import { detectOddsAnomalies } from '@/lib/oddsAnomalies'
import { bettingOpenTime, buildEffectiveMatchdayIndex, effectiveMatchdayOf } from '@/lib/season'
import { loadOddsModelInputs, snapshotMatches } from '@/lib/oddsInputs'

/**
 * Admin 3.0, Punkt 6: Spieltag-Cockpit. Liefert den Status jeder Prüfung für einen Spieltag.
 * Technisch überprüfbare Punkte (Quoten, Torschützenmarkt, Wettfenster, offene Abrechnungen,
 * Bonus-Tipps/Specials vorhanden) werden hier IMMER frisch berechnet — nie aus einem
 * gespeicherten Status gelesen, sonst zeigt das Cockpit etwas Falsches an, sobald sich die
 * zugrundeliegenden Daten ändern (die ausdrückliche Vorgabe "nicht einfach alles automatisch grün
 * markieren, nur weil Datensätze existieren").
 *
 * Manuell zu bestätigende Punkte (Verfügbarkeiten geprüft, Wettfreigabezeit korrekt) werden in
 * `app_settings` unter dem Schlüssel `matchday_checklist_md_<N>` als JSON gespeichert (keine neue
 * Tabelle nötig — dieselbe Konvention wie `betting_open_md_<N>`). Jede Bestätigung trägt einen
 * `snapshot` der Daten, auf die sie sich bezog; weicht der aktuell berechnete Snapshot davon ab,
 * fällt der Status automatisch auf "nicht geprüft" zurück (Vorgabe: eine Änderung, die eine
 * frühere Prüfung ungültig macht, muss den Status sinnvoll aktualisieren — kein Nachführen von
 * Hand nötig, es passiert von selbst beim nächsten Laden).
 */

type CheckStatus = 'erledigt' | 'handlungsbedarf' | 'nicht_geprueft' | 'nicht_erforderlich'
interface Check { status: CheckStatus; detail: string }

interface ManualState {
  bonusTipsNotPlanned?: boolean
  specialsNotPlanned?: boolean
  availability?: { at: string; by: string; snapshot: string }
  bettingTime?: { at: string; by: string; snapshot: string }
}

async function requireAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('is_admin, username, display_name').eq('id', user.id).single()
  if (!profile?.is_admin) return null
  return { id: user.id, name: profile.display_name || profile.username }
}

function readManual(raw: string | null | undefined): ManualState {
  if (!raw) return {}
  try { return JSON.parse(raw) as ManualState } catch { return {} }
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  if (!(await requireAdmin(supabase))) return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 })

  const matchday = parseInt(request.nextUrl.searchParams.get('matchday') ?? '0', 10)
  if (!matchday) return NextResponse.json({ error: 'matchday fehlt.' }, { status: 400 })

  const admin = createAdminClient()
  const { seasonMatches, modelMatches, priorCtx } = await loadOddsModelInputs(supabase)
  const mdIndex = buildEffectiveMatchdayIndex(seasonMatches)
  const dayMatches = seasonMatches.filter((m) => effectiveMatchdayOf(m, mdIndex) === matchday)
  const matchIds = dayMatches.map((m) => m.id)

  // ── Spielplan ────────────────────────────────────────────────────────────
  const schedule: Check = dayMatches.length > 0
    ? { status: 'erledigt', detail: `${dayMatches.length} Spiel(e) hinterlegt.` }
    : { status: 'handlungsbedarf', detail: 'Keine Spiele für diesen Spieltag gefunden.' }

  // ── Wettfenster + eingefrorene Quoten ───────────────────────────────────
  const { data: settingRow } = await admin.from('app_settings').select('value').eq('key', `betting_open_md_${matchday}`).maybeSingle()
  const firstMatch = dayMatches.slice().sort((a, b) => new Date(a.match_date).getTime() - new Date(b.match_date).getTime())[0]
  const openAt = settingRow?.value ?? (firstMatch ? bettingOpenTime(new Date(firstMatch.match_date)).toISOString() : null)
  const isOpen = openAt ? new Date() >= new Date(openAt) : false

  const { data: oddsRows } = matchIds.length > 0
    ? await admin.from('odds').select('match_id, frozen_at').in('match_id', matchIds)
    : { data: [] }
  const frozenCount = (oddsRows ?? []).filter((r) => r.frozen_at).length

  let oddsCheck: Check
  let anomalyCount = 0
  if (matchIds.length === 0) {
    oddsCheck = { status: 'nicht_erforderlich', detail: 'Keine Spiele.' }
  } else if (frozenCount === matchIds.length) {
    oddsCheck = { status: 'erledigt', detail: `Alle ${matchIds.length} Quoten eingefroren.` }
  } else {
    // Noch nicht eingefroren: live nachrechnen (wie /api/admin/odds/preview),
    // damit Anzahl UND Auffälligkeiten tatsächlich aktuell sind, nicht nur "existiert irgendwas".
    const cutoff = openAt ? new Date(openAt) : null
    const oddsMatches = snapshotMatches(modelMatches, cutoff)
    for (const m of dayMatches) {
      const { homeXG, awayXG, diagnostics } = getMatchXG(oddsMatches, m.home_team_id, m.away_team_id, priorCtx)
      const odds = oddsFromXG(homeXG, awayXG)
      anomalyCount += detectOddsAnomalies(odds, diagnostics).length
    }
    oddsCheck = { status: 'erledigt', detail: `${matchIds.length} Quoten berechenbar (${frozenCount} bereits eingefroren) — werden beim Fenster-Öffnen automatisch eingefroren.` }
  }
  const anomalyCheck: Check = anomalyCount > 0
    ? { status: 'handlungsbedarf', detail: `${anomalyCount} auffällige Werte — siehe Quoten-Tab, Abschnitt „Quotenprüfung".` }
    : { status: 'erledigt', detail: 'Keine Auffälligkeiten erkannt.' }

  const bettingWindow: Check = { status: isOpen ? 'erledigt' : 'nicht_geprueft', detail: isOpen ? 'Wettfenster ist offen.' : `Öffnet ${openAt ? new Date(openAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' Uhr' : 'noch nicht festgelegt'}.` }

  // ── Torschützenmarkt (nur relevant, wenn Wildenroth-Spiele dabei sind) ──
  const { data: wtRows } = await admin.from('teams').select('id').in('name', ['SpVgg Wildenroth', 'SpVgg Wildenroth II'])
  const wtIds = new Set((wtRows ?? []).map((r) => r.id))
  const wildenrothMatchIds = dayMatches.filter((m) => wtIds.has(m.home_team_id) || wtIds.has(m.away_team_id)).map((m) => m.id)
  let goalscorerCheck: Check
  if (wildenrothMatchIds.length === 0) {
    goalscorerCheck = { status: 'nicht_erforderlich', detail: 'Kein Wildenroth-Spiel an diesem Spieltag.' }
  } else {
    const { data: gsRows } = await admin.from('match_goalscorer_odds').select('match_id').in('match_id', wildenrothMatchIds)
    const coveredMatches = new Set((gsRows ?? []).map((r) => r.match_id))
    goalscorerCheck = coveredMatches.size >= wildenrothMatchIds.length
      ? { status: 'erledigt', detail: 'Torschützen-Markt vorbereitet.' }
      : { status: 'handlungsbedarf', detail: `${wildenrothMatchIds.length - coveredMatches.size} von ${wildenrothMatchIds.length} Wildenroth-Spiel(en) ohne Torschützen-Markt.` }
  }

  // ── Spieltags-Check: zusätzliche, rein lesende Qualitätsprüfungen auf
  // denselben, oben bereits geladenen Daten (dayMatches/mdIndex/seasonMatches/
  // wtIds) — keine neue Infrastruktur, nur zusätzliche Auswertungen. Ändert
  // nie etwas automatisch, reine Diagnose für den Admin.

  // Doppelte Spiele: gleiche Paarung (Heim/Gast/Wettbewerb) mehrfach an diesem Spieltag.
  const pairCounts = new Map<string, number>()
  for (const m of dayMatches) {
    const key = `${m.home_team_id}-${m.away_team_id}-${m.match_category ?? 'kreisliga'}`
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1)
  }
  const duplicatePairs = [...pairCounts.values()].filter((c) => c > 1).length
  const duplicatesCheck: Check = duplicatePairs > 0
    ? { status: 'handlungsbedarf', detail: `${duplicatePairs} Paarung(en) mehrfach an diesem Spieltag hinterlegt.` }
    : { status: 'erledigt', detail: 'Keine doppelten Spiele gefunden.' }

  // Datum/Anstoßzeit: ungültiges Datum, oder exakt Mitternacht (Europe/Berlin) — ein
  // häufiges Zeichen einer beim Import noch fehlenden echten Anstoßzeit.
  const missingKickoff = dayMatches.filter((m) => {
    const d = new Date(m.match_date)
    if (isNaN(d.getTime())) return true
    const parts = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d)
    const hh = parts.find((p) => p.type === 'hour')?.value
    const mm = parts.find((p) => p.type === 'minute')?.value
    return hh === '00' && mm === '00'
  })
  const kickoffCheck: Check = missingKickoff.length > 0
    ? { status: 'handlungsbedarf', detail: `${missingKickoff.length} Spiel(e) ohne erkennbare Anstoßzeit (00:00 Uhr oder ungültiges Datum).` }
    : { status: 'erledigt', detail: 'Alle Spiele haben Datum und Anstoßzeit.' }

  // Ungewöhnliche Spieltag-Zuordnung: Anstoß weit vom zeitlichen Schwerpunkt dieses
  // Spieltags entfernt — derselbe Fehlerfall, der vorher das B-Klasse-Topspiel über ein
  // reines ±7-Tage-Fenster falsch befüllt hat (siehe SpieltagTabView.tsx); hier nur als
  // Hinweis, nicht als Filter.
  const anchor = mdIndex.matchdayAnchorDate.get(matchday)
  const OUTLIER_WINDOW_MS = 10 * 24 * 60 * 60 * 1000
  const outliers = anchor != null ? dayMatches.filter((m) => Math.abs(new Date(m.match_date).getTime() - anchor) > OUTLIER_WINDOW_MS) : []
  const scheduleAssignmentCheck: Check = outliers.length > 0
    ? { status: 'handlungsbedarf', detail: `${outliers.length} Spiel(e) mit Anstoß weit entfernt vom Schwerpunkt dieses Spieltags — Zuordnung prüfen.` }
    : { status: 'erledigt', detail: 'Alle Spiele liegen zeitlich plausibel in diesem Spieltag.' }

  // Veraltete B-Klasse-Topspiel-Markierung an einem ANDEREN Spieltag (vergessen zu
  // entfernen, bevor ein neues Topspiel markiert wurde) — ob für DIESEN Spieltag
  // überhaupt eines gewählt ist, prüft bereits SpieltagCockpit.tsx (topspiel-Prop).
  const staleTopspiel = seasonMatches.filter((m) =>
    m.match_category === 'b-klasse' && m.is_topspiel && m.status === 'scheduled' && effectiveMatchdayOf(m, mdIndex) !== matchday
  )
  const topspielCheck: Check = staleTopspiel.length > 0
    ? { status: 'handlungsbedarf', detail: `${staleTopspiel.length} B-Klasse-Topspiel-Markierung(en) gehören zu einem anderen Spieltag.` }
    : { status: 'erledigt', detail: 'Keine veralteten Topspiel-Markierungen an anderen Spieltagen.' }

  // Wildenroth: Mannschaft korrekt erkannt (Team-ID vs. Vereinsname) + Handicap-
  // Angebot auf bereits eingefrorenen Quoten vorhanden.
  let wildenrothRecognitionCheck: Check = { status: 'nicht_erforderlich', detail: 'Kein Wildenroth-Spiel an diesem Spieltag.' }
  let wildenrothHandicapCheck: Check = { status: 'nicht_erforderlich', detail: 'Kein Wildenroth-Spiel an diesem Spieltag.' }
  if (wildenrothMatchIds.length > 0) {
    const teamIds = [...new Set(dayMatches.flatMap((m) => [m.home_team_id, m.away_team_id]))]
    const { data: teamRows } = await admin.from('teams').select('id, name').in('id', teamIds)
    const nameById = new Map((teamRows ?? []).map((t) => [t.id, t.name]))
    const mismatches = dayMatches.filter((m) => {
      const homeIsWt = wtIds.has(m.home_team_id)
      const awayIsWt = wtIds.has(m.away_team_id)
      const homeNameSaysWt = (nameById.get(m.home_team_id) ?? '').toLowerCase().includes('wildenroth')
      const awayNameSaysWt = (nameById.get(m.away_team_id) ?? '').toLowerCase().includes('wildenroth')
      return homeIsWt !== homeNameSaysWt || awayIsWt !== awayNameSaysWt
    })
    wildenrothRecognitionCheck = mismatches.length > 0
      ? { status: 'handlungsbedarf', detail: `${mismatches.length} Spiel(e), bei denen Team-ID und Vereinsname bei „Wildenroth" nicht übereinstimmen.` }
      : { status: 'erledigt', detail: `${wildenrothMatchIds.length} Wildenroth-Spiel(e) korrekt erkannt.` }

    const { data: hdpRows } = await admin.from('odds').select('match_id, frozen_at, hdp_home_minus_1_5, hdp_away_plus_1_5').in('match_id', wildenrothMatchIds)
    const frozenRows = (hdpRows ?? []).filter((r) => r.frozen_at)
    const missingHandicap = frozenRows.filter((r) => r.hdp_home_minus_1_5 == null && r.hdp_away_plus_1_5 == null)
    wildenrothHandicapCheck = frozenRows.length === 0
      ? { status: 'nicht_geprueft', detail: 'Noch keine eingefrorenen Quoten — Handicap-Angebot kann erst dann geprüft werden.' }
      : missingHandicap.length > 0
        ? { status: 'handlungsbedarf', detail: `${missingHandicap.length} eingefrorene Wildenroth-Quote(n) ohne Handicap-Angebot.` }
        : { status: 'erledigt', detail: 'Handicap-Angebot vorhanden.' }
  }

  // ── Bonus-Tipps / Specials (technisch + manuelles "bewusst nicht vorgesehen") ──
  const manualKey = `matchday_checklist_md_${matchday}`
  const { data: manualRow } = await admin.from('app_settings').select('value').eq('key', manualKey).maybeSingle()
  const manual = readManual(manualRow?.value)

  const { count: bonusCount } = matchIds.length > 0
    ? await admin.from('bonus_tips').select('id', { count: 'exact', head: true }).or(`scope_matchday.eq.${matchday},scope_match_id.in.(${matchIds.join(',')})`)
    : await admin.from('bonus_tips').select('id', { count: 'exact', head: true }).eq('scope_matchday', matchday)
  const bonusCheck: Check = (bonusCount ?? 0) > 0
    ? { status: 'erledigt', detail: `${bonusCount} Bonus-Tipp(s) für diesen Spieltag.` }
    : manual.bonusTipsNotPlanned
      ? { status: 'nicht_erforderlich', detail: 'Bewusst nicht vorgesehen.' }
      : { status: 'nicht_geprueft', detail: 'Keine Bonus-Tipps — vorhanden oder bewusst nicht vorgesehen?' }

  const { count: specialsCount } = await admin.from('matchday_specials').select('id', { count: 'exact', head: true }).eq('matchday', matchday)
  const specialsCheck: Check = (specialsCount ?? 0) > 0
    ? { status: 'erledigt', detail: `${specialsCount} Special(s) für diesen Spieltag.` }
    : manual.specialsNotPlanned
      ? { status: 'nicht_erforderlich', detail: 'Bewusst nicht vorgesehen.' }
      : { status: 'nicht_geprueft', detail: 'Keine Specials — vorhanden oder bewusst nicht vorgesehen?' }

  // ── Verfügbarkeiten (manuell, mit Invalidierung bei Änderung) ──────────
  let availabilitySnapshot: string | null = null
  if (wildenrothMatchIds.length > 0) {
    const { data: statusRows } = await admin.from('match_goalscorer_odds').select('match_id, player_id, status').in('match_id', wildenrothMatchIds).order('player_id')
    availabilitySnapshot = JSON.stringify((statusRows ?? []).map((r) => `${r.match_id}:${r.player_id}:${r.status}`))
  }
  const availabilityCheck: Check = wildenrothMatchIds.length === 0
    ? { status: 'nicht_erforderlich', detail: 'Kein Wildenroth-Spiel an diesem Spieltag.' }
    : manual.availability && manual.availability.snapshot === availabilitySnapshot
      ? { status: 'erledigt', detail: `Bestätigt von ${manual.availability.by} am ${new Date(manual.availability.at).toLocaleDateString('de-DE')}.` }
      : manual.availability
        ? { status: 'nicht_geprueft', detail: 'Seit der letzten Bestätigung haben sich Verfügbarkeiten geändert.' }
        : { status: 'nicht_geprueft', detail: 'Noch nicht bestätigt.' }

  // ── Wettfreigabezeit korrekt (manuell, invalidiert bei Änderung der Zeit) ──
  const bettingTimeCheck: Check = manual.bettingTime && manual.bettingTime.snapshot === (openAt ?? '')
    ? { status: 'erledigt', detail: `Bestätigt von ${manual.bettingTime.by} am ${new Date(manual.bettingTime.at).toLocaleDateString('de-DE')}.` }
    : manual.bettingTime
      ? { status: 'nicht_geprueft', detail: 'Die Zeit wurde seit der letzten Bestätigung geändert.' }
      : { status: 'nicht_geprueft', detail: 'Noch nicht bestätigt.' }

  // ── Offene Ergebnisse/Abrechnungen ──────────────────────────────────────
  const now = new Date()
  const kickedOff = dayMatches.filter((m) => new Date(m.match_date) <= now)
  const unsettled = kickedOff.filter((m) => m.status !== 'finished' && m.status !== 'cancelled' && m.status !== 'postponed')
  const settlementCheck: Check = kickedOff.length === 0
    ? { status: 'nicht_erforderlich', detail: 'Noch kein Spiel angepfiffen.' }
    : unsettled.length === 0
      ? { status: 'erledigt', detail: 'Alle angepfiffenen Spiele abgerechnet.' }
      : { status: 'handlungsbedarf', detail: `${unsettled.length} Spiel(e) angepfiffen, aber noch nicht abgerechnet.` }

  return NextResponse.json({
    matchday,
    checks: {
      schedule, odds: oddsCheck, anomalies: anomalyCheck, goalscorerMarket: goalscorerCheck,
      availability: availabilityCheck, bonusTips: bonusCheck, specials: specialsCheck,
      bettingWindow, bettingTimeConfirmed: bettingTimeCheck, settlement: settlementCheck,
    },
    // Spieltags-Check (siehe Abschlussbericht) — zusätzliche, rein lesende Prüfungen,
    // separat von `checks` gehalten, damit die bestehende Cockpit-Darstellung (oben)
    // unverändert bleibt und dieser Block klar als eigener, neuer Abschnitt gerendert
    // werden kann.
    spieltagsCheck: {
      duplicates: duplicatesCheck,
      kickoffTimes: kickoffCheck,
      scheduleAssignment: scheduleAssignmentCheck,
      staleTopspiel: topspielCheck,
      wildenrothRecognition: wildenrothRecognitionCheck,
      wildenrothHandicap: wildenrothHandicapCheck,
    },
    openAt,
    availabilitySnapshot,
    manual,
  })
}

// POST { matchday, patch: Partial<ManualState> } — merges a manual confirmation/override into
// the stored JSON. `availability`/`bettingTime` entries get `by`/`at`/`snapshot` filled in here
// (never trusted from the client) so a confirmation can never be forged to a different admin or
// a stale snapshot.
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const actor = await requireAdmin(supabase)
  if (!actor) return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 })

  const body = await request.json().catch(() => null) as
    | { matchday?: number; confirmAvailability?: boolean; confirmBettingTime?: boolean; bonusTipsNotPlanned?: boolean; specialsNotPlanned?: boolean }
    | null
  const matchday = body?.matchday
  if (!matchday) return NextResponse.json({ error: 'matchday fehlt.' }, { status: 400 })

  const admin = createAdminClient()
  const key = `matchday_checklist_md_${matchday}`
  const { data: existingRow } = await admin.from('app_settings').select('value').eq('key', key).maybeSingle()
  const manual = readManual(existingRow?.value)

  if (body?.bonusTipsNotPlanned != null) manual.bonusTipsNotPlanned = body.bonusTipsNotPlanned
  if (body?.specialsNotPlanned != null) manual.specialsNotPlanned = body.specialsNotPlanned

  if (body?.confirmAvailability) {
    const { seasonMatches } = await loadOddsModelInputs(supabase)
    const mdIndex = buildEffectiveMatchdayIndex(seasonMatches)
    const dayMatches = seasonMatches.filter((m) => effectiveMatchdayOf(m, mdIndex) === matchday)
    const { data: wtRows } = await admin.from('teams').select('id').in('name', ['SpVgg Wildenroth', 'SpVgg Wildenroth II'])
    const wtIds = new Set((wtRows ?? []).map((r) => r.id))
    const wildenrothMatchIds = dayMatches.filter((m) => wtIds.has(m.home_team_id) || wtIds.has(m.away_team_id)).map((m) => m.id)
    const { data: statusRows } = await admin.from('match_goalscorer_odds').select('match_id, player_id, status').in('match_id', wildenrothMatchIds).order('player_id')
    const snapshot = JSON.stringify((statusRows ?? []).map((r) => `${r.match_id}:${r.player_id}:${r.status}`))
    manual.availability = { at: new Date().toISOString(), by: actor.name, snapshot }
  }

  if (body?.confirmBettingTime) {
    const { data: settingRow } = await admin.from('app_settings').select('value').eq('key', `betting_open_md_${matchday}`).maybeSingle()
    manual.bettingTime = { at: new Date().toISOString(), by: actor.name, snapshot: settingRow?.value ?? '' }
  }

  const { error } = await admin.from('app_settings').upsert({ key, value: JSON.stringify(manual), updated_at: new Date().toISOString() })
  await logAdminAction({ actorId: actor.id, actorName: actor.name, action: 'checklist_confirmation', objectType: 'matchday_checklist', objectId: matchday, newValue: manual, success: !error, errorMessage: error?.message })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, manual })
}
