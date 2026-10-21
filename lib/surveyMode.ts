// Server-only resolution of the V2 survey's effective visibility/gating
// mode. Deliberately NOT in lib/survey.ts (imported by the 'use client'
// umfrage/page.tsx — `process.env.VERCEL_ENV` is a server-only variable and
// must never end up referenced from client-bundled code).
import { SURVEY_MODE_SETTING_KEY } from './survey'

export { SURVEY_MODE_SETTING_KEY }

/**
 * Resolves the effective V2 survey mode from the raw `app_settings.survey_mode_v2`
 * value, additionally forcing 'hidden' on `main`'s Vercel Production
 * Deployment regardless of what is stored — `main` (production) and
 * `integration` (preview) read the exact SAME app_settings row from the
 * exact same shared database (see CLAUDE.md "Branch- und Deployment-
 * Strategie"). Without this, an admin flipping survey_mode_v2 to
 * 'help_only'/'prominent' to test V2 on an `integration` preview would, in
 * the same instant, also make it reachable — and POST-able — on production.
 * Mirrors the identical VERCEL_ENV guard already used for the survey
 * bulk-reset (app/api/admin/survey/route.ts#reset_all).
 *
 * Used by BOTH the GET (what the client is told, so the wizard doesn't even
 * render on production) and POST (the actual enforcement — never trust the
 * client's rendering decision alone) of app/api/survey/route.ts.
 */
export function effectiveSurveyMode(rawValue: string | null | undefined): 'hidden' | 'help_only' | 'prominent' {
  if (process.env.VERCEL_ENV === 'production') return 'hidden'
  if (rawValue === 'help_only' || rawValue === 'prominent') return rawValue
  return 'hidden'
}
