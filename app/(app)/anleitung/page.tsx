import Link from 'next/link'
import { HelpAccordion } from '@/components/HelpAccordion'

export const revalidate = 86400

export default function AnleitungPage() {
  return (
    <div className="px-4 py-4 space-y-3">
      <div className="bg-red-700 text-white rounded-2xl px-5 py-4">
        <div className="text-red-200 text-xs font-medium uppercase tracking-wide">SpVgg Wildenroth</div>
        <div className="text-2xl font-black mt-0.5">So funktioniert&apos;s</div>
        <div className="text-red-200 text-sm mt-1">Tippe auf einen Abschnitt für Details</div>
      </div>

      {/* 1. Das Ziel */}
      <HelpAccordion title="Das Ziel" emoji="🏆" defaultOpen>
        <p>
          Du startest mit <strong>1.000 Wildis</strong> und versuchst, durch clevere Tipps
          möglichst viel daraus zu machen. Wer am Ende der Saison das höchste Guthaben hat, gewinnt.
        </p>
        <div className="mt-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg px-3 py-2 text-sm text-green-800 dark:text-green-300">
          💰 Ab Saisonstart gibt es jeden <strong>Montag um 12:00 Uhr</strong> automatisch <strong>10 Wildis</strong> Taschengeld — auch nach einer Pechsträhne geht es weiter.
        </div>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          Dein Profil zeigt <strong>Wettbilanz</strong> (was du durch Tipps gewonnen/verloren hast) getrennt vom
          Taschengeld — so siehst du klar, was tatsächlich von deinem Tipp-Geschick kommt.
        </p>
      </HelpAccordion>

      {/* 2. App installieren */}
      <HelpAccordion title="App installieren" emoji="📱" defaultOpen>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Installiere die App auf dem Home-Bildschirm, damit sie sich wie eine echte App anfühlt.
        </p>
        <div className="space-y-3 mt-2">
          <div className="border border-gray-100 dark:border-gray-700 rounded-xl p-3 space-y-1.5">
            <div className="font-semibold text-gray-700 dark:text-gray-200 text-xs">🍎 iPhone mit Safari</div>
            <ol className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5 list-decimal list-inside">
              <li>Webseite in <strong>Safari</strong> öffnen</li>
              <li>Auf das <strong>Teilen-Symbol</strong> tippen (Quadrat mit Pfeil nach oben — unten in der Mitte bzw. in der Adressleiste)</li>
              <li>Im Menü nach unten scrollen</li>
              <li>„Zum Home-Bildschirm" auswählen</li>
              <li>Namen eingeben und „Hinzufügen" tippen</li>
            </ol>
          </div>
          <div className="border border-gray-100 dark:border-gray-700 rounded-xl p-3 space-y-1.5">
            <div className="font-semibold text-gray-700 dark:text-gray-200 text-xs">🤖 Android mit Chrome</div>
            <ol className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5 list-decimal list-inside">
              <li>Webseite in <strong>Chrome</strong> öffnen</li>
              <li>Oben rechts auf das <strong>Drei-Punkte-Menü</strong> tippen</li>
              <li>„App installieren" bzw. „Zum Startbildschirm hinzufügen" auswählen</li>
              <li>Bestätigen</li>
            </ol>
          </div>
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-lg px-3 py-2 text-xs text-blue-700 dark:text-blue-300">
            💡 Aktiviere anschließend unter <strong>Profil</strong> die Benachrichtigungen, damit du wichtige Infos zum Spieltag nicht verpasst.
          </div>
        </div>
      </HelpAccordion>

      {/* 3. Wetten platzieren & stornieren */}
      <HelpAccordion title="Wetten platzieren & stornieren" emoji="⏰">
        <div className="space-y-1.5 text-sm">
          <Row label="Öffnet:" value="Individuell je Spieltag — Zeitpunkt siehst du in der App" />
          <Row label="Schluss:" value={<>Jedes Spiel einzeln zu seinem <strong>Anpfiff</strong></>} />
          <Row label="Kombi:" value="Nur solange alle enthaltenen Spiele noch nicht begonnen haben" />
          <Row label="Wettscheine:" value={<>Normal <strong>2</strong>, mit einer Quote über 20,00 bis zu <strong>3</strong> pro Spieltag</>} />
          <Row label="Einsatz:" value={<><strong>1 bis 250 Wildis</strong> pro Wettschein</>} />
          <Row label="Storno:" labelColor="text-blue-700 dark:text-blue-400" value="Bis zum Anpfiff möglich — der Einsatz wird sofort zurückgebucht" />
          <Row label="Inaktiv:" labelColor="text-orange-600" value={<>Keine einzige Wette an einem Spieltag → automatisch <strong>50 Wildis Strafe</strong></>} />
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
          Mehrere unterschiedliche Wettmärkte auf dasselbe Spiel sind erlaubt (z.B. Heimsieg + Ergebnis 2:1)
          — nur im exakt selben Markt geht nicht gleichzeitig ein widersprüchlicher Tipp.
        </p>
      </HelpAccordion>

      {/* 4. Risky-Wette */}
      <HelpAccordion title="Risky-Wette" emoji="🎲">
        <p>
          Normal kannst du pro Spieltag <strong>2 Wettscheine</strong> abgeben. Hat mindestens einer deiner
          Wettscheine eine <strong>Quote über 20,00</strong>, bekommst du einen dritten Platz dazu. Der
          Wettschein mit der <strong>höchsten Quote</strong> wird automatisch als Risky markiert — auch wenn
          mehrere deiner Wettscheine über 20,00 liegen.
        </p>
        <div className="mt-2 text-xs bg-gray-50 dark:bg-gray-700/40 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-gray-600 dark:text-gray-300">
          Beispiel: 2,00 / 3,00 / 25,00 → die 25,00 läuft als Risky, die anderen beiden ganz normal.
        </div>
        <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
          Eine Extra-Auszahlung gibt es dafür nicht — es bleibt immer Einsatz × Quote. Die Einstufung
          übernimmt die App automatisch.
        </p>
      </HelpAccordion>

      {/* 5. Kombiwetten */}
      <HelpAccordion title="Kombiwetten" emoji="🔗">
        <p>
          Mehrere Tipps aus verschiedenen Spielen ergeben zusammen eine Kombiwette — die Quoten werden
          multipliziert, das erhöht den möglichen Gewinn deutlich. Ein falscher Tipp lässt die gesamte
          Kombi verlieren. Aus demselben Spiel darf nur ein Tipp in eine Kombi.
        </p>
        <div className="mt-2 bg-gray-50 dark:bg-gray-700/40 rounded-xl px-4 py-3 text-sm">
          <div className="text-gray-600 dark:text-gray-300">Sieg Heimteam <span className="font-bold text-red-700 dark:text-red-400">@1,45</span> × Über 3,5 <span className="font-bold text-red-700 dark:text-red-400">@1,80</span></div>
          <div className="flex items-center justify-between mt-1 pt-1 border-t border-gray-200 dark:border-gray-600">
            <span className="text-gray-500 dark:text-gray-400">20 Wildis Einsatz →</span>
            <span className="font-bold text-green-600">52,20 Wildis Auszahlung</span>
          </div>
        </div>
      </HelpAccordion>

      {/* 6. Wettmärkte */}
      <HelpAccordion title="Wettmärkte" emoji="📋">
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
          Auszahlung = Einsatz × Quote. Beispiel: 20 Wildis × 2,50 = <strong>50 Wildis</strong>.
        </p>
        <MarketCard
          title="1X2 — Spielausgang"
          items={[
            { label: '1', desc: 'Heimsieg' },
            { label: 'X', desc: 'Unentschieden' },
            { label: '2', desc: 'Auswärtssieg' },
          ]}
        />
        <MarketCard
          title="Doppelte Chance"
          description="Zwei Ausgänge gleichzeitig — sicherer, aber niedrigere Quote."
          items={[
            { label: '1X', desc: 'Heimsieg oder Unentschieden' },
            { label: '12', desc: 'Kein Unentschieden' },
            { label: 'X2', desc: 'Unentschieden oder Auswärtssieg' },
          ]}
        />
        <MarketCard
          title="Über/Unter Tore"
          description="Wie viele Tore fallen insgesamt?"
          items={[
            { label: 'Ü/U 2,5', desc: 'Mind. 3 Tore (Über) oder max. 2 Tore (Unter)' },
            { label: 'Ü/U 3,5', desc: 'Mind. 4 Tore oder max. 3 Tore' },
            { label: 'Ü/U 5,5', desc: 'Mind. 6 Tore oder max. 5 Tore' },
          ]}
        />
        <MarketCard
          title="Beide Teams treffen"
          items={[
            { label: 'Ja', desc: 'Beide Mannschaften erzielen mind. 1 Tor' },
            { label: 'Nein', desc: 'Mindestens ein Team bleibt torlos' },
          ]}
        />
        <MarketCard
          title="Handicap"
          description="Einer Mannschaft wird für die Wette ein virtueller Vor- oder Nachteil gegeben."
          items={[
            { label: 'Heim –1,5', desc: 'Gewinnt nur, wenn Heim mit mind. 2 Toren Unterschied gewinnt' },
            { label: 'Gast +1,5', desc: 'Gewinnt, wenn der Gast gewinnt, unentschieden spielt oder mit höchstens 1 Tor verliert' },
            { label: 'Heim –2,5', desc: 'Gewinnt nur, wenn Heim mit mind. 3 Toren Unterschied gewinnt' },
            { label: 'Gast +2,5', desc: 'Gewinnt, wenn der Gast gewinnt, unentschieden spielt oder mit höchstens 2 Toren verliert' },
          ]}
        />
        <MarketCard
          title="Genaues Ergebnis"
          description="Tippe das exakte Endergebnis. Je unwahrscheinlicher, desto höher die Quote."
          items={[]}
        />
        <MarketCard
          title="Torschütze (nur Wildenroth-Spiele)"
          description="Wette auf einen Wildenroth-Spieler."
          items={[
            { label: 'Trifft', desc: 'Der Spieler erzielt mindestens 1 Tor' },
            { label: 'Mind. 2 Tore', desc: 'Der Spieler erzielt mindestens 2 Tore (nur bei ausgewählten Spielern)' },
          ]}
        />
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-2 space-y-1">
          <p>• Eigentore zählen nicht.</p>
          <p>• Fällt ein Spieler kurzfristig aus dem Kader, wird deine Wette (bzw. bei einer Kombi der gesamte Einsatz) automatisch storniert und zurückgebucht.</p>
        </div>
      </HelpAccordion>

      {/* 7. Tipps anderer Nutzer */}
      <HelpAccordion title="Tipps anderer Nutzer" emoji="🔒">
        <p>
          Vor dem Anpfiff siehst du in der Rangliste bereits, <strong>wie viele</strong> Wettscheine ein
          Teilnehmer für den Spieltag abgegeben hat — was er konkret getippt hat, bleibt geheim. Sobald
          das jeweilige Spiel angepfiffen ist (bei einer Kombi: sobald eines der enthaltenen Spiele
          angepfiffen ist), wird der Tipp sichtbar.
        </p>
      </HelpAccordion>

      {/* 8. Wildenroth-Spieler & Trainer */}
      <HelpAccordion title="Wildenroth-Spieler & Trainer" emoji="⚽">
        <p>
          Als Spieler, Trainer oder Torwarttrainer darfst du nicht gegen dein eigenes Team wetten:
        </p>
        <div className="mt-2 space-y-1 text-xs text-gray-600 dark:text-gray-300">
          <div className="bg-gray-50 dark:bg-gray-700/40 rounded px-2 py-1"><strong>1. Mannschaft:</strong> darf nicht gegen Wildenroth I wetten</div>
          <div className="bg-gray-50 dark:bg-gray-700/40 rounded px-2 py-1"><strong>2. Mannschaft:</strong> darf nicht gegen Wildenroth II wetten</div>
          <div className="bg-gray-50 dark:bg-gray-700/40 rounded px-2 py-1"><strong>Beide Mannschaften:</strong> darf gegen keine der beiden wetten</div>
          <div className="bg-gray-50 dark:bg-gray-700/40 rounded px-2 py-1"><strong>Fan:</strong> keine Einschränkung</div>
        </div>
      </HelpAccordion>

      {/* 9. Wildenroth II & B-Klasse-Topspiel */}
      <HelpAccordion title="Wildenroth II & B-Klasse-Topspiel" emoji="🥈">
        <p>
          Neben den Spielen der 1. Mannschaft (Kreisliga) kannst du pro Spieltag auch auf die Spiele der
          <strong> Wildenroth II</strong> tippen, sobald sie dem jeweiligen Spieltag zugeordnet sind, sowie
          auf ein ausgewähltes <strong>B-Klasse-Topspiel der Woche</strong>.
        </p>
      </HelpAccordion>

      {/* 10. Rangliste */}
      <HelpAccordion title="Rangliste" emoji="📊">
        <p>
          Ziel ist das höchste Guthaben am Saisonende. Solange eine Wette offen ist, verändert sie dein
          angezeigtes Guthaben in der Rangliste noch nicht — das siehst du erst nach der Auswertung, damit
          niemand vorher am Guthaben ablesen kann, wie hoch ein Einsatz war. Im Spieltag-Tab siehst du die
          Wettaktivität aller Teilnehmer: vor Anpfiff nur die Anzahl fremder Wettscheine, danach deren
          Tipps.
        </p>
        <div className="mt-2 space-y-1">
          <div className="text-xs text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-700/40 rounded px-2 py-1">
            🔥 <strong>Streak:</strong> mindestens 2 Spieltage in Folge mit positivem Saldo.
          </div>
          <div className="text-xs text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-700/40 rounded px-2 py-1">
            🏅 <strong>Spieltagsbester:</strong> bester Saldo an einem Spieltag — die Zahl zeigt, wie oft du das schon warst.
          </div>
        </div>
      </HelpAccordion>

      {/* 11. Verschobene Spiele */}
      <HelpAccordion title="Verschobene Spiele" emoji="🔁">
        <p>
          Wird ein Spiel verschoben, bleibt deine Wette grundsätzlich bestehen und kann bis zum
          tatsächlichen Anpfiff storniert werden. Den neuen Termin bzw. die Zuordnung siehst du
          automatisch in der App.
        </p>
      </HelpAccordion>

      {/* 12. Spieltags-Recap */}
      <HelpAccordion title="Spieltags-Recap" emoji="🎉">
        <p>
          Nach Abschluss eines Spieltags gibt es eine Übersicht: alle Ergebnisse, deine persönliche
          Spieltagsbilanz, Highlights und die Rangfolge dieses Spieltags — plus bis zu 7 Spaß-Pokale:
        </p>
        <div className="mt-1.5 grid grid-cols-1 gap-1">
          <AwardRow emoji="🏆" title="Spieltagskönig" desc="Bester Netto-Saldo des Spieltags" />
          <AwardRow emoji="🥚" title="Eier aus Stahl" desc="Höchste gewonnene Quote" />
          <AwardRow emoji="😭" title="Unlucky Bastard" desc="Kombiwette, bei der nur ein Tipp danebenlag" />
          <AwardRow emoji="🔮" title="Ergebnis-Orakel" desc="Exaktes Ergebnis richtig getippt" />
          <AwardRow emoji="🚽" title="Griff ins Klo" desc="Höchster verlorener Einsatz" />
          <AwardRow emoji="🧱" title="Betonmischer" desc="Gewonnener Tipp mit der niedrigsten Quote" />
          <AwardRow emoji="🔥" title="On Fire" desc="Die meisten gewonnenen Wettscheine (mind. 2)" />
        </div>
      </HelpAccordion>

      {/* Support — direct WhatsApp contact for bugs/questions not covered above */}
      <a
        href="https://wa.me/491632928105?text=Hallo!%20Ich%20habe%20eine%20Frage%20%2F%20einen%20Fehler%20zum%20Wildenroth%20Tippspiel%20gefunden%3A%20"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 bg-[#25D366]/10 hover:bg-[#25D366]/15 border border-[#25D366]/30 rounded-2xl px-4 py-3 transition-colors"
      >
        <span className="w-9 h-9 rounded-full bg-[#25D366] flex items-center justify-center flex-shrink-0">
          <WhatsAppIcon className="w-5 h-5 text-white" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-gray-900 dark:text-gray-100">Fehler gefunden oder Fragen?</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Schreib uns direkt per WhatsApp</div>
        </div>
        <svg className="w-4 h-4 text-gray-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 5l7 7-7 7" />
        </svg>
      </a>

      <div className="pb-4 text-center text-xs text-gray-400 dark:text-gray-500">
        SpVgg Wildenroth Tippspiel · Saison 26/27<br />
        Nur mit Spielgeld — keine echten Einsätze<br />
        <Link href="/impressum" className="hover:underline">Impressum</Link>
        {' · '}
        <Link href="/datenschutz" className="hover:underline">Datenschutz</Link>
      </div>
    </div>
  )
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.29-1.39a9.9 9.9 0 004.75 1.21h.01c5.46 0 9.9-4.45 9.9-9.91C21.96 6.45 17.5 2 12.04 2zm0 18.11h-.01a8.2 8.2 0 01-4.19-1.15l-.3-.18-3.14.82.84-3.06-.2-.32a8.18 8.18 0 01-1.26-4.4c0-4.54 3.7-8.24 8.26-8.24 2.2 0 4.27.86 5.83 2.42a8.18 8.18 0 012.42 5.82c0 4.54-3.7 8.24-8.25 8.24zm4.52-6.18c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.17.25-.64.81-.78.97-.14.17-.29.19-.54.06-.25-.12-1.04-.38-1.98-1.22-.73-.65-1.23-1.46-1.37-1.7-.14-.25-.02-.38.11-.5.11-.11.25-.29.37-.43.12-.15.16-.25.25-.42.08-.17.04-.31-.02-.43-.06-.13-.56-1.36-.77-1.86-.2-.49-.41-.42-.56-.43-.14-.01-.31-.01-.48-.01a.92.92 0 00-.67.31c-.23.25-.87.86-.87 2.09 0 1.23.9 2.42 1.02 2.59.12.17 1.76 2.7 4.27 3.78.6.26 1.06.41 1.43.53.6.19 1.14.16 1.57.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.08.14-1.18-.06-.11-.23-.17-.48-.29z" />
    </svg>
  )
}

function Row({ label, value, labelColor }: { label: string; value: React.ReactNode; labelColor?: string }) {
  return (
    <div className="flex gap-2">
      <span className={`font-bold flex-shrink-0 ${labelColor ?? 'text-red-700 dark:text-red-400'} ${label ? '' : 'invisible'}`}>
        {label || 'Schluss:'}
      </span>
      <span className="text-gray-600 dark:text-gray-300">{value}</span>
    </div>
  )
}

function AwardRow({ emoji, title, desc }: { emoji: string; title: string; desc: string }) {
  return (
    <div className="flex gap-2 items-start text-xs">
      <span className="flex-shrink-0">{emoji}</span>
      <div>
        <span className="font-semibold text-gray-700 dark:text-gray-200">{title}</span>
        <span className="text-gray-500 dark:text-gray-400"> — {desc}</span>
      </div>
    </div>
  )
}

function MarketCard({
  title, description, items,
}: {
  title: string
  description?: string
  items: { label: string; desc: string }[]
}) {
  return (
    <div className="border border-gray-100 dark:border-gray-700 rounded-xl p-3 space-y-1.5">
      <div className="font-semibold text-gray-800 dark:text-gray-200 text-sm">{title}</div>
      {description && <p className="text-xs text-gray-500 dark:text-gray-400">{description}</p>}
      {items.length > 0 && (
        <div className="space-y-1">
          {items.map((item) => (
            <div key={item.label} className="flex gap-2 text-xs">
              <span className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 font-bold px-1.5 py-0.5 rounded flex-shrink-0">{item.label}</span>
              <span className="text-gray-600 dark:text-gray-300">{item.desc}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
