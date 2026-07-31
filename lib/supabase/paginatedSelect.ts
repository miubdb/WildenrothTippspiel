const PAGE_SIZE = 1000

/**
 * PostgREST (and therefore every Supabase `.select()`) silently caps results at
 * a server-configured row limit (1000 by default) — a query that returns
 * exactly that many rows looks identical to one that returns everything, no
 * error, no truncation flag. Several tables here (`prior_season_matches`,
 * `league_players`, `match_lineups`) feed the odds model directly and can
 * plausibly cross that cap as more seasons/lineups accumulate — silently
 * dropping half a team's history would skew every match's odds with no
 * indication anything is wrong.
 *
 * `query` must apply a stable `.order(...)` before `.range(from, to)` — without
 * one, repeated range pages are not guaranteed to be disjoint/complete.
 */
export async function fetchAllRows<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const all: T[] = []
  let from = 0
  for (;;) {
    const { data, error } = await query(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const rows = data ?? []
    all.push(...rows)
    if (rows.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all
}
