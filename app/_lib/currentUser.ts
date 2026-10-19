import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'

/**
 * Angemeldeter Nutzer, EINMAL pro Anfrage. Layout und Seite riefen `supabase.auth.getUser()` jeweils selbst auf – jeder Aufruf ist eine
 * Netzwerkanfrage an den Auth-Server. React `cache` teilt das Ergebnis innerhalb eines Server-Renders. Die Zugriffsprüfung selbst
 * (proxy.ts, RLS, Routen) bleibt unverändert.
 */
export const getCurrentUser = cache(async () => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
})
