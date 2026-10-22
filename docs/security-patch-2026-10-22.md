# Security Update: 22. Oktober 2026

## Befund und kontrollierter Patch (isolierter Branch)

Im bisherigen Lockfile: Next.js 16.3.5 (kritische npm-Advisories),
sharp unter 0.35.5 und source-map-js bis 1.2.1 (high).
Die erste CI-Einrichtung verschickte unnötig mehrere Fehlmeldungen,
weil PR-Regressionschecks noch das ungepatchte Lockfile prüften und
der Sandbox-Job bei jeder Workflow-Dateiänderung auslöste.

Der Sandbox-Patch aktualisierte nach bestandenem **Runtime**-Audit:
- Next.js 16.4.2 und eslint-config-next 16.4.2 (abgestimmte Versionen)
- React/React DOM 19.3.1
- @supabase/supabase-js 2.118.0 / @supabase/ssr 0.12.7
- sharp 0.35.5; source-map-js 1.2.2

Paketversionen und vollständiges Lockfile stehen zur Überprüfung auf
`security/patch-2026-10-22`. Dieser Branch darf nicht automatisch nach
`integration` oder `main` übernommen werden.

## Noch offene Security-Auffälligkeit

`npm audit` einschließlich Entwicklungsabhängigkeiten meldet weiterhin
`braces` (via micromatch/fast-glob/@next/eslint-plugin-next).
Das vorgeschlagene `npm audit fix --force` würde ein inkompatibles
Downgrade von `eslint-config-next` erzwingen und ist **nicht erlaubt**.
Dieses Dev-Tool-Risiko gesondert prüfen, nicht stillschweigend als behoben melden.
Der Produktionsaudit `npm audit --omit=dev --audit-level=high` ist für
einen Merge **verpflichtend**.

## Freigabe

Vor jedem Merge: GitHub Actions TypeScript, ESLint, produktiver Next-Build
und Tests für Kombis, Stornierung/Annullierung, Risky, Badge, Historie;
zusätzlich funktionaler Preview-Test für Login, Wettplatzierung, Storno.
Falls ein Check rot ist: kein Merge in Production.
