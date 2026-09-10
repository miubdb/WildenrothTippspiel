import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { SURVEY_VERSION, ALL_QUESTIONS, visibleQuestionsForAnswers } from '@/lib/survey'
import type { Answers } from '@/lib/survey'

// Formula-injection guard: a cell starting with =, +, -, or @ is executed as
// a formula by Excel/LibreOffice/Google Sheets when the file is opened — a
// free-text answer like "=HYPERLINK(...)" or "+cmd|...!A1" must never reach
// the file verbatim. Prefixing with a leading apostrophe is the standard
// mitigation (OWASP CSV Injection): every affected app treats a leading `'`
// as "force text" and never renders it as part of the visible value.
const FORMULA_TRIGGER_CHARS = ['=', '+', '-', '@']
function neutralizeFormula(v: string): string {
  return FORMULA_TRIGGER_CHARS.includes(v[0]) ? `'${v}` : v
}

function csvEscape(v: string): string {
  const safe = neutralizeFormula(v)
  if (/[",\n;]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`
  return safe
}

function answerToText(v: Answers[string]): string {
  if (v == null) return ''
  if (Array.isArray(v)) return v.join(' | ')
  return String(v)
}

// Admin-only CSV export: one row per respondent, one column per question
// (in schema order), flattened — a clean simple export rather than anything
// fancier per spec. Questions the respondent's jump logic skipped are left
// blank rather than mislabeled as "not answered" vs "skipped" — both render
// as an empty cell, which is the simplest reasonable flattening for a CSV.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 })

  const admin = createAdminClient()
  const [{ data: rows }, { data: profiles }] = await Promise.all([
    admin.from('survey_responses').select('user_id, answers, started_at, submitted_at, updated_at').eq('survey_version', SURVEY_VERSION),
    admin.from('profiles').select('id, username, display_name'),
  ])

  const profileMap = new Map((profiles ?? []).map((p) => [p.id as string, p]))

  const header = [
    'Nutzer', 'User-ID', 'Umfrageversion', 'Gestartet am', 'Abgegeben am', 'Zuletzt geändert',
    ...ALL_QUESTIONS.map((q) => q.text),
  ]

  const lines = [header.map(csvEscape).join(';')]

  for (const r of rows ?? []) {
    const p = profileMap.get(r.user_id as string)
    const answers = (r.answers ?? {}) as Answers
    const visibleIds = new Set(visibleQuestionsForAnswers(answers).map((q) => q.id))
    const cells = [
      p?.display_name || p?.username || 'Unbekannt',
      r.user_id as string,
      SURVEY_VERSION,
      r.started_at as string,
      (r.submitted_at as string | null) ?? '',
      r.updated_at as string,
      ...ALL_QUESTIONS.map((q) => (visibleIds.has(q.id) ? answerToText(answers[q.id]) : '')),
    ]
    lines.push(cells.map((c) => csvEscape(String(c))).join(';'))
  }

  const csv = '﻿' + lines.join('\n')

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="umfrage_${SURVEY_VERSION}.csv"`,
    },
  })
}
