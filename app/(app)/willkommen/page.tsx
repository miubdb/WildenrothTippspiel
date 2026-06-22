import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function WillkommenPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, username, eligible_for_current_season, is_wildenroth')
    .eq('id', user.id)
    .single()

  const name = profile?.display_name || profile?.username || 'du'
  const eligible = profile?.eligible_for_current_season ?? true
  const isWildenroth = profile?.is_wildenroth ?? false

  return (
    <div className="px-4 py-6 space-y-5 max-w-lg mx-auto">
      {/* Hero */}
      <div className="bg-gradient-to-br from-red-700 to-red-900 text-white rounded-2xl px-5 py-6 shadow-sm text-center">
        <div className="text-4xl mb-3">🎉</div>
        <h1 className="text-2xl font-black">Willkommen, {name}!</h1>
        <p className="text-red-200 text-sm mt-2">
          Du bist jetzt Teil des Wildenroth Tippspiels.
        </p>
      </div>

      {/* Freischaltungs-Hinweis */}
      {!eligible && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="text-2xl">⏳</span>
            <div>
              <h2 className="font-bold text-gray-900">Freischaltung ausstehend</h2>
              <p className="text-sm text-gray-600 mt-1">
                Du hast dich nach Saisonstart registriert. Melde dich kurz per WhatsApp bei Jani — er schaltet dich dann frei.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Wildenroth-Hinweis */}
      {isWildenroth && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="text-2xl">⚽</span>
            <div>
              <h2 className="font-bold text-gray-900">Wildenroth-Spieler</h2>
              <p className="text-sm text-gray-600 mt-1">
                Als aktiver Spieler/Trainer darfst du nicht gegen Wildenroth tippen — alle anderen Wetten sind erlaubt.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* So funktioniert's */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-50 dark:border-gray-700">
          <h2 className="font-bold text-gray-900 dark:text-gray-100">So funktioniert das Tippspiel</h2>
        </div>
        <div className="divide-y divide-gray-50 dark:divide-gray-700">
          {[
            { icon: '💰', title: 'Startkapital: 1.000 Rothaler', text: 'Du bekommst virtuell 1.000 RT (Rothaler) zum Tippen — die offizielle Währung des Wildenroth Tippspiels.' },
            { icon: '🎯', title: 'Pro Spieltag 3 Wetten', text: 'Davon 2 normale Wetten und 1 Risiko-Wette (mind. Gesamtquote 20). Einzelwetten oder Kombiwette — du entscheidest.' },
            { icon: '🔗', title: 'Kombiwetten möglich', text: 'Mehrere Spiele lassen sich zu einer Kombiwette verknüpfen. Pro Spiel gilt nur ein Tipp.' },
            { icon: '📊', title: 'Rangliste', text: 'Wer am Ende der Saison das höchste Guthaben hat, gewinnt.' },
            { icon: '⏰', title: 'Wettfenster', text: 'Tipps sind ab Montag 12:00 Uhr möglich. Jedes Spiel schließt individuell beim Anpfiff — andere Spiele des gleichen Spieltags bleiben länger offen.' },
          ].map(({ icon, title, text }) => (
            <div key={title} className="flex items-start gap-3 px-5 py-3">
              <span className="text-xl flex-shrink-0">{icon}</span>
              <div>
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{text}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-2">
        <Link
          href="/tipps"
          className="block w-full py-3 bg-red-700 hover:bg-red-800 text-white font-bold text-center rounded-xl transition-colors"
        >
          {eligible ? 'Los geht\'s →' : 'Zur App →'}
        </Link>
        <Link
          href="/anleitung"
          className="block w-full py-3 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 font-semibold text-center rounded-xl transition-colors text-sm"
        >
          Alle Regeln lesen
        </Link>
      </div>
    </div>
  )
}
