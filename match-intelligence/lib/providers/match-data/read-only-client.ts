import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * A structurally read-only handle onto a Postgrest table: it exposes only
 * `.select(...)`, never `.insert/.update/.upsert/.delete`. This is the
 * mechanism (not just a comment) that keeps ExistingTippspielProvider from
 * ever writing to the Tippspiel project's database (spec section 53:
 * "Ändere das alte Projekt NICHT ungefragt") — there is no method on this
 * object capable of it, so a test can assert read-only-ness by inspecting
 * the object's own shape rather than trusting prose.
 */
type TableBuilder = ReturnType<SupabaseClient['from']>

export interface ReadOnlyTable {
  select: TableBuilder['select']
}

export interface ReadOnlyClient {
  from(table: string): ReadOnlyTable
}

export function createReadOnlyClient(url: string, anonKey: string): ReadOnlyClient {
  const client = createSupabaseClient(url, anonKey, { auth: { persistSession: false } })
  return {
    from(table: string): ReadOnlyTable {
      const builder = client.from(table)
      return { select: builder.select.bind(builder) } as ReadOnlyTable
    },
  }
}
