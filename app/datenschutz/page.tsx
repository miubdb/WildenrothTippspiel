import Link from 'next/link'

export const metadata = {
  title: 'Datenschutzerklärung – Wildenroth Tippspiel',
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="font-bold text-gray-900 dark:text-gray-100 mt-5 mb-1">{children}</h2>
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="font-semibold text-gray-800 dark:text-gray-200 mt-3 mb-1 text-[13px]">{children}</h3>
}

export default function DatenschutzPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="bg-gradient-to-r from-red-700 to-red-800 text-white safe-top">
        <div className="max-w-lg mx-auto px-4 py-4 flex items-center gap-3">
          <Link href="/" className="text-white/80 hover:text-white text-sm">← Zurück</Link>
          <h1 className="text-lg font-bold">Datenschutzerklärung</h1>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-1 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
        <p className="text-xs text-gray-400 dark:text-gray-500">Stand: August 2026</p>

        <H2>1. Verantwortlicher</H2>
        <p>
          Verantwortlicher im Sinne der Datenschutz-Grundverordnung (DSGVO) ist:<br />
          Michael Jani, Mauerner Str. 6a, 82284 Grafrath, Deutschland<br />
          E-Mail: <a href="mailto:michaeljani98@gmail.com" className="text-red-700 dark:text-red-400 hover:underline">michaeljani98@gmail.com</a>
        </p>
        <p>
          Ein Datenschutzbeauftragter ist für dieses private, kleine Projekt nicht zu bestellen (keine
          Pflicht nach Art. 37 DSGVO / § 38 BDSG).
        </p>

        <H2>2. Überblick: welche Daten und warum</H2>
        <p>
          Das Wildenroth Tippspiel ist ein privates, nicht-kommerzielles Tippspiel mit virtueller
          Spielwährung („Wildis") für Mitglieder und Freunde der SpVgg Wildenroth. Um mitspielen zu
          können, ist ein Nutzerkonto erforderlich. Dabei fallen personenbezogene Daten an, die im
          Folgenden erklärt werden.
        </p>

        <H2>3. Registrierung und Nutzerkonto</H2>
        <p>
          Bei der Registrierung erhebe ich: E-Mail-Adresse, Passwort (verschlüsselt gespeichert, für mich
          zu keinem Zeitpunkt im Klartext einsehbar), gewählten Anzeigenamen sowie optional Profilbild,
          Motto/Bio und Lieblingsverein. Zusätzlich wird angegeben, ob du Spieler/Trainer der 1. oder 2.
          Mannschaft, beider Mannschaften oder Fan bist — das steuert ausschließlich, gegen welche
          Mannschaft du aus Fairness-Gründen nicht wetten darfst.
        </p>
        <p className="mt-1.5">
          <strong>Zweck:</strong> Erstellung und Verwaltung deines Nutzerkontos, Anmeldung, Teilnahme am
          Tippspiel.<br />
          <strong>Rechtsgrundlage:</strong> Art. 6 Abs. 1 lit. b DSGVO (Erfüllung des
          Nutzungsverhältnisses, das mit deiner Registrierung zustande kommt).<br />
          <strong>Pflichtangabe:</strong> E-Mail, Passwort und Anzeigename sind zur Teilnahme erforderlich;
          ohne sie ist keine Registrierung möglich. Profilbild, Motto und Lieblingsverein sind freiwillig.
        </p>

        <H2>4. Tipp- und Wettdaten</H2>
        <p>
          Deine abgegebenen Tipps (Spiel, Markt, Auswahl, Quote, Einsatz in Wildis), dein virtuelles
          Guthaben sowie Gewinne/Verluste werden deinem Konto zugeordnet gespeichert, um das Tippspiel,
          die Rangliste und die Spieltags-Abrechnung durchzuführen. Eigene Tipps sind für dich jederzeit
          einsehbar; Tipps anderer Teilnehmer werden dir gegenüber erst nach Anpfiff des jeweiligen Spiels
          sichtbar. <strong>Rechtsgrundlage:</strong> Art. 6 Abs. 1 lit. b DSGVO.
        </p>

        <H2>5. Push-Benachrichtigungen</H2>
        <p>
          Wenn du Push-Benachrichtigungen aktivierst, wird ein Geräte-/Browser-spezifischer
          Push-Endpunkt gespeichert, um dir Mitteilungen (z.B. Spieltag geöffnet, Wett-Auswertung,
          Spieltags-Recap) zusenden zu können. Die Zustellung läuft technisch über die Push-Dienste deines
          Browser-/Geräteherstellers (z.B. Google Firebase Cloud Messaging, Apple Push Notification
          Service, Mozilla Push Service) — diese sind für die Funktion notwendig und nicht durch mich
          wählbar. <strong>Rechtsgrundlage:</strong> Art. 6 Abs. 1 lit. a DSGVO (Einwilligung). Du kannst
          die Einwilligung jederzeit über die Benachrichtigungs-Einstellungen deines Geräts bzw. in deinem
          Profil widerrufen; die Zustellung endet dann.
        </p>

        <H2>6. Cookies und lokale Speicherung</H2>
        <p>
          Diese App verwendet ausschließlich technisch notwendige Cookies zur Anmeldung/Sitzungsverwaltung
          (gesetzt durch Supabase Auth, siehe unten) sowie eine lokale Speicherung deiner
          Dunkelmodus-Einstellung auf deinem Gerät. Es werden keine Analyse-, Tracking- oder
          Werbe-Cookies eingesetzt. <strong>Rechtsgrundlage:</strong> Art. 6 Abs. 1 lit. f DSGVO bzw. § 25
          Abs. 2 Nr. 2 TDDDG (technisch notwendig für den von dir ausdrücklich gewünschten Dienst) — eine
          Einwilligung ist hierfür nicht erforderlich.
        </p>

        <H2>7. Eingesetzte Dienstleister (Auftragsverarbeiter)</H2>
        <p>Für Betrieb und Hosting nutze ich folgende Dienstleister, mit denen jeweils die
          Standard-Auftragsverarbeitungsvereinbarungen der Anbieter gemäß Art. 28 DSGVO gelten:</p>

        <H3>Supabase (Datenbank, Authentifizierung, Datei-Speicher)</H3>
        <p>
          Supabase, Inc. Die Datenbank dieses Projekts liegt physisch in Frankfurt am Main
          (Region eu-central-1, EU). Supabase, Inc. selbst hat seinen Sitz in den USA; für den damit
          verbundenen Datentransfer gelten die Standardvertragsklauseln der EU-Kommission.
        </p>

        <H3>Vercel (Hosting der Web-App)</H3>
        <p>
          Vercel Inc., USA. Beim Aufruf der App werden technisch notwendige Server-Logs (u.a.
          IP-Adresse, Zeitpunkt, aufgerufene Seite) kurzzeitig zur Bereitstellung und Absicherung des
          Angebots verarbeitet. <strong>Rechtsgrundlage:</strong> Art. 6 Abs. 1 lit. f DSGVO (berechtigtes
          Interesse am sicheren und funktionsfähigen Betrieb). Für den Datentransfer in die USA gelten die
          Standardvertragsklauseln der EU-Kommission bzw. das EU-US Data Privacy Framework, soweit
          anwendbar.
        </p>

        <H2>8. Weitergabe an andere Mitspieler</H2>
        <p>
          Dein gewählter Anzeigename, dein Profilbild (falls gesetzt) sowie – nach Anpfiff des jeweiligen
          Spiels – deine Tipps und dein Abschneiden in der Rangliste sind für andere angemeldete
          Teilnehmer sichtbar. Das ist Kernfunktion eines gemeinsamen Tippspiels. Deine E-Mail-Adresse
          und dein Passwort werden niemals an andere Teilnehmer weitergegeben oder für sie sichtbar
          gemacht.
        </p>

        <H2>9. Speicherdauer</H2>
        <p>
          Deine Kontodaten und Tippspiel-Historie werden gespeichert, solange dein Nutzerkonto besteht.
          Auf Wunsch lösche ich dein Konto und die zugehörigen Daten vollständig (siehe Kontakt oben bzw.
          den Support-Button in der App).
        </p>

        <H2>10. Deine Rechte</H2>
        <p>Du hast jederzeit das Recht auf:</p>
        <ul className="list-disc list-inside space-y-0.5 mt-1">
          <li>Auskunft über die zu dir gespeicherten Daten (Art. 15 DSGVO)</li>
          <li>Berichtigung unrichtiger Daten (Art. 16 DSGVO) — vieles kannst du direkt in deinem Profil selbst ändern</li>
          <li>Löschung deiner Daten (Art. 17 DSGVO)</li>
          <li>Einschränkung der Verarbeitung (Art. 18 DSGVO)</li>
          <li>Datenübertragbarkeit (Art. 20 DSGVO)</li>
          <li>Widerspruch gegen die Verarbeitung (Art. 21 DSGVO)</li>
          <li>Widerruf einer erteilten Einwilligung mit Wirkung für die Zukunft (Art. 7 Abs. 3 DSGVO), z.B. für Push-Benachrichtigungen</li>
          <li>Beschwerde bei einer Datenschutz-Aufsichtsbehörde (Art. 77 DSGVO), z.B. beim Bayerischen Landesamt für Datenschutzaufsicht</li>
        </ul>
        <p className="mt-1.5">
          Wende dich für alle diese Anliegen einfach an die oben genannte E-Mail-Adresse oder über den
          Support-Button in der App.
        </p>

        <H2>11. Automatisierte Entscheidungsfindung</H2>
        <p>
          Eine automatisierte Entscheidungsfindung einschließlich Profiling im Sinne von Art. 22 DSGVO
          findet nicht statt. Die im Tippspiel angezeigten Quoten sind ein Spielmechanismus (Modell auf
          Basis realer Spielergebnisse) und keine automatisierte Entscheidung über dich.
        </p>

        <H2>12. Minderjährige</H2>
        <p>
          Das Angebot richtet sich an Mitglieder und Freunde der SpVgg Wildenroth, worunter auch
          Jugendliche sein können. Es werden zu keinem Zeitpunkt echtes Geld oder reale Einsätze
          verarbeitet. Nutzer unter 16 Jahren sollten die Registrierung nur mit Kenntnis eines
          Erziehungsberechtigten vornehmen.
        </p>

        <H2>13. Änderungen dieser Erklärung</H2>
        <p>
          Diese Datenschutzerklärung kann bei Bedarf angepasst werden, z.B. bei Änderungen der App oder
          eingesetzter Dienstleister. Es gilt jeweils die aktuell auf dieser Seite abrufbare Fassung.
        </p>

        <p className="text-xs text-gray-400 dark:text-gray-500 pt-3">
          Siehe auch: <Link href="/impressum" className="text-red-700 dark:text-red-400 hover:underline">Impressum</Link>
        </p>
      </div>
    </div>
  )
}
