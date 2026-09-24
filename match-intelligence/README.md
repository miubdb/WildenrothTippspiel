# Wildenroth Match Intelligence

Eigenständige Analyseplattform für Trainer und Verantwortliche der SpVgg Wildenroth:
Gegner-Scouting, Spieldaten, Aufstellungen, Video-/Szenenanalyse (Veo), Spieler- und
Mannschaftsbeobachtungen, Saisontrends, Trainer-Notizen, Trainingsvorschläge und
automatisch erzeugte Matchreports.

**Wichtigstes Architekturprinzip: Evidence First.** Die KI erfindet niemals Spielsituationen.
Jede Aussage unterscheidet zwischen `fact` (belegte Tatsache), `observation` (im Video
beobachtbar), `inference` (vorsichtige taktische Interpretation) und `hypothesis` (nicht
ausreichend belegt) — siehe `lib/evidence.ts` und `supabase/migrations/0004_evidence_scenes.sql`.
Standardauswertungen (Dashboard, Trends) verwenden ausschließlich `trainer_verified` /
`trainer_corrected` Szenen.

Dieses Projekt ist **eigenständig** von der bestehenden Wildenroth-Tippspiel-App (Repo-Root
eine Ebene höher) — eigene Datenbank, eigenes Deployment. Es liest optional read-only aus dem
Tippspiel-Projekt (`lib/providers/match-data/existing-tippspiel-provider.ts`), verändert dieses
aber nie.

## Tech-Stack

- Next.js 16 (App Router, Turbopack) — Next 16 benennt `middleware.ts` in `proxy.ts` um; siehe
  `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`
- React 19, TypeScript strict
- Tailwind CSS 4
- Supabase (Postgres, Auth, RLS) via `@supabase/ssr` / `@supabase/supabase-js`
- Zod für externe/AI-Daten
- Node's eingebauter Test-Runner (`node --experimental-strip-types --test`) — kein zusätzliches
  Test-Framework nötig

## Multi-Mannschaft von Anfang an

Jede Entität, die pro Mannschaft variiert, hängt an `squads`; jede Entität, die pro Verein
variiert, hängt an `organizations`. V1 seedet genau eine Organisation (SpVgg Wildenroth) und
eine Squad (1. Mannschaft) — nichts in der Architektur geht davon aus, dass das so bleibt.

## Rollen

- **Admin**: volle Verwaltung (Benutzer, Mannschaften, Datenquellen, Veo, Analysen, Reports)
- **Trainer**: sieht/bearbeitet Daten der zugeordneten Squad(s) — Notizen, Szenen-Review,
  Trainingsvorschläge, Reports
- **Viewer**: nur lesender Zugriff auf freigegebene Inhalte (Architektur vorbereitet)

RLS (`supabase/migrations/0007_rls.sql`) ist die eigentliche Sicherheitsgrenze, nicht nur die
API-Routen. Autorisierung kommt ausschließlich aus der `memberships`-Tabelle, nie aus
client-manipulierbaren `user_metadata`-Feldern.

## Setup (lokal)

Voraussetzungen: Node 20+, [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
npm install
cp .env.example .env.local   # dann NEXT_PUBLIC_SUPABASE_URL etc. ausfüllen

npm run supabase:start        # startet lokalen Supabase-Stack (Docker) inkl. Migrationen + Seed
# In der Ausgabe von `supabase start` stehen die lokale API URL und der anon key —
# in .env.local eintragen.

npm run dev                   # http://localhost:3000
```

Ohne lokalen Docker-Stack: ein Supabase-Cloud-Projekt anlegen, `supabase link` und
`supabase db push`, dann `.env.local` mit den Projekt-Keys füllen und `supabase/seed.sql`
manuell im SQL-Editor ausführen.

**Ersten Admin-Account anlegen**: unter `/login` gibt es kein öffentliches Sign-up (Admin legt
Benutzer an, spec-konform). Für lokale Entwicklung: Nutzer in der lokalen Supabase Studio UI
(`http://localhost:54323` → Authentication) anlegen, dann die auskommentierte
`insert into memberships (...)`-Zeile am Ende von `supabase/seed.sql` mit der echten User-ID
ausführen, um dich selbst zum Org-Admin zu machen.

## Kommandos

```bash
npm run dev         # Dev-Server (Turbopack)
npm run build       # Production-Build — vor jedem Merge ausführen
npm run typecheck   # tsc --noEmit (App + Tests)
npm run lint        # ESLint
npm test            # Anti-Halluzination- und Kernlogik-Tests (node:test)
```

## Provider-Architektur (austauschbar, kostenlos startklar)

- **`lib/providers/match-data/`** — `MatchDataProvider`: `ManualProvider` (immer verfügbar,
  CSV/JSON-Import-Ziel), `ExistingTippspielProvider` (read-only gegen die Tippspiel-Supabase-DB,
  optional), Platz für `BfvProvider`/`FupaProvider`.
- **`lib/providers/video/`** — `VideoSourceProvider`: `VeoProvider` (parst Veo-URLs/Share-Links,
  ohne private APIs oder Zugriffskontrollen zu umgehen), `ManualVideoProvider`,
  `ExternalVideoProvider`.
- **`lib/providers/ai/`** — `AIProvider`: `NoAIProvider` (Default, keine Kosten, volle manuelle
  Funktionalität), `LocalVisionProvider` (beliebiger OpenAI-kompatibler lokaler Endpunkt, z. B.
  Ollama/LM Studio — 0 € laufende Kosten), `AnthropicProvider` (optional, kostenpflichtig). Jede
  KI-Ausgabe wird gegen ein Zod-Schema validiert; eine ungültige Antwort wird verworfen, nie
  teilweise übernommen.

## Kostenprinzip

Kein vollständiges 90-Minuten-Video wird dauerhaft gespeichert — nur Referenzen auf die
Veo-Aufnahme + Zeitstempel, plus kleine abgeleitete Assets (Thumbnails, Frames). Die App
funktioniert vollständig ohne konfigurierten kostenpflichtigen AI-Provider.

## Projektstatus

Dieses Repository wird phasenweise aufgebaut (siehe Implementierungsreihenfolge der
Spezifikation). **Stand jetzt (Phase 1 abgeschlossen):**

- ✅ Projekt-Setup, Architektur, DB-Schema mit RLS, Auth, Grundlayout/Navigation
- 🚧 Mannschaften/Spieler/Spiele-Verwaltung, Import-Adapter (Phase 2)
- 🚧 Gegner-Scouting, Statistiken, Datenqualität (Phase 3)
- 🚧 Veo-Recording, Trainer-Notizen, Szenendatenbank, Review-UI (Phase 4)
- 🚧 Analysepipeline, AIProvider-Verkabelung, lokaler Video-Worker (Phase 5)
- 🚧 Saisontrends, Spieleranalyse, Trainingsvorschläge, PDF-Export (Phase 6)
- 🚧 Tests, Security-Review, Deployment-Feinschliff (Phase 7)

Seiten für noch nicht gebaute Kernfunktionen zeigen einen expliziten "noch nicht
implementiert"-Hinweis statt einer nicht funktionierenden Dummy-Oberfläche.

## Deployment (Vercel)

Das Projekt ist als eigenständiges Vercel-Projekt deploybar — Root Directory auf
`match-intelligence/` setzen, falls im selben Repo wie das Tippspiel-Projekt deployt wird.
Umgebungsvariablen aus `.env.example` in den Vercel-Projekteinstellungen setzen. Schwere
Videoverarbeitung läuft nie in einer normalen Web-Request (siehe `/worker`, Phase 5) — Vercel
Functions bleiben kurzlebig.

## `/worker` (geplant, Phase 5)

Optionaler lokaler Node/FFmpeg-Worker, den ein Admin bei Bedarf auf dem eigenen Rechner
ausführt, um Videoverarbeitung ressourcenschonend außerhalb von Vercel/Supabase zu erledigen.
Als "experimental integration" markiert — die Haupt-App bleibt ohne ihn voll funktionsfähig.
