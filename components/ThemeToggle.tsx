'use client'

import { useTheme } from '@/components/ThemeProvider'

type Option = { value: 'light' | 'dark' | 'system'; label: string; icon: string }

const OPTIONS: Option[] = [
  { value: 'light', label: 'Hell', icon: '☀️' },
  { value: 'dark', label: 'Dunkel', icon: '🌙' },
  { value: 'system', label: 'System', icon: '⚙️' },
]

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-50 dark:border-gray-700">
        <h2 className="font-bold text-gray-900 dark:text-gray-100">Erscheinungsbild</h2>
      </div>
      <div className="flex divide-x divide-gray-100 dark:divide-gray-700">
        {OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => setTheme(opt.value)}
            className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs font-semibold transition-colors ${
              theme === opt.value
                ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'
            }`}
          >
            <span className="text-lg">{opt.icon}</span>
            <span>{opt.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
