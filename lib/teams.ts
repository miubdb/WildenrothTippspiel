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
 * Team names whose crest file doesn't match their own transliterated slug —
 * either because they share a crest with a related team (a II side using the
 * 1st team's badge) or because the DB name has punctuation/wording the crest
 * filename doesn't (e.g. the "[SG] ... /SF ..." combined-squad prefix).
 * Single source of truth: both `crestSlug` here and `components/TeamLogo.tsx`
 * must use this map, or the two crest lookups silently drift apart.
 */
export const CREST_NAME_ALIAS: Record<string, string> = {
  'SpVgg Wildenroth II': 'SpVgg Wildenroth',
  'SC Schöngeising II': 'SC Schöngeising',
  'TSV Türkenfeld II': 'TSV Türkenfeld',
  '[SG] TSV Herrsching/SF Breitbrunn 2': 'TSV Herrsching II',
}

/**
 * Build a crest slug from a team name:
 * lowercase, spaces/`/` → `-`, umlauts transliterated.
 * e.g. "TSV Türkenfeld" → "tsv-tuerkenfeld"
 */
export function crestSlug(teamName: string): string {
  return (CREST_NAME_ALIAS[teamName] ?? teamName)
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function crestPath(teamName: string): string {
  return `/crests/${crestSlug(teamName)}.png`
}
