'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

interface MatchRow {
  id: number
  match_number: number
  matchday: number
  match_date: string
  status: string
  home_score: number | null
  away_score: number | null
  home_team: { name: string; short_name: string } | null
  away_team: { name: string; short_name: string } | null
}

interface InviteCode {
  id: string
  code: string
  max_uses: number | null
  used_count: number
  is_active: boolean
  created_at: string
}

type Tab = 'results' | 'bets' | 'invites' | 'odds'

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('results')
  const [matches, setMatches] = useState<MatchRow[]>([])
  const [scores, setScores] = useState<Record<number, { home: string; away: string }>>({})
  const [loading, setLoading] = useState(false)
  const [settleLoading, setSettleLoading] = useState<number | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [inviteCodes, setInviteCodes] = useState<InviteCode[]>([])
  const [newCode, setNewCode] = useState('')
  const [newMaxUses, setNewMaxUses] = useState('10')
  const [oddsLoading, setOddsLoading] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [preview, setPreview] = useState<OddsPreviewResponse | null>(null)
  const [previewMd, setPreviewMd] = useState<number | null>(null)

  const supabase = createClient()

  const fetchMatches = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('matches')
      .select(
        `id, match_number, matchday, match_date, status, home_score, away_score,
         home_team:teams!matches_home_team_id_fkey(name, short_name),
         away_team:teams!matches_away_team_id_fkey(name, short_name)`
      )
      .order('match_date', { ascending: true })

    const rows: MatchRow[] = (data ?? []).map((m) => ({
      ...m,
      home_team: Array.isArray(m.home_team) ? m.home_team[0] : m.home_team,
      away_team: Array.isArray(m.away_team) ? m.away_team[0] : m.away_team,
    }))

    setMatches(rows)
    setLoading(false)
  }, [supabase])

  const fetchInviteCodes = useCallback(async () => {
    const { data } = await supabase
      .from('invite_codes')
      .select('*')
      .order('created_at', { ascending: false })
    setInviteCodes(data ?? [])
  }, [supabase])

  useEffect(() => {
    fetchMatches()
    fetchInviteCodes()
  }, [fetchMatches, fetchInviteCodes])

  function handleScoreChange(
    matchId: number,
    side: 'home' | 'away',
    value: string
  ) {
    setScores((prev) => ({
      ...prev,
      [matchId]: {
        home: side === 'home' ? value : prev[matchId]?.home ?? '',
        away: side === 'away' ? value : prev[matchId]?.away ?? '',
      },
    }))
  }

  async function settleMatch(matchId: number) {
    const score = scores[matchId]
    if (!score || score.home === '' || score.away === '') {
      setMessage('Bitte beide Tore eingeben.')
      return
    }
    const homeScore = parseInt(score.home)
    const awayScore = parseInt(score.away)
    if (isNaN(homeScore) || isNaN(awayScore) || homeScore < 0 || awayScore < 0) {
      setMessage('Ungültige Toranzahl.')
      return
    }

    setSettleLoading(matchId)
    setMessage(null)

    const res = await fetch('/api/admin/settle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId, homeScore, awayScore }),
    })

    const data = await res.json()
    setSettleLoading(null)

    if (res.ok) {
      setMessage(
        `Spiel abgerechnet! ${data.settled} Wette(n) bearbeitet, ${data.combosChecked} Kombi(s) geprüft.`
      )
      fetchMatches()
    } else {
      setMessage(`Fehler: ${data.error}`)
    }
  }

  async function createInviteCode() {
    if (!newCode.trim()) return
    const maxUses = parseInt(newMaxUses) || null

    const { error } = await supabase.from('invite_codes').insert({
      code: newCode.trim().toUpperCase(),
      max_uses: maxUses,
      used_count: 0,
      is_active: true,
    })

    if (error) {
      setMessage(`Fehler: ${error.message}`)
    } else {
      setMessage('Einladungscode erstellt.')
      setNewCode('')
      fetchInviteCodes()
    }
  }

  async function toggleCode(id: string, current: boolean) {
    await supabase.from('invite_codes').update({ is_active: !current }).eq('id', id)
    fetchInviteCodes()
  }

  async function recalculateOdds() {
    setOddsLoading(true)
    setMessage(null)
    const res = await fetch('/api/admin/odds', { method: 'POST' })
    const data = await res.json()
    setOddsLoading(false)
    if (res.ok) {
      setMessage(`Quoten berechnet: ${data.updated}/${data.total} Spiele aktualisiert.`)
    } else {
      setMessage(`Fehler: ${data.error}`)
    }
  }

  const loadPreview = useCallback(async (matchday?: number | null) => {
    setPreviewLoading(true)
    const qs = matchday != null ? `?matchday=${matchday}` : ''
    const res = await fetch(`/api/admin/odds/preview${qs}`)
    const data: OddsPreviewResponse | { error: string } = await res.json()
    setPreviewLoading(false)
    if (res.ok && 'matchday' in data) {
      setPreview(data)
      if (data.matchday != null) setPreviewMd(data.matchday)
    } else if ('error' in data) {
      setMessage(`Fehler: ${data.error}`)
    }
  }, [])

  useEffect(() => {
    if (tab === 'odds' && !preview) loadPreview()
  }, [tab, preview, loadPreview])

  const settledMatches = matches.filter((m) => m.status === 'finished')
  // Past scheduled games awaiting result entry
  const pendingMatches = matches.filter(
    (m) => m.status === 'scheduled' && new Date(m.match_date) <= new Date()
  )
  // Future games — shown read-only, but with optional early result entry for rescheduled games
  const upcomingMatches = matches.filter(
    (m) => m.status === 'scheduled' && new Date(m.match_date) > new Date()
  )

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-red-700 text-white px-4 py-4 shadow-lg">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center">
              <span className="text-red-700 font-black text-xs">SpVgg</span>
            </div>
            <div>
              <h1 className="font-black text-xl">Admin Panel</h1>
              <p className="text-red-200 text-xs">Wildenroth Tippspiel</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4">
        {/* Message */}
        {message && (
          <div
            className={`mb-4 px-4 py-3 rounded-xl text-sm font-medium ${
              message.startsWith('Fehler')
                ? 'bg-red-50 text-red-700 border border-red-100'
                : 'bg-green-50 text-green-700 border border-green-100'
            }`}
          >
            {message}
            <button onClick={() => setMessage(null)} className="ml-2 opacity-60 hover:opacity-100">
              ✕
            </button>
          </div>
        )}

        {/* Tab Bar */}
        <div className="flex bg-white border border-gray-200 rounded-xl p-1 mb-4 shadow-sm">
          {(['results', 'bets', 'invites', 'odds'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${
                tab === t
                  ? 'bg-red-700 text-white shadow'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t === 'results' ? 'Ergebnisse' : t === 'bets' ? 'Tipps' : t === 'invites' ? 'Einladungen' : 'Quoten'}
            </button>
          ))}
        </div>

        {/* Results Tab */}
        {tab === 'results' && (
          <div className="space-y-4">
            {/* Pending settlement */}
            {pendingMatches.length > 0 && (
              <div>
                <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">
                  Ausstehende Ergebnisse ({pendingMatches.length})
                </h2>
                <div className="space-y-2">
                  {pendingMatches.map((match) => (
                    <MatchSettleCard
                      key={match.id}
                      match={match}
                      score={scores[match.id] ?? { home: '', away: '' }}
                      onChange={(side, val) => handleScoreChange(match.id, side, val)}
                      onSettle={() => settleMatch(match.id)}
                      loading={settleLoading === match.id}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Upcoming matches — also allow early settle for rescheduled games */}
            {upcomingMatches.length > 0 && (
              <div>
                <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">
                  Bevorstehende Spiele ({upcomingMatches.length})
                </h2>
                <p className="text-xs text-gray-400 mb-2">
                  Verlegt? Ergebnis kann auch vorab eingetragen werden.
                </p>
                <div className="space-y-2">
                  {upcomingMatches.map((match) => (
                    <MatchSettleCard
                      key={match.id}
                      match={match}
                      score={scores[match.id] ?? { home: '', away: '' }}
                      onChange={(side, val) => handleScoreChange(match.id, side, val)}
                      onSettle={() => settleMatch(match.id)}
                      loading={settleLoading === match.id}
                      isUpcoming
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Settled */}
            {settledMatches.length > 0 && (
              <div>
                <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">
                  Abgerechnete Spiele ({settledMatches.length})
                </h2>
                <div className="space-y-2">
                  {settledMatches.slice(0, 10).map((match) => (
                    <MatchRow key={match.id} match={match} />
                  ))}
                </div>
              </div>
            )}

            {loading && (
              <div className="text-center py-8 text-gray-400">Lade Spiele...</div>
            )}
          </div>
        )}

        {/* Bets Tab */}
        {tab === 'bets' && <AdminBetsTab matches={matches} />}

        {/* Invites Tab */}
        {tab === 'invites' && (
          <div className="space-y-4">
            {/* Create new code */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <h2 className="font-bold text-gray-900 mb-3">Neuen Code erstellen</h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Code</label>
                  <input
                    type="text"
                    value={newCode}
                    onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                    placeholder="z.B. WILDENROTH2025"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm font-mono uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Max. Verwendungen (leer = unbegrenzt)
                  </label>
                  <input
                    type="number"
                    value={newMaxUses}
                    onChange={(e) => setNewMaxUses(e.target.value)}
                    placeholder="10"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
                <button
                  onClick={createInviteCode}
                  disabled={!newCode.trim()}
                  className="w-full py-2.5 bg-red-700 hover:bg-red-800 disabled:bg-red-300 text-white font-semibold rounded-xl transition-colors text-sm"
                >
                  Code erstellen
                </button>
              </div>
            </div>

            {/* Existing codes */}
            <div className="space-y-2">
              {inviteCodes.map((code) => (
                <div
                  key={code.id}
                  className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3 flex items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-mono font-bold text-gray-900 tracking-widest">
                      {code.code}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      Verwendet: {code.used_count}
                      {code.max_uses !== null ? ` / ${code.max_uses}` : ' / ∞'}
                    </div>
                  </div>
                  <button
                    onClick={() => toggleCode(code.id, code.is_active)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      code.is_active
                        ? 'bg-green-100 text-green-700 hover:bg-green-200'
                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                  >
                    {code.is_active ? 'Aktiv' : 'Inaktiv'}
                  </button>
                </div>
              ))}
              {inviteCodes.length === 0 && (
                <div className="text-center py-8 text-gray-400 text-sm">
                  Keine Einladungscodes vorhanden
                </div>
              )}
            </div>
          </div>
        )}

        {/* Odds Tab */}
        {tab === 'odds' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h2 className="font-bold text-gray-900 mb-1">Quoten neu berechnen</h2>
              <p className="text-sm text-gray-500 mb-4">
                Berechnet die Quoten für alle geplanten Spiele neu auf Basis der Saisondaten.
              </p>
              <button
                onClick={recalculateOdds}
                disabled={oddsLoading}
                className="w-full py-3 bg-red-700 hover:bg-red-800 disabled:bg-red-300 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {oddsLoading ? (
                  <>
                    <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                    Berechne...
                  </>
                ) : (
                  'Quoten neu berechnen'
                )}
              </button>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
              <strong>Hinweis:</strong> Quoten werden automatisch aus Kopf-an-Kopf-Statistiken
              und Saisonleistungen berechnet. Eine 10% Marge wird angewendet.
            </div>

            <OddsPreviewSection
              preview={preview}
              loading={previewLoading}
              selectedMd={previewMd}
              onSelectMd={(md) => { setPreviewMd(md); loadPreview(md) }}
              onReload={() => loadPreview(previewMd)}
            />
          </div>
        )}
      </div>
    </div>
  )
}

const MARKET_LABELS: Record<string, string> = {
  '1x2': '1X2', double_chance: 'Dopp. Chance', over_under: 'Ü/U 2,5',
  over_under_3_5: 'Ü/U 3,5', over_under_5_5: 'Ü/U 5,5', over_under_7_5: 'Ü/U 7,5',
  btts: 'Beide treffen', exact_score: 'Ergebnis', handicap: 'Handicap',
}

interface OddsValues {
  home_win: number; draw: number; away_win: number
  odds_1x: number; odds_x2: number; odds_12: number
  over_2_5: number; under_2_5: number
  over_3_5: number; under_3_5: number
  over_5_5: number; under_5_5: number
  over_7_5: number; under_7_5: number
  btts_yes: number; btts_no: number
  hdp_home_minus_1_5: number; hdp_away_plus_1_5: number
  hdp_home_minus_2_5: number; hdp_away_plus_2_5: number
}

interface OddsPreviewMatch {
  match_id: number
  match_number: number
  match_date: string
  status: string
  home_team: string
  away_team: string
  frozen_at: string | null
  odds: OddsValues
  exact_scores: { score: string; odds: number }[]
}

interface OddsPreviewResponse {
  matchday: number | null
  matchdays: number[]
  matches: OddsPreviewMatch[]
  bettingOpensAt: string | null
  isBettingOpen: boolean
}

function fmt(n: number): string {
  return n.toFixed(2).replace('.', ',')
}

function OddsPreviewSection({
  preview, loading, selectedMd, onSelectMd, onReload,
}: {
  preview: OddsPreviewResponse | null
  loading: boolean
  selectedMd: number | null
  onSelectMd: (md: number) => void
  onReload: () => void
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="font-bold text-gray-900">Quoten-Vorschau</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Berechnete Quoten für den nächsten Spieltag · noch nicht freigeschaltet
          </p>
        </div>
        <button
          onClick={onReload}
          disabled={loading}
          className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-40"
        >
          {loading ? '…' : 'Neu laden'}
        </button>
      </div>

      {preview?.matchdays && preview.matchdays.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {preview.matchdays.map((md) => (
            <button
              key={md}
              onClick={() => onSelectMd(md)}
              className={`text-xs px-2.5 py-1 rounded-lg border ${
                (selectedMd ?? preview.matchday) === md
                  ? 'bg-red-700 text-white border-red-700'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              ST {md}
            </button>
          ))}
        </div>
      )}

      {loading && !preview && (
        <div className="text-sm text-gray-500 py-4 text-center">Lade Vorschau…</div>
      )}

      {preview && preview.matches.length === 0 && (
        <div className="text-sm text-gray-500 py-4 text-center">
          Kein Spieltag mit geplanten Spielen gefunden.
        </div>
      )}

      {preview && preview.matches.length > 0 && (
        <>
          <div className="mb-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
            <div className="font-semibold mb-0.5">
              Spieltag {preview.matchday}
              {preview.matches.every((m) => m.frozen_at)
                ? ' · bereits eingefroren'
                : preview.isBettingOpen
                ? ' · Wettfenster offen, noch nicht eingefroren'
                : ' · noch nicht freigeschaltet'}
            </div>
            {preview.bettingOpensAt && (
              <div>
                Geplante Freischaltung:{' '}
                {new Date(preview.bettingOpensAt).toLocaleString('de-DE', {
                  timeZone: 'Europe/Berlin',
                  weekday: 'short',
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}{' '}
                Uhr
              </div>
            )}
          </div>

          <div className="space-y-3">
            {preview.matches.map((m) => (
              <OddsPreviewMatchCard key={m.match_id} match={m} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function OddsPreviewMatchCard({ match }: { match: OddsPreviewMatch }) {
  const o = match.odds
  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      <div className="bg-gray-50 px-3 py-2 flex items-center justify-between">
        <div className="text-sm font-semibold text-gray-800">
          {match.home_team} – {match.away_team}
        </div>
        <div className="text-[10px] text-gray-500">
          {new Date(match.match_date).toLocaleString('de-DE', {
            timeZone: 'Europe/Berlin',
            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
          })}
          {match.frozen_at && <span className="ml-2 text-amber-700 font-semibold">· eingefroren</span>}
        </div>
      </div>
      <div className="p-3 space-y-2 text-xs">
        <OddsRow label="1X2" cells={[
          ['1', fmt(o.home_win)], ['X', fmt(o.draw)], ['2', fmt(o.away_win)],
        ]} />
        <OddsRow label="Dopp. Chance" cells={[
          ['1X', fmt(o.odds_1x)], ['12', fmt(o.odds_12)], ['X2', fmt(o.odds_x2)],
        ]} />
        <OddsRow label="Ü/U 2,5" cells={[['Ü', fmt(o.over_2_5)], ['U', fmt(o.under_2_5)]]} />
        <OddsRow label="Ü/U 3,5" cells={[['Ü', fmt(o.over_3_5)], ['U', fmt(o.under_3_5)]]} />
        <OddsRow label="Ü/U 5,5" cells={[['Ü', fmt(o.over_5_5)], ['U', fmt(o.under_5_5)]]} />
        <OddsRow label="Ü/U 7,5" cells={[['Ü', fmt(o.over_7_5)], ['U', fmt(o.under_7_5)]]} />
        <OddsRow label="BTTS" cells={[['Ja', fmt(o.btts_yes)], ['Nein', fmt(o.btts_no)]]} />
        <OddsRow label="Handicap" cells={[
          ['H -1,5', fmt(o.hdp_home_minus_1_5)],
          ['G +1,5', fmt(o.hdp_away_plus_1_5)],
          ['H -2,5', fmt(o.hdp_home_minus_2_5)],
          ['G +2,5', fmt(o.hdp_away_plus_2_5)],
        ]} />
        {match.exact_scores.length > 0 && (
          <div className="pt-1">
            <div className="text-gray-400 font-medium mb-1">Top Ergebnisse</div>
            <div className="grid grid-cols-4 gap-1">
              {match.exact_scores.map(({ score, odds }) => (
                <div key={score} className="bg-gray-50 rounded px-1.5 py-1 flex items-center justify-between">
                  <span className="font-semibold text-gray-700">{score}</span>
                  <span className="text-red-700 font-bold">{fmt(odds)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function OddsRow({ label, cells }: { label: string; cells: [string, string][] }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 text-gray-500 flex-shrink-0">{label}</div>
      <div className="flex-1 flex gap-1.5 flex-wrap">
        {cells.map(([k, v]) => (
          <div key={k} className="flex items-center gap-1 bg-white border border-gray-200 rounded px-2 py-0.5">
            <span className="text-gray-500">{k}</span>
            <span className="font-bold text-red-700">{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const SELECTION_LABELS: Record<string, string> = {
  home: 'Heimsieg', draw: 'Unentschieden', away: 'Auswärtssieg',
  '1x': '1X', x2: 'X2', '12': '12',
  'over_2.5': 'Über 2,5', 'under_2.5': 'Unter 2,5',
  'over_3.5': 'Über 3,5', 'under_3.5': 'Unter 3,5',
  'over_5.5': 'Über 5,5', 'under_5.5': 'Unter 5,5',
  'over_7.5': 'Über 7,5', 'under_7.5': 'Unter 7,5',
  yes: 'Beide treffen', no: 'Nicht beide',
  home_minus_1_5: 'Heim –1,5', away_plus_1_5: 'Gast +1,5',
  home_minus_2_5: 'Heim –2,5', away_plus_2_5: 'Gast +2,5',
}

function selLabel(marketType: string, selection: string): string {
  if (marketType === 'exact_score') return selection
  return SELECTION_LABELS[selection] ?? selection
}

function AdminBetsTab({ matches }: { matches: MatchRow[] }) {
  const allMatchdays = [...new Set(matches.map(m => m.matchday))].sort((a, b) => a - b)
  const firstScheduled = matches.find(m => m.status === 'scheduled')?.matchday
  const [selectedMd, setSelectedMd] = useState<number>(firstScheduled ?? allMatchdays[allMatchdays.length - 1] ?? 1)
  const [bets, setBets] = useState<{ id: string; user_id: string; match_id: number; market_type: string; selection: string; odds_value: number; status: string; combo_id: string | null; is_risky: boolean; stake: number | null }[]>([])
  const [profiles, setProfiles] = useState<{ id: string; display_name: string | null; username: string }[]>([])
  const [matchMap, setMatchMap] = useState<Record<number, { home: string; away: string }>>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/admin/bets?matchday=${selectedMd}`)
      .then(r => r.json())
      .then(data => { setBets(data.bets ?? []); setProfiles(data.profiles ?? []); setMatchMap(data.matchMap ?? {}) })
      .finally(() => setLoading(false))
  }, [selectedMd])

  const profileMap = Object.fromEntries(profiles.map(p => [p.id, p.display_name || p.username]))
  const byUser = profiles.map(p => ({
    profile: p,
    bets: bets.filter(b => b.user_id === p.id),
  }))

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {allMatchdays.map(md => (
          <button key={md} onClick={() => setSelectedMd(md)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              md === selectedMd ? 'bg-red-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-red-300'
            }`}>
            ST {md}
          </button>
        ))}
      </div>

      {loading && <div className="text-center py-8 text-gray-400 text-sm">Lade Tipps…</div>}

      {!loading && byUser.length === 0 && (
        <div className="text-center py-8 text-gray-400 text-sm">Keine Tipps für Spieltag {selectedMd}</div>
      )}

      {!loading && byUser.map(({ profile, bets: userBets }) => {
        if (userBets.length === 0) return null
        const shownCombos = new Set<string>()
        return (
          <div key={profile.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
              <span className="w-7 h-7 rounded-full bg-red-100 flex items-center justify-center text-red-700 font-bold text-xs flex-shrink-0">
                {(profile.display_name || profile.username)[0].toUpperCase()}
              </span>
              <span className="font-semibold text-sm text-gray-900">{profileMap[profile.id]}</span>
              <span className="ml-auto text-xs text-gray-400">{userBets.filter(b => !b.combo_id).length} Einzel · {new Set(userBets.filter(b => b.combo_id).map(b => b.combo_id)).size} Kombi</span>
            </div>
            <div className="divide-y divide-gray-50">
              {userBets.map(bet => {
                if (bet.combo_id) {
                  if (shownCombos.has(bet.combo_id)) return null
                  shownCombos.add(bet.combo_id)
                  const legs = userBets.filter(b => b.combo_id === bet.combo_id)
                  const comboOdds = legs.reduce((acc, l) => acc * l.odds_value, 1)
                  return (
                    <div key={bet.combo_id} className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded">
                          {bet.is_risky ? '🎲 RISKY' : '🔗 KOMBI'}
                        </span>
                        <span className="text-xs text-gray-500">{legs.length} Tipps · @{comboOdds.toFixed(2).replace('.', ',')}</span>
                        <StatusChip status={bet.status} />
                      </div>
                      {legs.map(leg => (
                        <div key={leg.id} className="flex items-center gap-1.5 text-xs text-gray-600 py-0.5 pl-2">
                          <span className="text-gray-400 text-[10px]">{matchMap[leg.match_id]?.home}–{matchMap[leg.match_id]?.away}</span>
                          <span className="bg-gray-100 text-gray-600 px-1 rounded text-[10px]">{MARKET_LABELS[leg.market_type] ?? leg.market_type}</span>
                          <span className="font-medium text-gray-800">{selLabel(leg.market_type, leg.selection)}</span>
                          <span className="text-red-600 font-bold ml-auto">@{leg.odds_value.toFixed(2).replace('.', ',')}</span>
                        </div>
                      ))}
                    </div>
                  )
                }
                return (
                  <div key={bet.id} className="px-4 py-2.5 flex items-center gap-2 text-xs">
                    <span className="text-gray-400">{matchMap[bet.match_id]?.home}–{matchMap[bet.match_id]?.away}</span>
                    <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded text-[10px]">{MARKET_LABELS[bet.market_type] ?? bet.market_type}</span>
                    <span className="font-medium text-gray-800">{selLabel(bet.market_type, bet.selection)}</span>
                    {bet.is_risky && <span className="text-[10px] font-bold text-purple-700">🎲</span>}
                    <span className="text-red-600 font-bold ml-auto">@{bet.odds_value.toFixed(2).replace('.', ',')}</span>
                    <span className="text-gray-400">{bet.stake != null ? `${bet.stake} €` : ''}</span>
                    <StatusChip status={bet.status} />
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function StatusChip({ status }: { status: string }) {
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
      status === 'won' ? 'bg-green-100 text-green-700' :
      status === 'lost' ? 'bg-red-100 text-red-600' : 'bg-yellow-50 text-yellow-700'
    }`}>
      {status === 'won' ? 'Gewonnen' : status === 'lost' ? 'Verloren' : 'Offen'}
    </span>
  )
}

function MatchSettleCard({
  match,
  score,
  onChange,
  onSettle,
  loading,
  isUpcoming,
}: {
  match: MatchRow
  score: { home: string; away: string }
  onChange: (side: 'home' | 'away', val: string) => void
  onSettle: () => void
  loading: boolean
  isUpcoming?: boolean
}) {
  const matchDate = new Date(match.match_date)
  const dateStr = matchDate.toLocaleDateString('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  })

  return (
    <div className={`bg-white rounded-xl border shadow-sm p-4 ${isUpcoming ? 'border-blue-200' : 'border-orange-200'}`}>
      <div className="flex items-center justify-between mb-3">
        <div className={`text-xs font-medium px-2 py-1 rounded-lg ${isUpcoming ? 'text-blue-600 bg-blue-50' : 'text-orange-600 bg-orange-50'}`}>
          Spieltag {match.matchday}{isUpcoming ? ' · Verlegt?' : ''}
        </div>
        <div className="text-xs text-gray-500">{dateStr}</div>
      </div>

      <div className="flex items-center gap-3 mb-3">
        <div className="flex-1 text-right text-sm font-semibold text-gray-900">
          {match.home_team?.short_name ?? match.home_team?.name ?? '?'}
        </div>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min="0"
            max="20"
            value={score.home}
            onChange={(e) => onChange('home', e.target.value)}
            className="w-12 text-center py-2 border border-gray-200 rounded-lg text-sm font-bold focus:outline-none focus:ring-2 focus:ring-red-500"
            placeholder="0"
          />
          <span className="text-gray-400 font-bold">:</span>
          <input
            type="number"
            min="0"
            max="20"
            value={score.away}
            onChange={(e) => onChange('away', e.target.value)}
            className="w-12 text-center py-2 border border-gray-200 rounded-lg text-sm font-bold focus:outline-none focus:ring-2 focus:ring-red-500"
            placeholder="0"
          />
        </div>
        <div className="flex-1 text-left text-sm font-semibold text-gray-900">
          {match.away_team?.short_name ?? match.away_team?.name ?? '?'}
        </div>
      </div>

      <button
        onClick={onSettle}
        disabled={loading || score.home === '' || score.away === ''}
        className="w-full py-2 bg-red-700 hover:bg-red-800 disabled:bg-red-300 text-white font-semibold rounded-lg transition-colors text-sm flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <span className="animate-spin w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full" />
            Abrechnen...
          </>
        ) : (
          'Ergebnis eintragen & abrechnen'
        )}
      </button>
    </div>
  )
}

function MatchRow({ match }: { match: MatchRow }) {
  const matchDate = new Date(match.match_date)
  const dateStr = matchDate.toLocaleDateString('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  })
  const timeStr = matchDate.toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div
      className={`bg-white rounded-xl border shadow-sm px-4 py-3 flex items-center gap-3 ${
        match.status === 'finished' ? 'border-gray-100 opacity-70' : 'border-gray-100'
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">ST {match.matchday}</span>
          <span className="text-xs text-gray-300">·</span>
          <span className="text-xs text-gray-400">
            {dateStr} {timeStr}
          </span>
        </div>
        <div className="text-sm font-semibold text-gray-900 mt-0.5">
          {match.home_team?.short_name ?? '?'} –{' '}
          {match.away_team?.short_name ?? '?'}
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        {match.status === 'finished' && match.home_score !== null ? (
          <span className="inline-block bg-gray-800 text-white text-xs font-bold px-2.5 py-1 rounded-lg">
            {match.home_score}:{match.away_score}
          </span>
        ) : (
          <span className="inline-block bg-blue-50 text-blue-700 text-xs font-semibold px-2.5 py-1 rounded-lg">
            Geplant
          </span>
        )}
      </div>
    </div>
  )
}
