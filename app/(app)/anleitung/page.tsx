export const revalidate = 86400

export default function AnleitungPage() {
  return (
    <div className="px-4 py-4 space-y-4">
      <div className="bg-red-700 text-white rounded-2xl px-5 py-4">
        <div className="text-red-200 text-xs font-medium uppercase tracking-wide">SpVgg Wildenroth</div>
        <div className="text-2xl font-black mt-0.5">So funktioniert's</div>
        <div className="text-red-200 text-sm mt-1">Alles was du über das Tippspiel wissen musst</div>
      </div>

      <Section title="Das Ziel" emoji="🏆">
        <p>
          Du startest mit <strong>1.000 € Spielguthaben</strong> und versuchst, durch clevere Tipps
          möglichst viel daraus zu machen. Wer am Ende der Saison das höchste Guthaben hat, gewinnt!
        </p>
      </Section>

      <Section title="Wann kann ich tippen?" emoji="⏰">
        <p>
          Für jeden Spieltag öffnet das Tippfenster am <strong>Montag um 12:00 Uhr</strong> der
          jeweiligen Spielwoche. Tipps sind dann bis zum <strong>Anpfiff des ersten Spiels</strong>
          möglich — danach ist der Spieltag gesperrt.
        </p>
        <div className="mt-2 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 text-sm">
          ⚠️ Vor Montag 12:00 Uhr sind die Quoten noch nicht freigegeben, da sie sich nach den
          Ergebnissen des Wochenendes anpassen.
        </div>
        <div className="mt-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
          <strong>Maximal 2 Wetten pro Spieltag</strong> — Einzelwetten und Kombiwetten zusammen gezählt.
        </div>
      </Section>

      <Section title="Wie tippe ich?" emoji="🎯">
        <Step n={1} text="Gehe auf die Tipps-Seite und wähle den aktuellen Spieltag aus." />
        <Step n={2} text="Tippe auf einen der Wettmärkte (z.B. '1' für Heimsieg oder 'Über 3,5')." />
        <Step n={3} text="Dein Tipp landet im Wettschein. Du kannst bis zu 2 Tipps pro Spieltag platzieren." />
        <Step n={4} text="Gib deinen Einsatz ein und klicke auf 'Wette platzieren' — fertig!" />
      </Section>

      <Section title="Wettmärkte" emoji="📋">
        <MarketCard
          title="1X2 — Spielausgang"
          description="Der klassische Tipp: Wer gewinnt das Spiel?"
          items={[
            { label: '1', desc: 'Heimsieg — die Heimmannschaft gewinnt' },
            { label: 'X', desc: 'Unentschieden — kein Sieger' },
            { label: '2', desc: 'Auswärtssieg — die Gastmannschaft gewinnt' },
          ]}
        />
        <MarketCard
          title="Doppelte Chance"
          description="Zwei von drei Ausgängen abdecken — sicherer, aber mit niedrigerer Quote."
          items={[
            { label: '1X', desc: 'Heimsieg oder Unentschieden' },
            { label: '12', desc: 'Heimsieg oder Auswärtssieg (kein Unentschieden)' },
            { label: 'X2', desc: 'Unentschieden oder Auswärtssieg' },
          ]}
        />
        <MarketCard
          title="Über/Unter 3,5 Tore"
          description="Egal wer gewinnt — werden mehr oder weniger als 4 Tore fallen?"
          items={[
            { label: 'Über 3,5', desc: 'Mindestens 4 Tore insgesamt (z.B. 3:1, 4:0, 2:2)' },
            { label: 'Unter 3,5', desc: 'Höchstens 3 Tore insgesamt (z.B. 1:0, 2:1, 1:1)' },
          ]}
        />
        <MarketCard
          title="Beide Teams treffen"
          description="Trifft jede Mannschaft mindestens einmal?"
          items={[
            { label: 'Ja', desc: 'Beide Teams erzielen mindestens 1 Tor' },
            { label: 'Nein', desc: 'Mindestens eine Mannschaft bleibt ohne Tor' },
          ]}
        />
        <MarketCard
          title="Genaues Ergebnis"
          description="Die schwierigste, aber lukrativste Wette — tippe das exakte Endergebnis."
          items={[
            { label: 'Beispiel', desc: '2:1 — Heimteam gewinnt 2:1' },
          ]}
        />
      </Section>

      <Section title="Kombiwetten" emoji="🔗">
        <p>
          Sobald du 2 Tipps aus <strong>verschiedenen Spielen</strong> auswählst, wechselt der
          Wettschein automatisch in den Kombimodus. Die Quoten werden dann miteinander multipliziert.
        </p>
        <div className="mt-2 bg-gray-50 rounded-xl px-4 py-3 text-sm space-y-1">
          <div className="font-semibold text-gray-700">Beispiel Kombiwette:</div>
          <div className="text-gray-600">Wildenroth Sieg @ 1,45</div>
          <div className="text-gray-600">Über 3,5 Tore @ 1,80</div>
          <div className="flex items-center justify-between border-t border-gray-200 pt-1 mt-1">
            <span className="text-gray-600">Gesamt-Quote:</span>
            <span className="font-bold text-red-700">1,45 × 1,80 = <strong>2,61</strong></span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-600">Einsatz 20 € → Auszahlung:</span>
            <span className="font-bold text-green-600">52,20 €</span>
          </div>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Hinweis: Widersprüchliche Tipps auf dasselbe Spiel (z.B. Heimsieg + X2) können nicht
          kombiniert werden. Tipps aus demselben Spiel auf verträgliche Märkte (z.B. Heimsieg + Über 3,5)
          sind erlaubt.
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Bei der Kombiwette verlierst du deinen gesamten Einsatz, wenn auch nur ein Tipp falsch ist.
        </p>
      </Section>

      <Section title="Quoten verstehen" emoji="📊">
        <p>
          Die Quoten zeigen dir, wie wahrscheinlich ein Ergebnis ist und was du im Gewinnfall erhältst.
        </p>
        <div className="mt-2 space-y-2">
          <QuoteExample odds={1.20} explanation="Klarer Favorit — hohe Wahrscheinlichkeit, aber kleiner Gewinn" />
          <QuoteExample odds={2.50} explanation="Ausgeglichenes Duell — ca. 50/50" />
          <QuoteExample odds={6.00} explanation="Außenseiter — geringe Chance, aber hoher Gewinn" />
        </div>
        <p className="mt-2 text-sm font-semibold text-gray-700">Gewinn = Einsatz × Quote</p>
        <p className="text-sm text-gray-500">
          Beispiel: 20 € × Quote 2,50 = <strong>50 € Auszahlung</strong> (30 € Gewinn)
        </p>
        <p className="mt-2 text-xs text-gray-400">
          Die Quoten werden automatisch auf Basis der Saisondaten berechnet und jeden Montag
          für den neuen Spieltag aktualisiert.
        </p>
      </Section>

      <Section title="App auf Handy installieren" emoji="📱">
        <div className="space-y-3">
          <div>
            <div className="font-semibold text-gray-700 text-sm mb-1">📱 iPhone (Safari)</div>
            <ol className="text-sm text-gray-600 space-y-1 list-decimal list-inside">
              <li>Diese Seite in Safari öffnen</li>
              <li>Unten auf das Teilen-Symbol tippen (Kasten mit Pfeil)</li>
              <li>„Zum Home-Bildschirm" wählen</li>
              <li>„Hinzufügen" bestätigen</li>
            </ol>
          </div>
          <div>
            <div className="font-semibold text-gray-700 text-sm mb-1">🤖 Android (Chrome)</div>
            <ol className="text-sm text-gray-600 space-y-1 list-decimal list-inside">
              <li>Diese Seite in Chrome öffnen</li>
              <li>Auf die drei Punkte oben rechts tippen</li>
              <li>„App installieren" oder „Zum Startbildschirm" wählen</li>
            </ol>
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

function Step({ n, text }: { n: number; text: string }) {
  return (
    <div className="flex gap-3 items-start">
      <div className="w-6 h-6 rounded-full bg-red-700 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
        {n}
      </div>
      <p className="text-sm text-gray-600">{text}</p>
    </div>
  )
}

function MarketCard({
  title, description, items,
}: {
  title: string
  description: string
  items: { label: string; desc: string }[]
}) {
  return (
    <div className="border border-gray-100 rounded-xl p-3 space-y-2">
      <div className="font-semibold text-gray-800 text-sm">{title}</div>
      <p className="text-xs text-gray-500">{description}</p>
      <div className="space-y-1">
        {items.map((item) => (
          <div key={item.label} className="flex gap-2 text-xs">
            <span className="bg-red-100 text-red-700 font-bold px-1.5 py-0.5 rounded flex-shrink-0">{item.label}</span>
            <span className="text-gray-600">{item.desc}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function QuoteExample({ odds, explanation }: { odds: number; explanation: string }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="w-14 text-center font-black text-lg text-gray-900 bg-gray-100 rounded-lg py-1">
        {odds.toFixed(2)}
      </div>
      <div className="text-gray-600 text-xs flex-1">{explanation}</div>
    </div>
  )
}
