import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { HINRUNDE } from '@/lib/recap/availability'
import { RecapTypeNav } from '@/components/recap/RecapTypeNav'

/** Unaufdringliche Navigation für bestehende Recap-Seiten: Zurück zum Hub + Umschalter. Der Hinrunden-Recap
 *  erscheint nur, wenn er veröffentlicht ist (Veröffentlichen setzt „bereit" voraus) – oder für Admins als Vorschau. */
export async function RecapTopNav({ current }: { current: 'spieltag' | 'hinrunde' }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  let hinrunde = false
  if (user) {
    const [{ data: me }, { data: setting }] = await Promise.all([
      supabase.from('profiles').select('is_admin').eq('id', user.id).single(),
      createAdminClient().from('app_settings').select('value').eq('key', HINRUNDE.settingKey).maybeSingle(),
    ])
    hinrunde = !!me?.is_admin || setting?.value === 'true'
  }
  return (
    <div className="space-y-2">
      <Link href="/recap" className="text-sm font-semibold text-red-700 dark:text-red-300">← Alle Recaps</Link>
      <RecapTypeNav current={current} available={{ hinrunde }} />
    </div>
  )
}
