export const revalidate = 86400

export default function AnleitungPage() {
  return (
    <div className="px-4 py-4 space-y-4">
      <div className="bg-red-700 text-white rounded-2xl px-5 py-4">
        <div className="text-red-200 text-xs font-medium uppercase tracking-wide">SpVgg Wildenroth</div>
        <div className="text-2xl font-black mt-0.5">So funktioniert&apos;s</div>
        <div className="text-red-200 text-sm mt-1">Das Wichtigste auf einen Blick</div>
      </div>

      <Section title="Das Ziel" emoji="🏆">
        <p>
          Du startest mit <strong>1.000 € Spielguthaben</strong> und versuchst, durch clevere Tipps
          möglichst viel daraus zu machen. Wer am Ende der Saison das höchste Guthaben hat, gewinnt.
        </p>
        <div className="mt-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm text-green-800">
          💰 Jeden <strong>Montag um 12:00 Uhr</strong> gibt es automatisch <strong>10 € Taschengeld</strong> — auch nach einer Pechsträhne geht es weiter.
        </div>
      </Section>

      <Section title="Wetten platzieren & stornieren" emoji="⏰">
        <div className="space-y-1.5 text-sm">
          <div className="flex gap-2">
            <span className="text-red-700 font-bold flex-shrink-0">Öffnet:</span>
            <span>Montag 12:00 Uhr der Spielwoche</span>
          </div>
          <div className="flex gap-2">
            <span className="text-red-700 font-bold flex-shrink-0">Schluss:</span>
            <span>Anpfiff des ersten Spiels des Spieltags</span>
          </div>
          <div className="flex gap-2">
            <span className="text-red-700 font-bold flex-shrink-0">Wettscheine:</span>
            <span>Maximal <strong>3 Wettscheine</strong> pro Spieltag (2 normale + 1 Risky)</span>
          </div>
          <div className="flex gap-2">
            <span className="text-red-700 font-bold flex-shrink-0">Einsatz:</span>
            <span>Maximal <strong>250 € pro Wettschein</strong></span>
          </div>
          <div className="flex gap-2">
            <span className="text-blue-700 font-bold flex-shrink-0">Storno:</span>
            <span>Bis zum ersten Anpfiff des Spieltags möglich — der Einsatz wird sofort zurückgebucht</span>
          </div>
        </div>
      </Section>

      <Section title="Risky Wette" emoji="🎲">
        <p>
          Der Wettschein mit der <strong>höchsten Quote</strong> belegt automatisch den Risky-Slot —
          vorausgesetzt, die Quote beträgt <strong>mindestens 20,00</strong>.
        </p>
        <div className="mt-2 space-y-1">
          <div className="text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-gray-600">
            Beispiel: Du hast 2 normale Wettscheine (Quote 2,10 und 5,40) und eine Kombiwette mit Quote 23,50.
            Die Kombi wird automatisch als Risky gewertet — du hast alle 3 Slots genutzt.
          </div>
        </div>
      </Section>

      <Section title="Kombiwetten" emoji="🔗">
        <p>
          Wenn du mehrere Tipps aus verschiedenen Spielen zusammenstellst, entsteht automatisch eine Kombiwette.
          Die Quoten werden miteinander multipliziert — das erhöht den möglichen Gewinn erheblich.
        </p>
        <div className="mt-2 bg-gray-50 rounded-xl px-4 py-3 text-sm">
          <div className="text-gray-600">Sieg Heimteam <span className="font-bold text-red-700">@1,45</span> × Über 3,5 <span className="font-bold text-red-700">@1,80</span></div>
          <div className="flex items-center justify-between mt-1 pt-1 border-t border-gray-200">
            <span className="text-gray-500">20 € Einsatz →</span>
            <span className="font-bold text-green-600">52,20 € Auszahlung</span>
          </div>
        </div>
        <div className="mt-2 space-y-1">
          <div className="text-xs text-red-700 bg-red-50 rounded px-2 py-1">
            ⚠️ Ein falscher Tipp macht die gesamte Kombiwette verloren.
          </div>
          <div className="text-xs text-orange-700 bg-orange-50 rounded px-2 py-1">
            🚫 Aus demselben Spiel darf nur ein Tipp in eine Kombiwette — z.B. nicht gleichzeitig Auswärtssieg und Doppelte Chance X2.
          </div>
        </div>
      </Section>

      <Section title="Quoten" emoji="📊">
        <p className="text-sm font-semibold text-gray-700">Gewinn = Einsatz × Quote</p>
        <p className="text-sm text-gray-500 mt-0.5">Beispiel: 20 € × 2,50 = <strong>50 € Auszahlung</strong></p>
        <div className="mt-2 space-y-1.5">
          <QuoteExample odds={1.20} explanation="Klarer Favorit" />
          <QuoteExample odds={2.50} explanation="Ausgeglichenes Duell" />
          <QuoteExample odds={6.00} explanation="Außenseiter" />
          <QuoteExample odds={20.00} explanation="Sehr unwahrscheinlich" />
        </div>
      </Section>

      <Section title="Wettmärkte" emoji="📋">
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
        <div className="text-xs text-gray-500 mt-2 space-y-1">
          <p>• Eigentore zählen nicht.</p>
          <p>• Sollte ein Spieler kurzfristig aus dem Kader fallen, wird deine Wette automatisch storniert und der Einsatz zurückgebucht. Bei einer Kombi mit dem betroffenen Tipp wird der gesamte Kombi-Einsatz erstattet.</p>
        </div>
      </Section>

      <Section title="Wildenroth-Spieler & Trainer" emoji="⚽">
        <p>
          Als aktiver Spieler oder Trainer der SpVgg Wildenroth darfst du bei Wildenroth-Spielen
          <strong> nicht gegen Wildenroth wetten</strong>.
        </p>
        <div className="mt-2 space-y-1">
          <div className="text-xs text-green-700 bg-green-50 rounded px-2 py-1">
            ✅ Erlaubt: Wildenroth-Sieg (1X2), genaues Ergebnis mit Wildenroth-Sieg,
            neutrale Tormärkte (Über/Unter, Beide treffen)
          </div>
          <div className="text-xs text-red-700 bg-red-50 rounded px-2 py-1">
            🚫 Gesperrt: Wildenroth-Niederlage, Unentschieden, alle Doppelte-Chance-Picks gegen Wildenroth,
            genaue Ergebnisse mit Unentschieden oder Wildenroth-Niederlage
          </div>
        </div>
      </Section>

      <Section title="App installieren" emoji="📱">
        <div className="space-y-3">
          <div className="border border-gray-100 rounded-xl p-3 space-y-1.5">
            <div className="font-semibold text-gray-700 text-xs">🍎 iPhone mit Safari</div>
            <ol className="text-xs text-gray-500 space-y-0.5 list-decimal list-inside">
              <li>Webseite in Safari öffnen</li>
              <li>Unten rechts auf die drei Punkte tippen</li>
              <li>„Teilen" auswählen</li>
              <li>Unten auf „Mehr anzeigen" tippen</li>
              <li>„Zum Home-Bildschirm" auswählen</li>
              <li>Namen eingeben und „Hinzufügen" tippen</li>
            </ol>
          </div>
          <div className="border border-gray-100 rounded-xl p-3 space-y-1.5">
            <div className="font-semibold text-gray-700 text-xs">🍎 iPhone mit Chrome</div>
            <ol className="text-xs text-gray-500 space-y-0.5 list-decimal list-inside">
              <li>Webseite in Chrome öffnen</li>
              <li>Oben rechts auf das Teilen-Symbol tippen</li>
              <li>Unten auf „Mehr anzeigen" tippen</li>
              <li>„Zum Home-Bildschirm" auswählen</li>
              <li>Namen eingeben und „Hinzufügen" tippen</li>
            </ol>
          </div>
          <div className="border border-gray-100 rounded-xl p-3 space-y-1.5">
            <div className="font-semibold text-gray-700 text-xs">🤖 Android mit Chrome</div>
            <ol className="text-xs text-gray-500 space-y-0.5 list-decimal list-inside">
              <li>Webseite in Chrome öffnen</li>
              <li>Rechts in der Adressleiste auf „Mehr" tippen</li>
              <li>„Zum Home-Bildschirm hinzufügen" auswählen</li>
              <li>„Installieren" tippen</li>
            </ol>
          </div>
          <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-xs text-blue-700">
            💡 Empfohlen: Aktiviere anschließend unter <strong>Profil</strong> die Benachrichtigungen,
            damit du keine Auswertung, Reminder oder Spieltags-Updates verpasst.
          </div>
        </div>
      </Section>

      <div className="pb-4 text-center text-xs text-gray-400">
        SpVgg Wildenroth Tippspiel · Saison 25/26<br />
        Nur mit Spielgeld — keine echten Einsätze
      </div>
    </div>
  )
}

function Section({ title, emoji, children }: { title: string; emoji: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
        <span className="text-xl">{emoji}</span>
        <h2 className="font-bold text-gray-900">{title}</h2>
      </div>
      <div className="px-4 py-3 text-sm text-gray-600 space-y-2">{children}</div>
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
    <div className="border border-gray-100 rounded-xl p-3 space-y-1.5">
      <div className="font-semibold text-gray-800 text-sm">{title}</div>
      {description && <p className="text-xs text-gray-500">{description}</p>}
      {items.length > 0 && (
        <div className="space-y-1">
          {items.map((item) => (
            <div key={item.label} className="flex gap-2 text-xs">
              <span className="bg-red-100 text-red-700 font-bold px-1.5 py-0.5 rounded flex-shrink-0">{item.label}</span>
              <span className="text-gray-600">{item.desc}</span>
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
      <div className="w-12 text-center font-black text-base text-gray-900 bg-gray-100 rounded-lg py-1 flex-shrink-0">
        {odds.toFixed(2).replace('.', ',')}
      </div>
      <div className="text-gray-500 text-xs flex-1">{explanation}</div>
    </div>
  )
}
