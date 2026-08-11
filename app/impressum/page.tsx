import Link from 'next/link'

export const metadata = {
  title: 'Impressum – Wildenroth Tippspiel',
}

export default function ImpressumPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="bg-gradient-to-r from-red-700 to-red-800 text-white safe-top">
        <div className="max-w-lg mx-auto px-4 py-4 flex items-center gap-3">
          <Link href="/" className="text-white/80 hover:text-white text-sm">← Zurück</Link>
          <h1 className="text-lg font-bold">Impressum</h1>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-5 text-sm text-gray-700 dark:text-gray-300">
        <section>
          <h2 className="font-bold text-gray-900 dark:text-gray-100 mb-1">Angaben gemäß § 5 DDG</h2>
          <p>
            Michael Jani<br />
            Mauerner Str. 6a<br />
            82284 Grafrath<br />
            Deutschland
          </p>
        </section>

        <section>
          <h2 className="font-bold text-gray-900 dark:text-gray-100 mb-1">Kontakt</h2>
          <p>
            E-Mail: <a href="mailto:michaeljani98@gmail.com" className="text-red-700 dark:text-red-400 hover:underline">michaeljani98@gmail.com</a>
          </p>
        </section>

        <section>
          <h2 className="font-bold text-gray-900 dark:text-gray-100 mb-1">Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h2>
          <p>
            Michael Jani, Anschrift wie oben.
          </p>
        </section>

        <section>
          <h2 className="font-bold text-gray-900 dark:text-gray-100 mb-1">Charakter des Angebots</h2>
          <p>
            Das Wildenroth Tippspiel ist ein privates, nicht-kommerzielles Freizeitprojekt für Mitglieder
            und Freunde der SpVgg Wildenroth. Es wird ausschließlich mit virtueller Spielwährung
            („Wildis") gespielt — es findet zu keinem Zeitpunkt ein Einsatz von echtem Geld statt, und es
            werden keine Gewinne in echtem Geld ausgezahlt. Das Angebot ist kein Glücksspiel im Sinne des
            Glücksspielstaatsvertrags.
          </p>
        </section>

        <section>
          <h2 className="font-bold text-gray-900 dark:text-gray-100 mb-1">Haftung für Inhalte</h2>
          <p>
            Als Diensteanbieter bin ich gemäß § 7 Abs. 1 DDG für eigene Inhalte auf diesen Seiten nach den
            allgemeinen Gesetzen verantwortlich. Nach §§ 8–10 DDG bin ich als Diensteanbieter jedoch nicht
            verpflichtet, übermittelte oder gespeicherte fremde Informationen zu überwachen oder nach
            Umständen zu forschen, die auf eine rechtswidrige Tätigkeit hinweisen. Verpflichtungen zur
            Entfernung oder Sperrung der Nutzung von Informationen nach den allgemeinen Gesetzen bleiben
            hiervon unberührt. Eine diesbezügliche Haftung ist jedoch erst ab dem Zeitpunkt der Kenntnis
            einer konkreten Rechtsverletzung möglich. Bei Bekanntwerden entsprechender Rechtsverletzungen
            werde ich diese Inhalte umgehend entfernen.
          </p>
        </section>

        <section>
          <h2 className="font-bold text-gray-900 dark:text-gray-100 mb-1">Haftung für Links</h2>
          <p>
            Diese App enthält Links zu externen Websites Dritter, auf deren Inhalte ich keinen Einfluss
            habe. Deshalb kann ich für diese fremden Inhalte auch keine Gewähr übernehmen. Für die Inhalte
            der verlinkten Seiten ist stets der jeweilige Anbieter oder Betreiber verantwortlich. Die
            verlinkten Seiten wurden zum Zeitpunkt der Verlinkung auf mögliche Rechtsverstöße überprüft.
          </p>
        </section>

        <section>
          <h2 className="font-bold text-gray-900 dark:text-gray-100 mb-1">Urheberrecht</h2>
          <p>
            Die durch mich erstellten Inhalte und Werke auf diesen Seiten unterliegen dem deutschen
            Urheberrecht. Vereinslogos, Vereinsfarben und -namen (z.B. SpVgg Wildenroth) sind Eigentum der
            jeweiligen Vereine und werden mit freundlicher Duldung verwendet.
          </p>
        </section>

        <section>
          <h2 className="font-bold text-gray-900 dark:text-gray-100 mb-1">Online-Streitbeilegung</h2>
          <p>
            Da über diese App keine entgeltlichen Verträge geschlossen werden, sind die Vorschriften zur
            Online-Streitbeilegung (Art. 14 Abs. 1 ODR-VO) nicht einschlägig.
          </p>
        </section>

        <p className="text-xs text-gray-400 dark:text-gray-500 pt-2">
          Siehe auch: <Link href="/datenschutz" className="text-red-700 dark:text-red-400 hover:underline">Datenschutzerklärung</Link>
        </p>
      </div>
    </div>
  )
}
