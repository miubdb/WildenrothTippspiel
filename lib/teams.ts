// League teams + crest slug helper, shared across profile views.

// 26/27 season teams — IDs in DB: SC Schöngeising=8, SpVgg Wildenroth=14, rest 15–28
export const LEAGUE_TEAMS = [
  'SC Schöngeising',
  'SpVgg Wildenroth',
  'TSV Geiselbullach',
  'TSV Altenstadt',
  'TSV Peiting',
  'FC Wildsteig/Rottenbuch',
  'SC Unterpfaffenhofen',
  'SV Fuchstal',
  'TSV 1882 Landsberg II',
  'FC Aich',
  'SC Oberweikertshofen II',
  'TSV Türkenfeld',
  'SV Igling',
  'FC Issing',
  'VfL Denklingen',
  'TSV Oberalting-Seefeld',
] as const

/**
 * Build a crest slug from a team name:
 * lowercase, spaces/`/` → `-`, umlauts transliterated.
 * e.g. "TSV Türkenfeld" → "tsv-tuerkenfeld"
 */
export function crestSlug(teamName: string): string {
  return teamName
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[\s/]+/g, '-')
}

export function crestPath(teamName: string): string {
  return `/crests/${crestSlug(teamName)}.png`
}
