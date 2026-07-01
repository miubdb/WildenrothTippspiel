import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPushToUser, sendPushToAll } from '@/lib/push'
import { bettingOpenTime } from '@/lib/season'

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
      // Skip test matchday (999) — no real-user pushes during test runs
      if (matchday >= 900) continue

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
            `Du kannst jetzt deine Tipps abgeben. Jedes Spiel schließt einzeln bei seinem Anpfiff.`,
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
          .select('user_id, combo_id, is_risky')
          .in('match_id', matchdayMatchIds)
          .eq('season', '26/27')

        // Track normal singles/combos (max 2 slots) and risky singles/combos (max 1 slot)
        const userNormalSingles = new Map<string, number>()
        const userNormalCombos = new Map<string, Set<number>>()
        const userRiskySingles = new Map<string, number>()
        const userRiskyCombos = new Map<string, Set<number>>()

        for (const leg of betLegs ?? []) {
          const isRisky = leg.is_risky === true
          if (leg.combo_id === null) {
            if (isRisky) {
              userRiskySingles.set(leg.user_id, (userRiskySingles.get(leg.user_id) ?? 0) + 1)
            } else {
              userNormalSingles.set(leg.user_id, (userNormalSingles.get(leg.user_id) ?? 0) + 1)
            }
          } else {
            const comboId = leg.combo_id
            if (isRisky) {
              if (!userRiskyCombos.has(leg.user_id)) userRiskyCombos.set(leg.user_id, new Set())
              userRiskyCombos.get(leg.user_id)!.add(comboId)
            } else {
              if (!userNormalCombos.has(leg.user_id)) userNormalCombos.set(leg.user_id, new Set())
              userNormalCombos.get(leg.user_id)!.add(comboId)
            }
          }
        }

        for (const user of eligibleUsers) {
          const normalSlips = (userNormalSingles.get(user.id) ?? 0) + (userNormalCombos.get(user.id)?.size ?? 0)
          const riskySlips = (userRiskySingles.get(user.id) ?? 0) + (userRiskyCombos.get(user.id)?.size ?? 0)

          const normalFree = normalSlips < 2
          const riskyFree = riskySlips < 1

          if (normalFree || riskyFree) {
            const dedupeKey = `bet-reminder-${matchday}-${user.id}`
            const { data: existing } = await admin
              .from('notification_log')
              .select('id')
              .eq('dedupe_key', dedupeKey)
              .eq('status', 'sent')
              .limit(1)
              .single()

            if (!existing) {
              let body: string
              if (normalFree && riskyFree) {
                body = `Spieltag ${matchday} – du hast noch ${2 - normalSlips} normalen Wettschein(e) und deinen Risky-Slot frei. Jedes Spiel schließt bei seinem Anpfiff.`
              } else if (normalFree) {
                body = `Spieltag ${matchday} – du hast noch ${2 - normalSlips} normalen Wettschein(e) frei. Jedes Spiel schließt bei seinem Anpfiff.`
              } else {
                body = `Spieltag ${matchday} – dein Risky-Slot ist noch frei (Quote ≥ 20,00). Jedes Spiel schließt bei seinem Anpfiff.`
              }
              await sendPushToUser(
                user.id,
                '👀 Du hast noch Tipps frei',
                body,
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
