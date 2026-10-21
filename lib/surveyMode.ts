// Server-only resolution of the V2 survey's effective visibility/gating
// mode. Deliberately NOT in lib/survey.ts (imported by the 'use client'
// umfrage/page.tsx — `process.env.VERCEL_ENV` is a server-only variable and
// must never end up referenced from client-bundled code).
//
// `main` (production) and `integration` (preview) read from the exact SAME
// Supabase database (see CLAUDE.md "Branch- und Deployment-Strategie"), so
// a SINGLE shared app_settings key could never let an admin test V2 on an
// `integration` preview without that same flip simultaneously making it
// reachable (and, worse, POST-able) on production — and the reverse: a
// deliberate production release would need its own key anyway to not be at
// the mercy of whatever preview testing last left behind. Two entirely
// separate keys, one per environment, make both directions impossible by
// construction rather than by a one-way "force hidden on production" guard:
//   - SURVEY_MODE_KEY_PRODUCTION ('survey_mode_v2')          — main only
//   - SURVEY_MODE_KEY_PREVIEW    ('survey_mode_v2_preview')  — everything else
// Neither key has a row yet, so every reader's fallback to 'hidden' applies
// on BOTH environments until someone deliberately sets the ONE key that
// actually governs where they are — do not pre-set either as part of any
// code change.
export const SURVEY_MODE_KEY_PRODUCTION = 'survey_mode_v2'
export const SURVEY_MODE_KEY_PREVIEW = 'survey_mode_v2_preview'

export type SurveyVisibilityMode = 'hidden' | 'help_only' | 'prominent'

/**
 * The app_settings key that governs V2's visibility in the CURRENT runtime
 * environment. Every reader AND the admin toggle's writer must resolve the
 * key through this one function — never hardcode either key name elsewhere,
 * or the two can drift apart from what's actually being enforced.
 */
export function currentSurveyModeKey(): string {
  return process.env.VERCEL_ENV === 'production' ? SURVEY_MODE_KEY_PRODUCTION : SURVEY_MODE_KEY_PREVIEW
}

/**
 * Normalizes a raw app_settings value (already looked up via
 * currentSurveyModeKey()) to one of the 3 known modes — missing, null, or
 * any unrecognized value fails closed to 'hidden', never open.
 */
export function resolveSurveyMode(rawValue: string | null | undefined): SurveyVisibilityMode {
  if (rawValue === 'help_only' || rawValue === 'prominent') return rawValue
  return 'hidden'
}

// Same reasoning, one layer down: `main` and `integration` sharing one
// Supabase database means a single `survey_version` would let a Preview
// test write into (and a Preview reset delete) the exact same rows
// Production reads — the visibility gate above stops a PREVIEW USER from
// ever reaching the wizard, but says nothing about two DIFFERENT
// environments' ADMINS/requests writing to the same `survey_responses` rows.
// Two entirely separate version strings close that off by construction:
//   - SURVEY_VERSION_PRODUCTION ('winter_2026_v2')          — main only
//   - SURVEY_VERSION_PREVIEW    ('winter_2026_v2_preview')  — everything else
// Neither has any row yet (confirmed against the live database before this
// change) — nothing to migrate, overwrite, or lose. V1 ('winter_2026_v1',
// lib/survey.ts#SURVEY_VERSION_V1) is a third, completely separate version
// string and is never touched by anything here.
export const SURVEY_VERSION_PRODUCTION = 'winter_2026_v2'
export const SURVEY_VERSION_PREVIEW = 'winter_2026_v2_preview'

/**
 * The `survey_responses.survey_version` value this environment reads and
 * writes. Every query touching `survey_responses` for V2 — the
 * participant API, the admin aggregate/participant list/CSV export,
 * single-response delete, bulk reset, and the Hilfe-page status — must
 * resolve the version through this one function, never a hardcoded string,
 * or two environments could end up reading/writing each other's rows.
 */
export function currentSurveyVersion(): string {
  return process.env.VERCEL_ENV === 'production' ? SURVEY_VERSION_PRODUCTION : SURVEY_VERSION_PREVIEW
}
