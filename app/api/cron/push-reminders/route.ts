import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPushToUser, sendPushToAll } from '@/lib/push'

/** Returns Monday 12:00 Europe/Berlin of the week containing firstMatchDate (UTC Date) */
function bettingOpenTime(firstMatchDate: Date): Date {
  const berlinDate = firstMatchDate.toLocaleDateString('sv', { timeZone: 'Europe/Berlin' })
  const [y, m, d] = berlinDate.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  const daysBack = dow === 0 ? 6 : dow - 1
  const mondayD = d - daysBack
  const mondayStr = `${y}-${String(m).padStart(2, '0')}-${String(mondayD).padStart(2, '0')}`
  const probe = new Date(`${mondayStr}T12:00:00Z`)
  const berlinHour = parseInt(
    new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', hour12: false }).format(probe),
    10
  )
  const utcHour = 24 - berlinHour
  return new Date(`${mondayStr}T${String(utcHour).padStart(2, '0')}:00:00Z`)
}

export async function GET(request: NextRequest) {
  const secret = request.headers.get('authorization')?.replace('Bearer ', '')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const now = new Date()

  // Fetch all matchdays with at least one scheduled match
  const { data: scheduledMatches } = await admin
    .from('matches')
    .select('id, matchday, match_date')
    .eq('status', 'scheduled')
    .order('match_date', { ascending: true })

  if (!scheduledMatches || scheduledMatches.length === 0) {
    return NextResponse.json({ ok: true, sent: [] })
  }

  // Group by matchday
  const matchdayMap = new Map<number, { matchday: number; firstDate: Date; allDates: Date[] }>()
  for (const m of scheduledMatches) {
    const date = new Date(m.match_date)
    const existing = matchdayMap.get(m.matchday)
    if (!existing) {
      matchdayMap.set(m.matchday, { matchday: m.matchday, firstDate: date, allDates: [date] })
    } else {
      existing.allDates.push(date)
      if (date < existing.firstDate) existing.firstDate = date
    }
  }

  const sent: string[] = []

  for (const { matchday, firstDate, allDates } of matchdayMap.values()) {
    const deadline = firstDate // earliest match start = betting deadline
    const opensAt = bettingOpenTime(firstDate)
    const minutesSinceOpens = (now.getTime() - opensAt.getTime()) / 60000
    const minutesTillDeadline = (deadline.getTime() - now.getTime()) / 60000

    // ── Betting-opens notification ──────────────────────────────────────────
    // Send once within the first 15 min after bettingOpenTime
    if (minutesSinceOpens >= 0 && minutesSinceOpens < 15) {
      const { error: dedupError } = await admin
        .from('push_reminders')
        .insert({ type: 'betting_open', matchday })

      if (!dedupError) {
        // Calculate last match date for display
        const lastDate = allDates.reduce((max, d) => (d > max ? d : max), allDates[0])
        const lastDateStr = lastDate.toLocaleDateString('de-DE', {
          weekday: 'short',
          day: '2-digit',
          month: '2-digit',
          timeZone: 'Europe/Berlin',
        })
        await sendPushToAll(
          `🏟️ Spieltag ${matchday} – Wetten offen!`,
          `Du kannst jetzt deine Tipps für Spieltag ${matchday} abgeben. Tippschluss ist jeweils vor dem Anpfiff des jeweiligen Spiels.`,
          `/tipps?matchday=${matchday}`
        )
        sent.push(`betting_open:${matchday}`)
      }
    }

    // ── 1h-before-deadline reminder ────────────────────────────────────────
    // Send once when 45–75 min remain before the first match
    if (minutesTillDeadline >= 45 && minutesTillDeadline < 75) {
      const { error: dedupError } = await admin
        .from('push_reminders')
        .insert({ type: 'deadline_reminder', matchday })

      if (!dedupError) {
        // Fetch all user IDs that have placed bets this matchday
        const { data: matchdayMatchRows } = await admin
          .from('matches')
          .select('id')
          .eq('matchday', matchday)

        const matchdayMatchIds = (matchdayMatchRows ?? []).map((m) => m.id)

        // Fetch profiles of all users
        const { data: allProfiles } = await admin
          .from('profiles')
          .select('id')

        if (allProfiles && matchdayMatchIds.length > 0) {
          // Count bets per user for this matchday
          const { data: betLegs } = await admin
            .from('bets')
            .select('user_id, combo_id')
            .in('match_id', matchdayMatchIds)

          const userBetCounts = new Map<string, number>()
          for (const leg of betLegs ?? []) {
            const key = leg.combo_id ? `combo:${leg.combo_id}` : `single:${leg.user_id}`
            if (!userBetCounts.has(leg.user_id)) userBetCounts.set(leg.user_id, 0)
            // We'll compute distinct bet units per user below
          }

          // Distinct bet units per user: singles + distinct combos
          const userSingles = new Map<string, number>()
          const userCombos = new Map<string, Set<number>>()
          for (const leg of betLegs ?? []) {
            if (leg.combo_id === null) {
              userSingles.set(leg.user_id, (userSingles.get(leg.user_id) ?? 0) + 1)
            } else {
              if (!userCombos.has(leg.user_id)) userCombos.set(leg.user_id, new Set())
              userCombos.get(leg.user_id)!.add(leg.combo_id)
            }
          }

          const pushPromises: Promise<void>[] = []
          for (const profile of allProfiles) {
            const singles = userSingles.get(profile.id) ?? 0
            const combos = userCombos.get(profile.id)?.size ?? 0
            const totalBets = singles + combos
            if (totalBets < 3) {
              pushPromises.push(
                sendPushToUser(
                  profile.id,
                  '⏰ Erste Partie startet bald!',
                  `Spieltag ${matchday} – du hast noch ${3 - totalBets} Wettschein(e) übrig. Danach ist nur noch auf spätere Spiele möglich.`,
                  `/tipps?matchday=${matchday}`
                )
              )
            }
          }
          await Promise.allSettled(pushPromises)
        }

        sent.push(`deadline_reminder:${matchday}`)
      }
    }
  }

  return NextResponse.json({ ok: true, sent })
}
