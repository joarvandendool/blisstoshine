import Link from "next/link";

const vacatures = [
  {
    titel: "Mondhygiënist",
    praktijk: "Tandzorg De Linde — Utrecht",
    tags: ["Parttime", "24–32 uur"],
    salaris: "€3.400 – €4.200",
  },
  {
    titel: "Tandartsassistent",
    praktijk: "Praktijk Zuidplein — Rotterdam",
    tags: ["Fulltime", "Per direct"],
    salaris: "€2.600 – €3.100",
  },
  {
    titel: "Tandarts",
    praktijk: "Mondzorgcentrum Noord — Groningen",
    tags: ["ZZP mogelijk", "3–5 dagen"],
    salaris: "In overleg",
  },
];

const stappen = [
  {
    nummer: "01",
    titel: "Maak je profiel",
    tekst:
      "Vertel in twee minuten wie je bent, wat je doet en waar je wilt werken. Geen cv nodig om te starten.",
  },
  {
    nummer: "02",
    titel: "Ontvang matches",
    tekst:
      "Wij matchen je met praktijken die passen bij jouw wensen — qua rol, regio, uren en werksfeer.",
  },
  {
    nummer: "03",
    titel: "Ga in gesprek",
    tekst:
      "Direct contact met de praktijk, zonder tussenlagen. Jij bepaalt het tempo en houdt de regie.",
  },
];

function Wordmark() {
  return (
    <>
      mondzorg<em>werkt</em>
    </>
  );
}

export default function Home() {
  return (
    <>
      <header className="header">
        <div className="mkt-container header-inner">
          <Link className="wordmark" href="/">
            <Wordmark />
          </Link>
          <nav className="nav">
            <a href="#vacatures">Vacatures</a>
            <a href="#zo-werkt-het">Zo werkt het</a>
            <a href="#praktijken">Voor praktijken</a>
            <Link className="btn btn-blauw btn-klein" href="/registreren">
              Maak profiel
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="orb orb-1" />
          <div className="orb orb-2" />
          <div className="orb orb-3" />
          <div className="mkt-container">
            <span className="hero-label">Hét carrièreplatform voor de mondzorg</span>
            <h1>
              Werk dat <em>past</em>,<br />
              in de mondzorg.
            </h1>
            <p className="sub">
              Vind jouw plek als tandarts, mondhygiënist of assistent — bij praktijken
              waar je écht op je plek zit.
            </p>

            <div className="zoekkaart">
              <input placeholder="Functie of trefwoord" aria-label="Functie of trefwoord" />
              <div className="scheiding" />
              <input placeholder="Plaats of regio" aria-label="Plaats of regio" />
              <button className="btn btn-blauw">Zoek vacatures</button>
            </div>

            <div className="chips">
              <Link className="chip" href="/registreren">Tandarts</Link>
              <Link className="chip" href="/registreren">Mondhygiënist</Link>
              <Link className="chip" href="/registreren">Tandartsassistent</Link>
              <Link className="chip" href="/registreren">Preventieassistent</Link>
              <Link className="chip" href="/registreren">Praktijkmanager</Link>
            </div>
          </div>
        </section>

        <div className="mkt-container stats">
          <div className="stat">
            <div className="getal">
              <em>250</em>+
            </div>
            <div className="label">open vacatures</div>
          </div>
          <div className="stat">
            <div className="getal">
              <em>120</em>
            </div>
            <div className="label">aangesloten praktijken</div>
          </div>
          <div className="stat">
            <div className="getal">
              <em>93</em>%
            </div>
            <div className="label">vindt een match binnen 30 dagen</div>
          </div>
        </div>

        <section className="sectie" id="vacatures">
          <div className="mkt-container">
            <div className="sectie-kop">
              <h2>
                Uitgelichte <em>vacatures</em>
              </h2>
              <p>
                Elke vacature met eerlijke info over salaris, uren en team — zodat je
                weet waar je aan begint.
              </p>
            </div>
            <div className="kaarten">
              {vacatures.map((v) => (
                <article className="kaart" key={v.titel}>
                  <div className="tags">
                    {v.tags.map((t, i) => (
                      <span className={i === 0 ? "tag" : "tag roze"} key={t}>
                        {t}
                      </span>
                    ))}
                  </div>
                  <h3>{v.titel}</h3>
                  <p className="meta">{v.praktijk}</p>
                  <div className="onder">
                    <span className="salaris">{v.salaris}</span>
                    <Link className="link" href="/registreren">
                      Bekijk →
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="sectie" id="zo-werkt-het">
          <div className="mkt-container">
            <div className="sectie-kop gecentreerd">
              <h2>
                Zo <em>werkt</em> het
              </h2>
              <p>Van profiel tot eerste werkdag — in drie stappen.</p>
            </div>
            <div className="stappen">
              {stappen.map((s) => (
                <div className="stap" key={s.nummer}>
                  <div className="nummer">{s.nummer}</div>
                  <h3>{s.titel}</h3>
                  <p>{s.tekst}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="sectie" id="praktijken">
          <div className="mkt-container">
            <div className="praktijken">
              <div className="orb-p1" />
              <div className="orb-p2" />
              <h2>
                Praktijk met een openstaande stoel? <em>Wij vullen hem.</em>
              </h2>
              <p>
                Bereik duizenden mondzorgprofessionals waar zij écht zitten. Plaats je
                vacature, of laat ons actief werven met campagnes op maat.
              </p>
              <div className="acties">
                <Link className="btn btn-roze" href="/registreren?type=praktijk">
                  Plaats een vacature
                </Link>
                <Link className="btn btn-ghost" href="/registreren?type=praktijk">
                  Plan een kennismaking
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="sectie">
          <div className="mkt-container quote">
            <blockquote>
              “Binnen twee weken had ik drie gesprekken bij praktijken die echt bij me
              pasten. Zo kan solliciteren dus ook voelen.”
            </blockquote>
            <p className="wie">Sanne · Mondhygiënist, Amsterdam</p>
          </div>
        </section>

        <section className="footer-cta">
          <div className="mkt-container">
            <h2>
              Klaar voor werk dat <em>werkt</em>?
            </h2>
            <div className="acties">
              <Link className="btn btn-blauw" href="/registreren">
                Bekijk alle vacatures
              </Link>
              <Link className="btn btn-ghost" href="/registreren?type=praktijk">
                Voor praktijken
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="mkt-container footer-inner">
          <Link className="wordmark" href="/">
            <Wordmark />
          </Link>
          <p className="klein">© 2026 mondzorgwerkt · privacy · voorwaarden</p>
        </div>
      </footer>
    </>
  );
}
