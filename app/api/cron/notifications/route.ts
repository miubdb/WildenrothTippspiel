import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPushToUser, sendPushToAll } from '@/lib/push'

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
  const sent: string[] = []

  try {
    // ── A) Neuer Spieltag ist wettbar ─────────────────────────────────────

    const { data: allMatches } = await admin
      .from('matches')
      .select('id, matchday, match_date, status')
      .eq('status', 'scheduled')
      .order('match_date', { ascending: true })

    if (!allMatches) throw new Error('Failed to fetch matches')

    const matchdayMap = new Map<number, { firstDate: Date; allDates: Date[] }>()
    for (const m of allMatches) {
      const date = new Date(m.match_date)
      const existing = matchdayMap.get(m.matchday)
      if (!existing) {
        matchdayMap.set(m.matchday, { firstDate: date, allDates: [date] })
      } else {
        existing.allDates.push(date)
        if (date < existing.firstDate) existing.firstDate = date
      }
    }

    for (const [matchday, { firstDate, allDates }] of matchdayMap.entries()) {
      const opensAt = bettingOpenTime(firstDate)
      const minutesSinceOpens = (now.getTime() - opensAt.getTime()) / 60000

      // Send "betting open" push within first 15 min of opening
      if (minutesSinceOpens >= 0 && minutesSinceOpens < 15) {
        const dedupeKey = `betting-open-${matchday}`
        const { data: existing } = await admin
          .from('notification_log')
          .select('id')
          .eq('dedupe_key', dedupeKey)
          .eq('status', 'sent')
          .limit(1)
          .single()

        if (!existing) {
          await sendPushToAll(
            `🏟️ Spieltag ${matchday} – Wetten offen!`,
            `Du kannst jetzt deine Tipps für Spieltag ${matchday} abgeben. Tippschluss ist jeweils vor dem Anpfiff.`,
            `/tipps?matchday=${matchday}`,
            'matchday_open',
            dedupeKey
          )
          sent.push(`betting-open:${matchday}`)
        }
      }

      // ── B) Erinnerung: Noch Wettscheine frei ──────────────────────────────

      const deadline = firstDate
      const minutesTillDeadline = (deadline.getTime() - now.getTime()) / 60000

      // Send "bets remaining" reminder 2.5h before first match (window: 135–165 min)
      if (minutesTillDeadline >= 135 && minutesTillDeadline < 165) {
        const matchdayMatches = allMatches.filter(m => m.matchday === matchday)
        const matchdayMatchIds = matchdayMatches.map(m => m.id)

        // Get all eligible users
        const { data: eligibleUsers } = await admin
          .from('profiles')
          .select('id')
          .eq('eligible_for_current_season', true)

        if (!eligibleUsers || matchdayMatchIds.length === 0) continue

        // Get user bet counts for this matchday
        const { data: betLegs } = await admin
          .from('bets')
          .select('user_id, combo_id')
          .in('match_id', matchdayMatchIds)
          .eq('season', '26/27')

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

        for (const user of eligibleUsers) {
          const singles = userSingles.get(user.id) ?? 0
          const combos = userCombos.get(user.id)?.size ?? 0
          const totalBets = singles + combos

          if (totalBets < 3) {
            const dedupeKey = `bet-reminder-${matchday}-${user.id}`
            const { data: existing } = await admin
              .from('notification_log')
              .select('id')
              .eq('dedupe_key', dedupeKey)
              .eq('status', 'sent')
              .limit(1)
              .single()

            if (!existing) {
              await sendPushToUser(
                user.id,
                '👀 Du hast noch Tipps frei',
                `Spieltag ${matchday} – noch ${3 - totalBets} Wettschein(e) verfügbar. Danach nur noch auf spätere Spiele möglich.`,
                `/tipps?matchday=${matchday}`,
                'bet_reminder',
                dedupeKey
              )
              sent.push(`bet-reminder:${matchday}-${user.id}`)
            }
          }
        }
      }
    }

  } catch (err) {
    console.error('Cron notification error:', err)
    return NextResponse.json({ error: 'Cron failed', details: String(err) }, { status: 500 })
  }

  return NextResponse.json({ ok: true, sent, timestamp: now.toISOString() })
}
