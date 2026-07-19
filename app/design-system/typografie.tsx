// Typografie-specimen van /design-system: de mw-typografieschaal met
// regelhoogtes, de rolverdeling sans/serif en het merkgebaar.

const SCHAAL = [
  {
    token: "--text-mw-display",
    maat: "52 / 1.05",
    klasse: "text-mw-display font-semibold tracking-tight",
    voorbeeld: "91%",
    rol: "Display — heromomenten, grote scores (tabular)",
  },
  {
    token: "--text-mw-kop-1",
    maat: "36 / 1.15",
    klasse: "text-mw-kop-1 font-semibold tracking-tight",
    voorbeeld: "Werk dat past",
    rol: "Paginatitel (h1)",
  },
  {
    token: "--text-mw-kop-2",
    maat: "26 / 1.25",
    klasse: "text-mw-kop-2 font-semibold tracking-tight",
    voorbeeld: "Jouw werkweek",
    rol: "Sectiekop (h2)",
  },
  {
    token: "--text-mw-kop-3",
    maat: "19 / 1.35",
    klasse: "text-mw-kop-3 font-semibold",
    voorbeeld: "Scoreopbouw per dimensie",
    rol: "Kaartkop (h3)",
  },
  {
    token: "--text-mw-body",
    maat: "16 / 1.6",
    klasse: "text-mw-body",
    voorbeeld:
      "Stel je ideale werkweek samen en ontdek praktijken die echt bij je passen — per dagdeel, per dag.",
    rol: "Lopende tekst (45–75 tekens per regel)",
  },
  {
    token: "--text-mw-klein",
    maat: "14 / 1.5",
    klasse: "text-mw-klein text-mw-text-muted",
    voorbeeld: "Minimaal 8 tekens. Je kunt dit later altijd aanpassen.",
    rol: "Hints, meta, secundaire tekst",
  },
  {
    token: "--text-mw-micro",
    maat: "12 / 1.4",
    klasse: "text-mw-micro font-semibold uppercase tracking-[0.14em] text-blauw-700",
    voorbeeld: "Matchfeed",
    rol: "Eyebrows en legenda — nooit lopende tekst",
  },
] as const;

export function Typografie() {
  return (
    <div className="flex flex-col gap-6">
      <div className="glass-strong flex flex-col gap-6 rounded-kaart p-8">
        {SCHAAL.map((rij) => (
          <div
            key={rij.token}
            className="flex flex-col gap-1 border-b border-mw-border pb-5 last:border-b-0 last:pb-0"
          >
            <div className="flex flex-wrap items-center gap-3 text-xs text-mw-text-muted">
              <code className="text-blauw-700">{rij.token}</code>
              <span className="tabular-nums">{rij.maat}</span>
              <span>{rij.rol}</span>
            </div>
            <p className={rij.klasse}>{rij.voorbeeld}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="glass-strong rounded-kaart p-8">
          <h3 className="mb-3 text-mw-kop-3 font-semibold">Het merkgebaar</h3>
          <p className="text-mw-kop-1 font-semibold tracking-tight">
            Werk dat <em className="accent-serif text-blauw-600">past</em>
          </p>
          <p className="mt-4 text-mw-klein leading-relaxed text-mw-text-muted">
            Sans + italic-serif in één kop is hét typografische merkgebaar
            (&ldquo;mondzorg<em className="accent-serif">werkt</em>&rdquo;-logica).
            Maximaal één keer per view, op het belangrijkste kopmoment — het
            mag geen formule worden (audit-P2 #10). Serif mag ook op
            display-schaal (grote cijfers), soms is géén accent de beste
            keuze.
          </p>
        </div>
        <div className="glass-strong rounded-kaart p-8">
          <h3 className="mb-3 text-mw-kop-3 font-semibold">Rolverdeling</h3>
          <ul className="flex flex-col gap-2 text-mw-klein leading-relaxed text-mw-text-muted">
            <li>
              <strong className="text-ink">--font-sans</strong> (Archivo, stand-in
              Aktiv Grotesk Ex): alle UI — navigatie, knoppen, formulieren,
              tabellen, data.
            </li>
            <li>
              <strong className="text-ink">--font-serif</strong> italic (Playfair
              Display, stand-in Abril Display ExtraBoldItalic): schaars en
              editorial — nooit voor UI-labels, knoppen of lopende tekst.
            </li>
            <li>
              Cijfers die data dragen zijn altijd{" "}
              <span className="tabular-nums font-semibold text-ink">
                tabular (0123456789)
              </span>
              , met eenheid en context.
            </li>
            <li>
              Tokens verwijzen naar rollen: een latere fontlicentie is een
              drop-in wissel in <code>app/layout.tsx</code>.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
