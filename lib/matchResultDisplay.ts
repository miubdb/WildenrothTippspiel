import type { Match } from '@/types'

/**
 * Nur Darstellung von Spielergebnissen im Tippspiel-Spielplan.
 * Eine amtliche Wertung ist KEIN regulär ausgetragenes Spiel:
 * status='annulled', home_score/away_score bleiben NULL und Wetten @1,00.
 */
export function isMatchConcluded(match: Pick<Match, 'status'>): boolean {
  return match.status === 'finished' || match.status === 'annulled'
}

export interface MatchResultDisplay {
  label: string
  detail: string | null
  isAdministrative: boolean
}

export function matchResultDisplay(match: Pick<
  Match,
  'status' | 'home_score' | 'away_score' |
  'annulment_type' | 'annulment_official_home_score' |
  'annulment_official_away_score' | 'annulment_official_confirmed_at'
>): MatchResultDisplay | null {
  if (match.status === 'finished') {
    if (match.home_score == null || match.away_score == null) return null
    return { label: `${match.home_score}:${match.away_score}`, detail: null, isAdministrative: false }
  }
  if (match.status !== 'annulled') return null

  // Erst amtlich BESTÄTIGTE Ergebnisse anzeigen, nie den vorläufigen
  // 2:0/0:2-Vorschlag allein aus annulment_type ableiten.
  if (
    match.annulment_official_confirmed_at != null &&
    match.annulment_official_home_score != null &&
    match.annulment_official_away_score != null
  ) {
    return {
      label: `${match.annulment_official_home_score}:${match.annulment_official_away_score} (Wertung)`,
      detail: 'Amtliche BFV-Wertung · Wetten neutralisiert (Quote 1,00)',
      isAdministrative: true,
    }
  }

  switch (match.annulment_type) {
    case 'away_no_show':
      return { label: 'N.AN. GAST', detail: 'Nichtantritt Gast · amtliche Wertung ausstehend · Wetten neutralisiert (Quote 1,00)', isAdministrative: true }
    case 'home_no_show':
      return { label: 'N.AN. HEIM', detail: 'Nichtantritt Heim · amtliche Wertung ausstehend · Wetten neutralisiert (Quote 1,00)', isAdministrative: true }
    default:
      return { label: 'ANNULLIERT', detail: 'Amtliche Wertung ausstehend · Wetten neutralisiert (Quote 1,00)', isAdministrative: true }
  }
}
