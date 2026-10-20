import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { bettingOpenTime, berlinWallClockToUtc, buildEffectiveMatchdayIndex, effectiveMatchdayOf } from '@/lib/season'
import { loadOddsModelInputs } from '@/lib/oddsInputs'

/**
 * Admin 3.0, Punkt 7: Wettfreigabe im Adminbereich verwalten, statt wie bisher per Hand in der
 * Datenbank. Schreibt ausschließlich den bestehenden Schlüssel `app_settings.betting_open_md_<N>`
 * (lib/season.ts#parseBettingOpenOverrides) — KEINE zweite, eigene Freigabelogik. Rührt nichts
 * an `odds`/`match_odds_overrides` an: ob und wann ein Spieltag tatsächlich einfriert, entscheidet
 * weiterhin ausschließlich tipps/page.tsx beim nächsten Laden (derselbe bestehende, idempotente
 * "einmal eingefroren, nie wieder neu berechnen"-Mechanismus) — diese Route ändert nur, WANN das
 * Fenster öffnet, nie direkt eine Quote.
 */

async function requireAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('is_admin, username, display_name').eq('id', user.id).single()
  if (!profile?.is_admin) return null
  return { id: user.id, name: profile.display_name || profile.username }
}

async function resolveMatchdays(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { seasonMatches } = await loadOddsModelInputs(supabase)
  const mdIndex = buildEffectiveMatchdayIndex(seasonMatches)
  const hasTestMatchday = seasonMatches.some((m) => m.matchday === 999)
  return {
    mdIndex,
    valid: new Set([...(hasTestMatchday ? [999] : []), ...mdIndex.kreisligaMatchdaysDisplayOrder]),
    firstMatchDateByMd: (md: number) => {
      const ms = seasonMatches.filter((m) => effectiveMatchdayOf(m, mdIndex) === md)
      if (ms.length === 0) return null
      return ms.map((m) => new Date(m.match_date)).sort((a, b) => a.getTime() - b.getTime())[0]
    },
  }
}

// GET ?matchday=N — current state for the Cockpit/editor.
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  if (!(await requireAdmin(supabase))) return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 })

  const matchday = parseInt(request.nextUrl.searchParams.get('matchday') ?? '0', 10)
  if (!matchday) return NextResponse.json({ error: 'matchday fehlt.' }, { status: 400 })

  const admin = createAdminClient()
  const { data: settingRow } = await admin.from('app_settings').select('value, updated_at').eq('key', `betting_open_md_${matchday}`).maybeSingle()

  const { firstMatchDateByMd } = await resolveMatchdays(supabase)
  const firstMatch = firstMatchDateByMd(matchday)
  const fallback = firstMatch ? bettingOpenTime(firstMatch) : null

  const openAt = settingRow?.value ?? fallback?.toISOString() ?? null
  return NextResponse.json({
    matchday,
    openAt,
    usingOverride: settingRow?.value != null,
    updatedAt: settingRow?.updated_at ?? null,
    isOpen: openAt ? new Date() >= new Date(openAt) : false,
  })
}

// POST { matchday, date: 'YYYY-MM-DD', time: 'HH:mm' } | { matchday, openNow: true } | { matchday, clear: true }
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const actor = await requireAdmin(supabase)
  if (!actor) return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 })

  const body = await request.json().catch(() => null) as
    | { matchday?: number; date?: string; time?: string; openNow?: boolean; clear?: boolean }
    | null
  const matchday = body?.matchday
  if (!matchday) return NextResponse.json({ error: 'matchday fehlt.' }, { status: 400 })

  const { valid, firstMatchDateByMd } = await resolveMatchdays(supabase)
  if (!valid.has(matchday)) return NextResponse.json({ error: `Spieltag ${matchday} ist kein bekannter Tippspiel-Spieltag.` }, { status: 400 })

  const admin = createAdminClient()
  const key = `betting_open_md_${matchday}`
  const { data: before } = await admin.from('app_settings').select('value').eq('key', key).maybeSingle()
  // An already-opened matchday must never be silently closed/re-timed.
  // That would alter availability for users who may already have pending bets.
  const firstKickoff = firstMatchDateByMd(matchday)
  const priorOpenAt = before?.value ?? (firstKickoff ? bettingOpenTime(firstKickoff).toISOString() : null)
  const wasOpened = priorOpenAt != null && new Date(priorOpenAt).getTime() <= Date.now()
  if (wasOpened) {
    return NextResponse.json({
      error: 'Das Wettfenster dieses Spieltags ist bereits geöffnet. Eine nachträgliche Zeitänderung ist aus Sicherheitsgründen nicht möglich.',
    }, { status: 409 })
  }

  if (body?.clear) {
    const { error } = await admin.from('app_settings').delete().eq('key', key)
    await logAdminAction({
      actorId: actor.id, actorName: actor.name, action: 'betting_window_change', objectType: 'app_settings', objectId: key,
      oldValue: before?.value ?? null, newValue: null, success: !error, errorMessage: error?.message,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, openAt: null })
  }

  let target: Date
  if (body?.openNow) {
    target = new Date()
  } else {
    if (!body?.date || !body?.time) return NextResponse.json({ error: 'date und time erforderlich.' }, { status: 400 })
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date) || !/^\d{2}:\d{2}$/.test(body.time)) {
      return NextResponse.json({ error: 'Ungültiges Datum/Uhrzeit-Format.' }, { status: 400 })
    }
    const [hour, minute] = body.time.split(':').map(Number)
    const day = new Date(`${body.date}T12:00:00Z`)
    if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== body.date
      || hour > 23 || minute > 59) {
      return NextResponse.json({ error: 'Ungültiges Kalenderdatum oder Uhrzeit.' }, { status: 400 })
    }
    // Strict timezone round-trip: reject DST gaps (e.g. 02:30 on spring-forward day)
    // and ambiguous autumn 02:xx hours instead of silently scheduling a wrong instant.
    const [year, month, date] = body.date.split('-').map(Number)
    const berlin = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Berlin', hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    })
    const matches = [1, 2].map((offsetHours) => new Date(Date.UTC(year, month - 1, date, hour - offsetHours, minute)))
      .filter((candidate) => {
        const parts = Object.fromEntries(berlin.formatToParts(candidate).map((p) => [p.type, p.value]))
        return Number(parts.year) === year && Number(parts.month) === month && Number(parts.day) === date
          && Number(parts.hour) === hour && Number(parts.minute) === minute
      })
    if (matches.length !== 1) {
      return NextResponse.json({ error: 'Diese Berliner Uhrzeit existiert nicht oder ist wegen der Zeitumstellung doppeldeutig. Bitte andere Uhrzeit wählen.' }, { status: 400 })
    }
    target = berlinWallClockToUtc(body.date, hour, minute)
    if (!Number.isFinite(target.getTime()) || target.getTime() !== matches[0].getTime()) {
      return NextResponse.json({ error: 'Uhrzeit konnte nicht eindeutig umgerechnet werden.' }, { status: 400 })
    }
    if (target.getTime() <= Date.now()) {
      return NextResponse.json({ error: 'Für eine sofortige Öffnung bitte „Jetzt freigeben“ mit Bestätigung verwenden. Ein Datum in der Vergangenheit ist nicht zulässig.' }, { status: 400 })
    }
    // Grobe Plausibilitätsgrenze — verhindert Tippfehler wie ein Jahr von heute aus, ohne eine
    // Saison mit mehrmonatiger Winterpause künstlich einzuschränken.
    const now = Date.now()
    const oneYearMs = 365 * 24 * 60 * 60 * 1000
    if (Math.abs(target.getTime() - now) > oneYearMs) {
      return NextResponse.json({ error: 'Zeitpunkt liegt mehr als ein Jahr von heute entfernt — bitte prüfen.' }, { status: 400 })
    }
  }

  const { error } = await admin.from('app_settings').upsert({ key, value: target.toISOString(), updated_at: new Date().toISOString() })

  await logAdminAction({
    actorId: actor.id, actorName: actor.name, action: 'betting_window_change', objectType: 'app_settings', objectId: key,
    oldValue: before?.value ?? null, newValue: target.toISOString(), success: !error, errorMessage: error?.message,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, openAt: target.toISOString() })
}
