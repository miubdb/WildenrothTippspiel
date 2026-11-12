import type { VisibleWinterAward } from '@/lib/recap/winterAwardsStore'
import { WINTER_LABEL } from '@/lib/recap/winterAwards'

/**
 * Winter-Auszeichnungen im Pokalschrank – klar als „Hinrunde 2026/27“ gekennzeichnet und getrennt von den regulären
 * Spieltags-Pokalen (gleiche Kachelform wie PokalschrankAwardTile, eisblaue statt goldener Tönung). Zeigt nur, was der
 * Server freigegeben hat (loadVisibleWinterAwards: nur bei veröffentlichtem Winter-Recap).
 */
export function WinterAwardsShelf({ awards }: { awards: VisibleWinterAward[] }) {
  if (awards.length === 0) return null
  return (
    <div className="border-t border-gray-50 dark:border-gray-700 p-3" data-testid="winter-awards">
      <div className="mb-2 flex items-center gap-1.5 px-0.5">
        <span aria-hidden>❄️</span>
        <h3 className="text-xs font-bold uppercase tracking-wide text-sky-800 dark:text-sky-200">{WINTER_LABEL}</h3>
        <span className="ml-auto text-[10px] text-gray-400 dark:text-gray-500">{awards.length} Auszeichnung{awards.length !== 1 ? 'en' : ''}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {awards.map((a) => (
          <div key={a.award_key} className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 dark:border-sky-800/50 dark:bg-sky-900/20">
            <div className="flex items-center gap-2.5">
              <span className="flex-shrink-0 text-2xl">{a.award_icon}</span>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold leading-tight text-gray-900 dark:text-gray-100">{a.award_title}</div>
                <div className="mt-0.5 text-[10px] leading-snug text-gray-500 dark:text-gray-400">{a.award_description}</div>
                <div className="mt-0.5 text-[10px] text-gray-400 dark:text-gray-500">{WINTER_LABEL}{a.value_text && <span className="ml-1 font-semibold text-sky-700 dark:text-sky-300">{a.value_text}</span>}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
