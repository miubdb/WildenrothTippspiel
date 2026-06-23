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

      {/* Das Wichtigste — offen */}
      <HelpAccordion title="Das Ziel" emoji="🏆" defaultOpen>
        <p>
          Du startest mit <strong>1.000 Wildis</strong> und versuchst, durch clevere Tipps
          möglichst viel daraus zu machen. Wer am Ende der Saison das höchste Guthaben hat, gewinnt.
        </p>
        <div className="mt-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg px-3 py-2 text-sm text-green-800 dark:text-green-300">
          💰 Jeden <strong>Montag um 12:00 Uhr</strong> gibt es automatisch <strong>10 Wildis</strong> — auch nach einer Pechsträhne geht es weiter.
        </div>
      </HelpAccordion>

      {/* App installieren — offen, neue User brauchen das zuerst */}
      <HelpAccordion title="App installieren" emoji="📱" defaultOpen>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Installiere die App auf dem Home-Bildschirm, damit du Push-Benachrichtigungen erhalten kannst und sie sich wie eine echte App anfühlt.
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
            <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
              Hinweis: Push-Benachrichtigungen funktionieren auf dem iPhone <strong>nur</strong>, wenn die App über Safari zum Home-Bildschirm hinzugefügt wurde.
            </div>
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
            💡 Aktiviere danach unter <strong>Profil</strong> die Benachrichtigungen, damit du Reminder, Ergebnisse und den Spieltags-Recap nicht verpasst.
          </div>
        </div>
      </HelpAccordion>

      {/* Push-Benachrichtigungen — NEU */}
      <HelpAccordion title="Benachrichtigungen" emoji="🔔">
        <p>
          Wenn du Push-Benachrichtigungen aktiviert hast (unter <strong>Profil</strong>), bekommst du automatisch Bescheid:
        </p>
        <div className="mt-2 space-y-2">
          <NotifItem emoji="🏟️" title="Spieltag offen" desc="Sobald ein neuer Spieltag wettbar ist (Montag 12:00 Uhr)." />
          <NotifItem emoji="👀" title="Tipp-Erinnerung" desc="Ca. 2,5 Stunden vor dem ersten Spiel, falls du noch nicht alle Wettscheine genutzt hast." />
          <NotifItem emoji="🎉" title="Wette gewonnen" desc="Direkt nach der Abrechnung — mit einem Tipp auf die Benachrichtigung springst du zur gewonnenen Wette." />
          <NotifItem emoji="😬" title="Wette verloren" desc="Auch das erfährst du sofort, fair ist fair." />
          <NotifItem emoji="📊" title="Spieltags-Recap" desc="Wenn alle Spiele eines Spieltags abgerechnet sind." />
        </div>
      </HelpAccordion>

      {/* Spieltags-Recap — NEU */}
      <HelpAccordion title="Spieltags-Recap" emoji="📊">
        <p>
          Nach jedem abgeschlossenen Spieltag gibt es eine Übersicht: alle Ergebnisse, dein persönlicher
          Spieltags-Gewinn oder -Verlust und die Rangliste, wer an diesem Spieltag am meisten herausgeholt hat.
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Du erreichst den Recap über die Push-Benachrichtigung oder direkt in der App.
        </p>
      </HelpAccordion>

      {/* Wetten platzieren & stornieren */}
      <HelpAccordion title="Wetten platzieren & stornieren" emoji="⏰">
        <div className="mb-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg px-3 py-2 text-xs text-blue-800 dark:text-blue-300">
          Das Wettfenster öffnet <strong>montags um 12:00 Uhr</strong>. Jedes Spiel schließt einzeln bei seinem Anpfiff — andere Spiele des Spieltags bleiben weiterhin tippbar.
        </div>
        <div className="space-y-1.5 text-sm">
          <Row label="Öffnet:" value="Montag 12:00 Uhr der Spielwoche" />
          <Row label="Schluss:" value={<><strong>Einzelwetten:</strong> bis zum Anpfiff des jeweiligen Spiels</>} />
          <Row label="" value={<><strong>Kombiwetten:</strong> nur wenn alle enthaltenen Spiele noch nicht begonnen haben</>} />
          <Row label="Wettscheine:" value={<>Maximal <strong>3 Wettscheine</strong> pro Spieltag (2 normale + 1 Risky)</>} />
          <Row label="Einsatz:" value={<>Maximal <strong>250 Wildis pro Wettschein</strong></>} />
          <Row label="Inaktiv:" labelColor="text-orange-600" value={<>Wer in einem Spieltag <strong>keine einzige Wette</strong> platziert, zahlt automatisch <strong>100 Wildis Strafe</strong> — wird nach Spieltagsabrechnung abgezogen</>} />
          <Row label="Storno:" labelColor="text-blue-700 dark:text-blue-400" value="Einzelwette: bis zum Anpfiff des Spiels. Kombiwette: bis der erste enthaltene Anpfiff beginnt. Der Einsatz wird sofort zurückgebucht." />
        </div>
      </HelpAccordion>

      {/* Risky Wette — geschärft */}
      <HelpAccordion title="Risky Wette" emoji="🎲">
        <p>
          Neben den 2 normalen Wettscheinen hast du <strong>einen zusätzlichen Risky-Slot</strong> pro Spieltag.
          Diesen darfst du nur mit einem Wettschein belegen, dessen <strong>Quote mindestens 20,00</strong> beträgt
          (Einzel- oder Kombiwette). So kannst du einen dritten, mutigen Tipp setzen.
        </p>
        <div className="mt-2 text-xs bg-gray-50 dark:bg-gray-700/40 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-gray-600 dark:text-gray-300">
          Beispiel: Du hast 2 normale Wettscheine genutzt und legst zusätzlich eine Kombiwette mit Quote 23,50 — diese läuft als Risky und füllt deinen 3. Slot.
        </div>
        <div className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
          Ein Bonus auf die Quote gibt es nicht — die Auszahlung ist wie immer Einsatz × Quote. Der Risky-Slot ist einfach dein dritter Wettschein für die hohen Quoten.
        </div>
      </HelpAccordion>

      {/* Kombiwetten */}
      <HelpAccordion title="Kombiwetten" emoji="🔗">
        <p>
          Wenn du mehrere Tipps aus verschiedenen Spielen zusammenstellst, entsteht automatisch eine Kombiwette.
          Die Quoten werden miteinander multipliziert — das erhöht den möglichen Gewinn erheblich.
        </p>
        <div className="mt-2 bg-gray-50 dark:bg-gray-700/40 rounded-xl px-4 py-3 text-sm">
          <div className="text-gray-600 dark:text-gray-300">Sieg Heimteam <span className="font-bold text-red-700 dark:text-red-400">@1,45</span> × Über 3,5 <span className="font-bold text-red-700 dark:text-red-400">@1,80</span></div>
          <div className="flex items-center justify-between mt-1 pt-1 border-t border-gray-200 dark:border-gray-600">
            <span className="text-gray-500 dark:text-gray-400">20 Wildis Einsatz →</span>
            <span className="font-bold text-green-600">52,20 Wildis Auszahlung</span>
          </div>
        </div>
        <div className="mt-2 space-y-1">
          <div className="text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 rounded px-2 py-1">
            ⚠️ Ein falscher Tipp macht die gesamte Kombiwette verloren.
          </div>
          <div className="text-xs text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-900/20 rounded px-2 py-1">
            🚫 Aus demselben Spiel darf nur ein Tipp in eine Kombiwette — z.B. nicht gleichzeitig Auswärtssieg und Doppelte Chance X2.
          </div>
        </div>
      </HelpAccordion>

      {/* Quoten */}
      <HelpAccordion title="Quoten" emoji="📈">
        <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Gewinn = Einsatz × Quote</p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Beispiel: 20 Wildis × 2,50 = <strong>50 Wildis Auszahlung</strong></p>
        <div className="mt-2 space-y-1.5">
          <QuoteExample odds={1.20} explanation="Klarer Favorit" />
          <QuoteExample odds={2.50} explanation="Ausgeglichenes Duell" />
          <QuoteExample odds={6.00} explanation="Außenseiter" />
          <QuoteExample odds={20.00} explanation="Sehr unwahrscheinlich" />
        </div>
      </HelpAccordion>

      {/* Wettmärkte */}
      <HelpAccordion title="Wettmärkte" emoji="📋">
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
            { label: 'Ü/U 3,5', desc: 'Mind. 4 Tore (Über) oder max. 3 Tore (Unter)' },
            { label: 'Ü/U 5,5', desc: 'Mind. 6 Tore oder max. 5 Tore' },
            { label: 'Ü/U 7,5', desc: 'Mind. 8 Tore oder max. 7 Tore' },
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
          description="Das Ergebnis wird um eine Vorgabe verschoben. Praktisch erklärt:"
          items={[
            { label: 'Heim –1,5', desc: 'Heim muss mit mind. 2 Toren gewinnen' },
            { label: 'Gast +1,5', desc: 'Gast darf nicht mit 2 oder mehr Toren verlieren' },
            { label: 'Heim –2,5', desc: 'Heim muss mit mind. 3 Toren gewinnen' },
            { label: 'Gast +2,5', desc: 'Gast darf nicht mit 3 oder mehr Toren verlieren' },
          ]}
        />
        <MarketCard
          title="Genaues Ergebnis"
          description="Tippe das exakte Endergebnis. Je unwahrscheinlicher, desto höher die Quote. Sehr unwahrscheinliche Ergebnisse werden ausgeblendet."
          items={[]}
        />
        <MarketCard
          title="Torschützen (nur Wildenroth-Spiele)"
          description="Wette auf einen Wildenroth-Spieler — gibt es nur bei Wildenroth-Spielen."
          items={[
            { label: 'Trifft', desc: 'Der Spieler erzielt mindestens 1 Tor' },
            { label: 'Mind. 2 Tore', desc: 'Der Spieler erzielt mindestens 2 Tore (nur bei ausgewählten Spielern)' },
          ]}
        />
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-2 space-y-1">
          <p>• Eigentore zählen nicht.</p>
          <p>• Sollte ein Spieler kurzfristig aus dem Kader fallen, wird deine Wette automatisch storniert und der Einsatz zurückgebucht. Bei einer Kombi mit dem betroffenen Tipp wird der gesamte Kombi-Einsatz erstattet.</p>
        </div>
      </HelpAccordion>

      {/* Wildenroth-Spieler & Trainer */}
      <HelpAccordion title="Wildenroth-Spieler & Trainer" emoji="⚽">
        <p>
          Als aktiver Spieler oder Trainer der SpVgg Wildenroth darfst du bei Wildenroth-Spielen
          <strong> nicht gegen Wildenroth wetten</strong>.
        </p>
        <div className="mt-2 space-y-1">
          <div className="text-xs text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/20 rounded px-2 py-1">
            ✅ Erlaubt: Wildenroth-Sieg (1X2), genaues Ergebnis mit Wildenroth-Sieg,
            neutrale Tormärkte (Über/Unter, Beide treffen)
          </div>
          <div className="text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 rounded px-2 py-1">
            🚫 Gesperrt: Wildenroth-Niederlage, Unentschieden, alle Doppelte-Chance-Picks gegen Wildenroth,
            genaue Ergebnisse mit Unentschieden oder Wildenroth-Niederlage
          </div>
        </div>
      </HelpAccordion>

      {/* Saisonstart & Einstieg */}
      <HelpAccordion title="Saisonstart & Einstieg" emoji="📅">
        <p>
          Die reguläre Teilnahme an der Saisonwertung ist nur vor Saisonstart möglich.
          Nach dem ersten Spieltag ist kein automatischer Einstieg mehr möglich.
        </p>
        <div className="mt-2 space-y-1.5 text-xs">
          <div className="bg-gray-50 dark:bg-gray-700/40 rounded-lg px-3 py-2 text-gray-600 dark:text-gray-300">
            In begründeten Ausnahmefällen kann ein Admin Nutzer nachträglich freischalten und das Startguthaben manuell festlegen.
          </div>
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg px-3 py-2 text-amber-800 dark:text-amber-300">
            Wer sich nach Saisonstart registriert, sieht eine Meldung und muss auf die Freischaltung durch den Admin warten.
          </div>
        </div>
      </HelpAccordion>

      <div className="pb-4 text-center text-xs text-gray-400 dark:text-gray-500">
        SpVgg Wildenroth Tippspiel · Saison 26/27<br />
        Nur mit Spielgeld — keine echten Einsätze
      </div>
    </div>
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

function NotifItem({ emoji, title, desc }: { emoji: string; title: string; desc: string }) {
  return (
    <div className="flex gap-2.5 items-start">
      <span className="text-base flex-shrink-0">{emoji}</span>
      <div>
        <div className="font-semibold text-gray-800 dark:text-gray-200 text-sm">{title}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">{desc}</div>
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

function QuoteExample({ odds, explanation }: { odds: number; explanation: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-12 text-center font-black text-base text-gray-900 dark:text-gray-100 bg-gray-100 dark:bg-gray-700 rounded-lg py-1 flex-shrink-0">
        {odds.toFixed(2).replace('.', ',')}
      </div>
      <div className="text-gray-500 dark:text-gray-400 text-xs flex-1">{explanation}</div>
    </div>
  )
}
