import { CUP_MARKET_LABEL } from '@/lib/betDisplay'

/** Lesbare Marktnamen für den Recap (geteilt von echtem Recap und Datenbank-freier Vorschau). */
export const MARKET_LABELS: Record<string, string> = {
  '1x2': 'Spielausgang', double_chance: 'Doppelte Chance', handicap: 'Handicap', btts: 'Beide treffen', exact_score: 'Ergebnis',
  over_under_2_5: 'Über/Unter 2,5', over_under_3_5: 'Über/Unter 3,5', over_under_5_5: 'Über/Unter 5,5', over_under_7_5: 'Über/Unter 7,5', over_9_5: 'Über 9,5 Tore',
  goalscorer: 'Torschütze', goalscorer_2plus: 'Torschütze 2+', matchday_special: 'Spieltags-Special',
  ...CUP_MARKET_LABEL,
}
