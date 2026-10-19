/**
 * Wie `fetchAllRows` (lib/supabase/paginatedSelect.ts: PostgREST kappt jede Abfrage still bei 1000 Zeilen), aber ohne die Wartekette:
 * Die erste Seite liefert über `select(..., { count: 'exact' })` gleich die Gesamtzahl; alle weiteren Seiten werden dann GLEICHZEITIG
 * geholt. Tabellen unter 1000 Zeilen kosten genau eine Anfrage, 2.200 Wetten zwei Roundtrips statt drei hintereinander.
 * Ohne `count` (Aufrufer vergessen) fällt die Funktion auf das seitenweise Weiterblättern von `fetchAllRows` zurück – nie auf unvollständige Daten.
 *
 * `query` muss – wie dort – vor `.range(from, to)` ein stabiles, eindeutiges `.order(...)` setzen.
 */
const PAGE_SIZE = 1000

type Page<T> = { data: T[] | null; error: { message: string } | null; count?: number | null }

export async function fetchAllRowsParallel<T>(query: (from: number, to: number) => PromiseLike<Page<T>>): Promise<T[]> {
  const first = await query(0, PAGE_SIZE - 1)
  if (first.error) throw new Error(first.error.message)
  const all: T[] = [...(first.data ?? [])]
  if (all.length < PAGE_SIZE) return all

  if (typeof first.count === 'number') {
    const pages = Math.ceil(first.count / PAGE_SIZE)
    if (pages <= 1) return all
    const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => query((i + 1) * PAGE_SIZE, (i + 2) * PAGE_SIZE - 1)))
    for (const r of rest) {
      if (r.error) throw new Error(r.error.message)
      all.push(...(r.data ?? []))
    }
    return all
  }
  // Rückfall: seitenweise bis eine Seite nicht mehr voll ist
  for (let from = PAGE_SIZE; ; from += PAGE_SIZE) {
    const r = await query(from, from + PAGE_SIZE - 1)
    if (r.error) throw new Error(r.error.message)
    const rows = r.data ?? []
    all.push(...rows)
    if (rows.length < PAGE_SIZE) return all
  }
}
