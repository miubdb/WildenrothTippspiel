/**
 * A minimal in-memory stand-in for the Supabase JS client, covering exactly
 * the query shapes lib/import/tippspielSync.ts uses (select/insert/update
 * with .eq/.is/.ilike and .single()/.maybeSingle() terminals). This lets the
 * sync orchestration's idempotency/no-duplicates/conflict-recording behavior
 * be tested end-to-end without a real Postgres instance.
 *
 * It is intentionally NOT a general Postgrest mock — only as much surface as
 * the code under test actually calls, so it stays honest about what it
 * verifies rather than pretending to be a full database.
 */

type Row = Record<string, unknown>

export class FakeSupabase {
  tables = new Map<string, Row[]>()
  private idSeq = { n: 0 }

  seed(table: string, rows: Row[]) {
    this.tables.set(table, rows)
  }

  from(table: string) {
    if (!this.tables.has(table)) this.tables.set(table, [])
    return new QueryBuilder(this.tables.get(table)!, () => {
      this.idSeq.n += 1
      return `id-${this.idSeq.n}`
    })
  }
}

type Terminal = 'list' | 'single' | 'maybeSingle' | 'none'

class QueryBuilder implements PromiseLike<{ data: unknown; error: { message: string } | null; count?: number }> {
  private filters: { op: 'eq' | 'is' | 'ilike'; col: string; val: unknown }[] = []
  private mode: 'select' | 'insert' | 'update' = 'select'
  private payload: Row | null = null
  private terminal: Terminal = 'list'
  private selectAfterInsert = false
  private rows: Row[]
  private genId: () => string

  constructor(rows: Row[], genId: () => string) {
    this.rows = rows
    this.genId = genId
  }

  select() {
    if (this.mode === 'insert') this.selectAfterInsert = true
    else this.mode = 'select'
    return this
  }

  insert(obj: Row) {
    this.mode = 'insert'
    this.payload = obj
    return this
  }

  update(obj: Row) {
    this.mode = 'update'
    this.payload = obj
    return this
  }

  eq(col: string, val: unknown) {
    this.filters.push({ op: 'eq', col, val })
    return this
  }

  is(col: string, val: unknown) {
    this.filters.push({ op: 'is', col, val })
    return this
  }

  ilike(col: string, val: unknown) {
    this.filters.push({ op: 'ilike', col, val })
    return this
  }

  order() {
    return this
  }

  single() {
    this.terminal = 'single'
    return this
  }

  maybeSingle() {
    this.terminal = 'maybeSingle'
    return this
  }

  private matches(row: Row): boolean {
    return this.filters.every((f) => {
      const rowVal = row[f.col]
      if (f.op === 'eq') return rowVal === f.val
      if (f.op === 'is') return (rowVal ?? null) === f.val
      if (f.op === 'ilike') return String(rowVal ?? '').toLowerCase() === String(f.val).toLowerCase()
      return false
    })
  }

  private execute(): { data: unknown; error: { message: string } | null } {
    if (this.mode === 'insert' && this.payload) {
      const row: Row = { id: this.genId(), ...this.payload }
      this.rows.push(row)
      if (this.selectAfterInsert) {
        return this.terminal === 'single' ? { data: row, error: null } : { data: [row], error: null }
      }
      return { data: null, error: null }
    }

    if (this.mode === 'update' && this.payload) {
      const matched = this.rows.filter((r) => this.matches(r))
      for (const row of matched) Object.assign(row, this.payload)
      return { data: null, error: null }
    }

    const matched = this.rows.filter((r) => this.matches(r))
    if (this.terminal === 'single') {
      return matched.length === 1 ? { data: matched[0], error: null } : { data: null, error: { message: 'not found' } }
    }
    if (this.terminal === 'maybeSingle') {
      return { data: matched[0] ?? null, error: null }
    }
    return { data: matched, error: null }
  }

  then<TResult1 = { data: unknown; error: { message: string } | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected)
  }
}
