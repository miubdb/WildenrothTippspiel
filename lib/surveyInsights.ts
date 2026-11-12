import type { Answers } from './survey'
import type { SurveyRow } from './surveyAggregate'

export interface InsightRate {
  count: number
  base: number
  pct: number | null
}

export interface InsightRank {
  label: string
  count: number
  base: number
  pct: number | null
}

export interface SurveyDecisionInsights {
  submitted: number
  satisfactionAvg: number | null
  returning: InsightRate
  leaving: InsightRate
  feeExit: InsightRate
  pushProblems: InsightRate
  quotaProblems: InsightRate
  recapReaders: InsightRate
  topFeatures: InsightRank[]
  topObstacles: InsightRank[]
  expendableMarkets: InsightRank[]
  additionalMarkets: InsightRank[]
  prices: { price: number; willing: number; population: number; hypotheticalBudget: number }[]
  suggestions: { title: string; reason: string; base: number }[]
}

function rate(count: number, base: number): InsightRate {
  return { count, base, pct: base > 0 ? (100 * count) / base : null }
}

const Q30_YES = new Set(['Ja, auf jeden Fall', 'Eher ja'])
const Q30_NO = new Set(['Eher nein', 'Nein, voraussichtlich nicht'])
const Q20_PROBLEM = new Set([
  'Ich nutze sie, bekomme aber zu viele Benachrichtigungen',
  'Ich habe sie aktiviert, aber sie kommen nicht zuverlässig an',
  'Ich nutze sie, finde sie aber kaum hilfreich',
  'Ich habe die Einrichtung versucht, aber sie hat nicht funktioniert',
])
const Q21_READERS = new Set(['Ich lese eigentlich jeden Recap.', 'Ich lese die meisten Recaps, aber nicht alle.'])
const Q29_NOT_OBSTACLES = new Set([
  'Ich wette bereits so häufig, wie ich möchte.',
  'Ich wette bewusst nur, wenn ich eine gute Gelegenheit sehe',
  'Sonstiges',
])
const Q25_NOT_MARKETS = new Set(['Auf keinen – ich möchte alle behalten', 'Kann ich nicht beurteilen'])
const Q26_NOT_MARKETS = new Set(['Keine zusätzlichen Wettmärkte nötig', 'Kann ich nicht beurteilen'])
const Q5_EUROS: Record<string, number> = {
  'Weniger als 5 €': 0,
  '5 €': 5,
  '10 €': 10,
  '15 €': 15,
  '20 €': 20,
  'Mehr als 20 €': 21,
}

function choices(answers: Answers, id: string): string[] {
  const value = answers[id]
  return Array.isArray(value) ? value : []
}

function rank(rows: SurveyRow[], id: string, excluded: Set<string>, limit: number): InsightRank[] {
  const answered = rows.filter((r) => choices(r.answers, id).length > 0)
  const counts = new Map<string, number>()
  for (const row of answered) {
    for (const answer of new Set(choices(row.answers, id))) {
      if (!excluded.has(answer)) counts.set(answer, (counts.get(answer) ?? 0) + 1)
    }
  }
  return [...counts].map(([label, count]) => ({
    label, count, base: answered.length, pct: rate(count, answered.length).pct,
  })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'de')).slice(0, limit)
}

export function computeSurveyDecisionInsights(rows: SurveyRow[]): SurveyDecisionInsights {
  // This function only consumes already-validated, completed rows. The server
  // filters by survey_version and isActuallySubmitted before returning them.
  const answered = (id: string) => rows.filter((r) => typeof r.answers[id] === 'string')
  const q30 = answered('q30_general')
  const q4 = answered('q4')
  const q9 = answered('q9')
  const q20 = answered('q20')
  const q21 = answered('q21_recap_frequency')
  const satisfactions = rows.map((r) => r.answers.q1).filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
  const returning = rate(q30.filter((r) => Q30_YES.has(r.answers.q30_general as string)).length, q30.length)
  const leaving = rate(q30.filter((r) => Q30_NO.has(r.answers.q30_general as string)).length, q30.length)
  const feeExit = rate(q4.filter((r) => (r.answers.q4 as string).startsWith('Ich möchte kein Startgeld.')).length, q4.length)
  const pushProblems = rate(q20.filter((r) => Q20_PROBLEM.has(r.answers.q20 as string)).length, q20.length)
  const quotaProblems = rate(q9.filter((r) => ['Häufig', 'Sehr häufig'].includes(r.answers.q9 as string)).length, q9.length)
  const recapReaders = rate(q21.filter((r) => Q21_READERS.has(r.answers.q21_recap_frequency as string)).length, q21.length)

  const q5 = rows.filter((r) => typeof r.answers.q5 === 'string')
  const prices = [5, 10, 15, 20].map((price) => {
    const willing = q5.filter((r) => (Q5_EUROS[r.answers.q5 as string] ?? -1) >= price).length
    return { price, willing, population: rows.length, hypotheticalBudget: willing * price }
  })

  const topFeatures = rank(rows, 'q_features', new Set(['Keine dieser Funktionen interessiert mich']), 5)
  const topObstacles = rank(rows, 'q29', Q29_NOT_OBSTACLES, 5)
  const expendableMarkets = rank(rows, 'q25', Q25_NOT_MARKETS, 5)
  const additionalMarkets = rank(rows, 'q26_markets', Q26_NOT_MARKETS, 5)
  const suggestions: SurveyDecisionInsights['suggestions'] = []

  // Deliberately conservative: possible actions are prompts for investigation,
  // never automatically presented as a mandate from a small self-selected poll.
  if (rows.length >= 5) {
    if (feeExit.pct != null && feeExit.pct >= 25 && feeExit.count >= 3) {
      suggestions.push({ title: 'Startgeld-Risiko prüfen', reason: feeExit.count + ' von ' + feeExit.base + ' lehnen ein verpflichtendes Startgeld mit Ausstiegsfolge ab.', base: feeExit.base })
    }
    if (quotaProblems.pct != null && quotaProblems.pct >= 25 && quotaProblems.count >= 3) {
      suggestions.push({ title: 'Quotenmodell überprüfen', reason: quotaProblems.count + ' von ' + quotaProblems.base + ' halten Quoten häufig oder sehr häufig für unrealistisch.', base: quotaProblems.base })
    }
    if (pushProblems.pct != null && pushProblems.pct >= 25 && pushProblems.count >= 3) {
      suggestions.push({ title: 'Push-Benachrichtigungen verbessern', reason: pushProblems.count + ' von ' + pushProblems.base + ' melden ein konkretes Problem mit Push.', base: pushProblems.base })
    }
    if (leaving.pct != null && leaving.pct >= 20 && leaving.count >= 3) {
      suggestions.push({ title: 'Teilnehmerbindung verstehen', reason: leaving.count + ' von ' + leaving.base + ' planen selbst bei kostenloser Teilnahme eher nicht oder nicht mehr mitzumachen.', base: leaving.base })
    }
    if (topObstacles[0]?.count >= 3 && (topObstacles[0].pct ?? 0) >= 30) {
      suggestions.push({ title: 'Häufigstes Hindernis untersuchen', reason: topObstacles[0].label + ' (' + topObstacles[0].count + ' von ' + topObstacles[0].base + ').', base: topObstacles[0].base })
    }
  }

  return {
    submitted: rows.length,
    satisfactionAvg: satisfactions.length > 0 ? satisfactions.reduce((sum, value) => sum + value, 0) / satisfactions.length : null,
    returning, leaving, feeExit, pushProblems, quotaProblems, recapReaders,
    topFeatures, topObstacles, expendableMarkets, additionalMarkets, prices, suggestions,
  }
}

export type SurveySegment =
  | 'all' | 'satisfied_low' | 'satisfied_high'
  | 'return_yes' | 'return_undecided' | 'return_no'
  | 'fee_exit' | 'fee_ok' | 'risky_no'

export const SURVEY_SEGMENTS: { id: SurveySegment; label: string }[] = [
  { id: 'all', label: 'Alle abgegebenen Antworten' },
  { id: 'satisfied_low', label: 'Zufriedenheit 1–6 (Q1)' },
  { id: 'satisfied_high', label: 'Zufriedenheit 9–10 (Q1)' },
  { id: 'return_yes', label: 'Wieder dabei: Ja / eher ja (Q30)' },
  { id: 'return_undecided', label: 'Wiederteilnahme unentschlossen (Q30)' },
  { id: 'return_no', label: 'Wieder dabei: Eher nein / nein (Q30)' },
  { id: 'fee_exit', label: 'Startgeld: würde aussteigen (Q4)' },
  { id: 'fee_ok', label: 'Startgeld: grundsätzlich akzeptiert (Q4)' },
  { id: 'risky_no', label: 'Risky-Wetten abschaffen (Q12)' },
]

export function inSurveySegment(answers: Answers, segment: SurveySegment): boolean {
  switch (segment) {
    case 'all': return true
    case 'satisfied_low': return typeof answers.q1 === 'number' && answers.q1 <= 6
    case 'satisfied_high': return typeof answers.q1 === 'number' && answers.q1 >= 9
    case 'return_yes': return typeof answers.q30_general === 'string' && Q30_YES.has(answers.q30_general)
    case 'return_undecided': return answers.q30_general === 'Ich bin noch unentschlossen'
    case 'return_no': return typeof answers.q30_general === 'string' && Q30_NO.has(answers.q30_general)
    case 'fee_exit': return typeof answers.q4 === 'string' && answers.q4.startsWith('Ich möchte kein Startgeld.')
    case 'fee_ok': return typeof answers.q4 === 'string' && !answers.q4.startsWith('Ich möchte kein Startgeld.') && !answers.q4.startsWith('Das kann ich erst entscheiden,')
    case 'risky_no': return answers.q12 === '0 – Risky-Wetten vollständig abschaffen'
  }
}
