// De kennisbank van mondzorgwerkt (Workstream B, fase 8).
//
// HANDGESCHREVEN redactionele inhoud — geen gegenereerde teksten. Precies
// zes artikelen; nieuwe artikelen worden hier bewust en redactioneel
// toegevoegd, nooit automatisch per taxonomiesleutel (geen dunne pagina's).
//
// Redactionele regels:
// - Direct antwoord (2–3 zinnen) bovenaan, daarna heldere H2-secties.
// - Salarisbandbreedtes zijn ALTIJD een indicatie met methodologie-blok.
// - Arbeidsmarktcijfers worden NIET verzonnen: zolang het read-model
//   market-insights (backend-werkstroom) nog niet levert, blijft de
//   arbeidsmarktpagina kwalitatief en expliciet "indicatief, gebaseerd op
//   platformdata zodra beschikbaar".

import type { KennisArtikel } from "./types";

const AUTEUR = "Redactie Mondzorgwerkt";
const BRONPERIODE = "juli 2026";
const ACTUALISATIE = "2026-07-19";

export const KENNIS_ARTIKELEN: KennisArtikel[] = [
  /* ------------------------- functies/mondhygienist ------------------------- */
  {
    slug: "mondhygienist",
    pad: "/functies/mondhygienist",
    kortLabel: "Wat doet een mondhygiënist?",
    categorie: "functies",
    categorieLabel: "Functies",
    titel: "Mondhygiënist: wat doet een mondhygiënist en hoe word je het?",
    beschrijving:
      "Wat een mondhygiënist doet, welke opleiding en registratie nodig zijn, hoe een werkweek eruitziet en welke doorgroeimogelijkheden er zijn.",
    directAntwoord:
      "Een mondhygiënist is een hbo-opgeleide zorgverlener die zelfstandig tandvlees- en preventiebehandelingen uitvoert: van parodontale screenings en gebitsreiniging tot voorlichting en begeleiding van risicopatiënten. Je wordt mondhygiënist via de vierjarige hbo-opleiding Mondzorgkunde. De meeste mondhygiënisten werken in een eigen agenda binnen een algemene praktijk of een parodontologiepraktijk, in loondienst of als zzp'er.",
    secties: [
      {
        kop: "Wat doet een mondhygiënist?",
        paragrafen: [
          "De kern van het vak is preventie en parodontale zorg. Waar de tandarts vooral herstelt (vullingen, kronen, extracties), richt de mondhygiënist zich op het gezond houden van tandvlees en gebit — en op het behandelen van tandvleesproblemen voordat ze onherstelbaar worden.",
          "In de praktijk betekent dat een eigen agenda met eigen patiënten. Je screent, stelt een behandelplan op binnen jouw deskundigheidsgebied, behandelt en evalueert. Bij veel praktijken ben je ook degene die het preventiebeleid vormgeeft en preventieassistenten aanstuurt of coacht.",
        ],
        lijst: [
          "Parodontale screenings en metingen (o.a. DPSI/PPS-scores) en het bespreken van de uitslag met de patiënt",
          "Gebitsreiniging: verwijderen van tandsteen en plaque, sub- en supragingivaal",
          "Uitvoeren van het parodontologie-protocol bij tandvleesontsteking (initiële behandeling, herbeoordeling, nazorg)",
          "Voorlichting en gedragsbegeleiding: poets- en rageradvies, voeding, roken en mondgezondheid",
          "Fluoridebehandelingen en sealants, vaak in samenwerking met de preventieassistent",
          "Signaleren en doorverwijzen: afwijkingen die buiten je deskundigheidsgebied vallen bespreek je met de tandarts",
        ],
      },
      {
        kop: "Opleiding en registratie",
        paragrafen: [
          "De route naar het vak is de vierjarige hbo-bachelor Mondzorgkunde. Je leert er naast het klinische handwerk ook gedragswetenschap, communicatie en praktijkorganisatie — logisch, want gedragsverandering is de helft van preventie.",
          "Het beroep mondhygiënist is een wettelijk geregeld beroep: de opleidingseisen en het deskundigheidsgebied zijn vastgelegd in de Wet BIG. Welke handelingen je zelfstandig mag uitvoeren en waarvoor een opdracht van een tandarts nodig is, hangt af van je opleiding en de actuele regelgeving; werkgevers vermelden gevraagde bevoegdheden (zoals röntgenbevoegdheid) in de vacature. Op mondzorgwerkt zie je die eisen per vacature als 'verplicht' of 'bespreekbaar'.",
        ],
      },
      {
        kop: "Waar werk je en in welke vorm?",
        paragrafen: [
          "De meeste mondhygiënisten werken in een algemene tandartspraktijk, een groepspraktijk of een verwijspraktijk voor parodontologie. Daarnaast zijn er mondhygiënisten met een geheel eigen (vrijgevestigde) praktijk.",
          "Qua contractvorm zie je op het platform grofweg twee smaken: loondienst (vast dienstverband, vaak met opleidings- en intervisieafspraken) en zzp (een vaste dag of dagen per week op factuurbasis, soms bij meerdere praktijken tegelijk). Welke vorm past hangt af van hoeveel zekerheid, vrijheid en administratie je wilt.",
        ],
      },
      {
        kop: "Hoe ziet een werkweek eruit?",
        paragrafen: [
          "Mondhygiënist is bij uitstek een vak waarin je je week zelf kunt vormgeven. Behandelafspraken duren doorgaans 30 tot 60 minuten, waardoor een dag voorspelbaar opbouwt. Veel praktijken zoeken versterking voor twee of drie vaste dagen; parttime is eerder regel dan uitzondering.",
          "Let bij het vergelijken van werkplekken niet alleen op de dagen, maar ook op de behandeltijden per afspraak, of je een eigen vaste patiëntenstam krijgt en hoeveel ruimte er is voor het parodontologie-spreekuur. Die drie factoren bepalen in de praktijk het verschil tussen 'productiedraaien' en het vak uitoefenen zoals het bedoeld is.",
        ],
      },
      {
        kop: "Doorgroeien als mondhygiënist",
        paragrafen: [
          "Doorgroei zit in dit vak vooral in verdieping en regie: je specialiseren in parodontologie of implantaatnazorg, het preventieteam van een praktijk opbouwen en aansturen, praktijkbreed preventiebeleid ontwikkelen, of een eigen praktijk starten. Praktijken die serieus werk maken van ontwikkeling vermelden op hun vacatures zaken als congresbudget, intervisie of een specialisatietraject — daar kun je op filteren.",
        ],
      },
      {
        kop: "Mondhygiënist of preventieassistent: wat is het verschil?",
        paragrafen: [
          "Een preventieassistent is een tandartsassistent met een aanvullende preventieopleiding die eenvoudige preventietaken uitvoert onder supervisie, zoals gebitsreiniging bij gezond of licht ontstoken tandvlees en poetsinstructie. De mondhygiënist is hbo-opgeleid, werkt zelfstandiger, behandelt ook gevorderde tandvleesproblemen en draagt de regie over het preventietraject. In goed georganiseerde praktijken werken beide rollen als team, elk op het eigen niveau.",
        ],
      },
    ],
    bronperiode: BRONPERIODE,
    auteur: AUTEUR,
    actualisatiedatum: ACTUALISATIE,
    methodologie: [
      "Dit artikel is geschreven door de redactie van Mondzorgwerkt op basis van het beroepsprofiel van de mondhygiënist, de opleidingsinformatie van de hbo-opleidingen Mondzorgkunde en de vacature-eisen die praktijken op het platform hanteren.",
      "Wet- en regelgeving rond bevoegdheden (Wet BIG) verandert; raadpleeg voor de actuele stand altijd de officiële bronnen (Rijksoverheid, beroepsvereniging NVM-mondhygiënisten). Wij actualiseren dit artikel wanneer de regelgeving of het opleidingslandschap wijzigt.",
    ],
    gerelateerdeFuncties: ["mondhygienist", "preventieassistent"],
    gerelateerdeRegios: [],
  },

  /* ----------------------- functies/tandartsassistent ----------------------- */
  {
    slug: "tandartsassistent",
    pad: "/functies/tandartsassistent",
    kortLabel: "Wat doet een tandartsassistent?",
    categorie: "functies",
    categorieLabel: "Functies",
    titel: "Tandartsassistent: taken, opleiding en doorgroeimogelijkheden",
    beschrijving:
      "Wat een tandartsassistent doet, hoe je het wordt (mbo of intern opgeleid), wat röntgenbevoegdheid inhoudt en hoe je doorgroeit naar preventie- of orthodontieassistent.",
    directAntwoord:
      "Een tandartsassistent assisteert de tandarts aan de stoel, bereidt behandelkamers voor, verzorgt de sterilisatie en ondersteunt patiënten voor, tijdens en na de behandeling. Het is geen wettelijk beschermd beroep: je kunt instromen via een mbo-opleiding of intern worden opgeleid. Met aanvullende certificaten groei je door naar preventie- of orthodontieassistent.",
    secties: [
      {
        kop: "Wat doet een tandartsassistent?",
        paragrafen: [
          "De tandartsassistent is de spil van de behandelkamer. Een goede assistent denkt vooruit: instrumenten liggen klaar vóór de tandarts erom vraagt, de patiënt weet wat er gaat gebeuren, en de kamer is binnen minuten omgebouwd voor de volgende afspraak.",
          "De verhouding tussen stoelwerk, sterilisatie en balietaken verschilt sterk per praktijk. Vraag er in een sollicitatiegesprek expliciet naar — of kijk op mondzorgwerkt bij de werkzaamheden per vacature, waar praktijken dit vooraf benoemen.",
        ],
        lijst: [
          "Assisteren aan de stoel: afzuigen, aangeven van instrumenten en materialen, four-handed dentistry",
          "Behandelkamers voorbereiden en afbreken volgens het hygiëneprotocol",
          "Sterilisatie en instrumentenbeheer volgens de WIP-richtlijn",
          "Patiëntbegeleiding: uitleg geven, gerust stellen, nazorginstructies",
          "Röntgenopnames maken — uitsluitend bij aangetoonde bekwaamheid en onder verantwoordelijkheid van de tandarts",
          "Agenda- en baliewerk, meestal in roulatie met collega's",
        ],
      },
      {
        kop: "Opleiding: mbo of intern opgeleid",
        paragrafen: [
          "Tandartsassistent is geen wettelijk beschermd beroep; er zijn twee gangbare routes. De eerste is de mbo-opleiding Tandartsassistent (niveau 4), die je breed opleidt in assisteren, hygiëne en patiëntcommunicatie. De tweede route is intern: je start zonder mondzorgachtergrond en wordt door de praktijk opgeleid, vaak gecombineerd met een basiscursus.",
          "Praktijken op mondzorgwerkt geven per vacature aan wat de ondergrens is — bijvoorbeeld 'minimaal één jaar ervaring' als harde eis en 'röntgenbevoegdheid' als bespreekbare wens. Zo zie je vooraf of een vacature bij jouw startpunt past.",
        ],
      },
      {
        kop: "Röntgenbevoegdheid: wat houdt het in?",
        paragrafen: [
          "Het maken van röntgenopnames valt onder stralingsregelgeving. Als assistent maak je opnames onder verantwoordelijkheid van de tandarts, en alleen wanneer je daarvoor aantoonbaar bekwaam bent — meestal via een erkende cursus. Voor praktijken is dit een veelgevraagde plus: vacatures met röntgenbevoegdheid als wens zie je op het platform dan ook regelmatig, vaak met een hogere inschaling.",
        ],
      },
      {
        kop: "Doorgroeien: preventie, orthodontie of coördinatie",
        paragrafen: [
          "De meest gekozen vervolgstap is preventieassistent: met een aanvullend certificaat voer je zelfstandig eenvoudige preventiebehandelingen uit, zoals gebitsreiniging bij gezond tandvlees en poetsinstructie. Een tweede route is orthodontieassistent, waar je na interne opleiding zelfstandig bogen wisselt, scans maakt en trajecten begeleidt.",
          "Wie liever organiseert dan behandelt, groeit door richting coördinerende rollen: hoofdassistent, balie- of sterilisatiecoördinator, en uiteindelijk praktijkmanager. Kijk in vacatures naar signalen als 'interne opleiding' en 'specialisatietraject' onder ontwikkelmogelijkheden.",
        ],
      },
      {
        kop: "Hoe ziet een werkweek eruit?",
        paragrafen: [
          "Tandartsassistent is een van de flexibelste functies in de mondzorg: er zijn banen van 8 tot 36 uur per week, met of zonder avond- en zaterdagdiensten. Avond- en weekenduren worden doorgaans extra beloond. Op mondzorgwerkt staat de gevraagde werkweek per vacature in een dagenrooster, zodat je in één oogopslag ziet of het rooster bij jouw week past — bijvoorbeeld naast een studie of een tweede baan.",
        ],
      },
    ],
    bronperiode: BRONPERIODE,
    auteur: AUTEUR,
    actualisatiedatum: ACTUALISATIE,
    methodologie: [
      "Dit artikel is geschreven door de redactie van Mondzorgwerkt op basis van de mbo-kwalificatiedossiers voor tandartsassistenten, de gangbare praktijkindeling in Nederlandse mondzorgpraktijken en de eisen die praktijken in vacatures op het platform stellen.",
      "Regels rond röntgen en overige voorbehouden handelingen kunnen wijzigen; de tekst beschrijft het algemene kader en vervangt geen juridisch advies. Wij actualiseren dit artikel bij relevante wijzigingen.",
    ],
    gerelateerdeFuncties: ["tandartsassistent", "preventieassistent", "orthodontieassistent"],
    gerelateerdeRegios: [],
  },

  /* ----------------------- specialisaties/parodontologie ----------------------- */
  {
    slug: "parodontologie",
    pad: "/specialisaties/parodontologie",
    kortLabel: "Werken in de parodontologie",
    categorie: "specialisaties",
    categorieLabel: "Specialisaties",
    titel: "Werken in de parodontologie: wat het inhoudt en wie er werken",
    beschrijving:
      "Wat parodontologie is, hoe het paro-protocol werkt, welke rollen erin samenwerken en wat een parodontologie-vacature betekent voor jouw werkdag.",
    directAntwoord:
      "Parodontologie is het deelgebied van de mondzorg dat zich richt op het tandvlees en het steunweefsel van de tanden (het parodontium). Behandelteams bestaan uit tandartsen(-parodontologen), mondhygiënisten en preventieassistenten die samen het parodontale traject uitvoeren: screenen, behandelen, herbeoordelen en nazorg. Voor mondhygiënisten is parodontologie de meest gevraagde inhoudelijke verdieping op het platform.",
    secties: [
      {
        kop: "Wat is parodontologie?",
        paragrafen: [
          "Tandvleesontsteking begint onschuldig (gingivitis) maar kan zich ontwikkelen tot parodontitis: een ontsteking van het steunweefsel waarbij kaakbot verloren gaat en tanden uiteindelijk los kunnen komen te staan. Omdat dat proces grotendeels omkeerbaar is in een vroeg stadium — en onomkeerbaar in een laat stadium — draait parodontologie om systematisch vroeg opsporen en consequent behandelen.",
          "Parodontale gezondheid hangt bovendien samen met algemene gezondheid; onder meer bij diabetes is die wisselwerking klinisch relevant. Dat maakt het vak inhoudelijk breder dan 'tandvlees': je kijkt naar de hele patiënt, inclusief leefstijl en medische achtergrond.",
        ],
      },
      {
        kop: "Screening en het paro-protocol",
        paragrafen: [
          "Nederlandse praktijken screenen parodontale gezondheid systematisch tijdens periodieke controles, met een indexscore per sextant van het gebit (in de praktijk kom je zowel de oudere DPSI-score als het nieuwere PPS-model tegen). De score bepaalt het vervolg: van poetsinstructie en gebitsreiniging tot een volledig parodontaal traject.",
          "Dat traject — vaak kortweg 'het paro-protocol' — verloopt in vaste stappen: uitgebreid parodontaal onderzoek met pocketstatus, initiële behandeling (professionele reiniging van de wortels onder het tandvlees), herbeoordeling na enkele maanden, en daarna ofwel nazorg met vaste intervallen, ofwel opschaling naar chirurgische behandeling of verwijzing naar een parodontologiepraktijk.",
        ],
      },
      {
        kop: "Wie doet wat in het parodontale team?",
        paragrafen: [
          "Parodontologie is bij uitstek teamwerk over functieniveaus heen. Grofweg is de verdeling als volgt — al verschilt de precieze invulling per praktijk en per bevoegdheid:",
        ],
        lijst: [
          "Tandarts of tandarts-parodontoloog: diagnose, behandelplan, chirurgische behandelingen en de eindverantwoordelijkheid",
          "Mondhygiënist: het hart van het traject — pocketstatussen, initiële behandeling, herbeoordeling en nazorg in een eigen agenda",
          "Preventieassistent: gebitsreiniging bij lichte scores, poetsinstructie en ondersteuning van het recall-systeem",
          "Praktijkmanager of balieteam: het recall-beleid dat bepaalt of patiënten daadwerkelijk terugkomen — organisatorisch de sleutel tot resultaat",
        ],
      },
      {
        kop: "Wat betekent een parodontologie-vacature voor jouw werkdag?",
        paragrafen: [
          "Vacatures met de specialisatie parodontologie betekenen in de praktijk: langere behandeltijden per afspraak (45–60 minuten is gangbaar), een eigen patiëntenstam die je over langere tijd volgt, en meetbaar resultaat — pockets die ondieper worden, bloedingsscores die dalen. Voor veel mondhygiënisten is precies dat de reden om voor een praktijk met een serieus paro-spreekuur te kiezen.",
          "Let bij zulke vacatures op drie dingen: krijg je de behandeltijd die het protocol vraagt, is er een tandarts met affiniteit voor parodontologie om mee te overleggen, en wordt nazorg structureel ingepland. Apparatuur zoals ultrasone reinigers en AirFlow wordt per vacature op mondzorgwerkt vermeld onder apparatuur.",
        ],
      },
      {
        kop: "Verdieping en opleiding",
        paragrafen: [
          "Wie zich wil verdiepen kan terecht bij geaccrediteerde na- en bijscholing op het gebied van parodontologie, van klinische cursussen tot langere differentiatietrajecten. Voor tandartsen bestaat de erkenning tot tandarts-parodontoloog via de Nederlandse Vereniging voor Parodontologie (NVvP). Praktijken die opleiding serieus nemen, vermelden congresbudget of een specialisatietraject in hun vacatures — daar kun je op het platform gericht op filteren.",
        ],
      },
    ],
    bronperiode: BRONPERIODE,
    auteur: AUTEUR,
    actualisatiedatum: ACTUALISATIE,
    methodologie: [
      "Dit artikel is geschreven door de redactie van Mondzorgwerkt op basis van de gangbare Nederlandse paro-richtlijnen en -protocollen en de manier waarop praktijken op het platform parodontologie-vacatures invullen.",
      "Klinische richtlijnen (zoals de parodontale screeningsystematiek) worden periodiek herzien door de beroepsgroep; dit artikel beschrijft het algemene kader en vervangt geen klinische richtlijn. Actualisatie volgt wanneer de richtlijnen wijzigen.",
    ],
    gerelateerdeFuncties: ["mondhygienist", "tandarts", "preventieassistent"],
    gerelateerdeRegios: [],
  },

  /* --------------------- technologie/intra-orale-scanners --------------------- */
  {
    slug: "intra-orale-scanners",
    pad: "/technologie/intra-orale-scanners",
    kortLabel: "Intra-orale scanners in de praktijk",
    categorie: "technologie",
    categorieLabel: "Technologie",
    titel: "Intra-orale scanners: TRIOS, iTero, Primescan en CEREC in de praktijk",
    beschrijving:
      "Hoe intra-orale scanners de mondzorg veranderen, wat de verschillen tussen de systemen betekenen voor je werk en hoe je ermee leert werken.",
    directAntwoord:
      "Een intra-orale scanner maakt een digitale 3D-afdruk van het gebit en vervangt daarmee in veel gevallen de klassieke afdruklepel. Voor het team betekent dat een andere workflow: scannen, digitaal beoordelen en direct doorsturen naar het lab of de eigen freesmachine. Welk systeem een praktijk gebruikt (TRIOS, iTero, Primescan of CEREC) zie je op mondzorgwerkt per vacature onder apparatuur — ervaring ermee is vrijwel altijd bespreekbaar, geen harde eis.",
    secties: [
      {
        kop: "Wat doet een intra-orale scanner?",
        paragrafen: [
          "De scanner is een handstuk met een camera die duizenden beelden per seconde tot een nauwkeurig 3D-model van het gebit samenvoegt. Dat model is direct op het scherm te beoordelen — een onvolledige scan zie je meteen en scan je bij, waar een mislukte conventionele afdruk een nieuwe afspraak betekende.",
          "Voor patiënten is het comfortabeler (geen afdrukmateriaal, minder kokhalzen), voor het team is het vooral een kwaliteits- en communicatiemiddel: je laat de patiënt op het scherm zien wat er speelt, en het tandtechnisch lab ontvangt binnen minuten een exact digitaal model.",
        ],
      },
      {
        kop: "De systemen die je in vacatures tegenkomt",
        paragrafen: [
          "Op het platform worden vier scannersystemen het meest vermeld. De klinische basisvaardigheid — systematisch en volledig scannen — is bij alle vier hetzelfde; de verschillen zitten in workflow en ecosysteem:",
        ],
        lijst: [
          "TRIOS (3Shape): breed ingezet voor kroon- en brugwerk en implantologie, met uitgebreide software voor monitoring en communicatie met het lab",
          "iTero (Align Technology): sterk vertegenwoordigd in de orthodontie, onder meer door de directe koppeling met alignerbehandelingen en visualisatie van behandeluitkomsten",
          "Primescan (Dentsply Sirona): hogesnelheidsscanner die vaak wordt gekozen in praktijken met een digitale restauratieve workflow",
          "CEREC (Dentsply Sirona): meer dan een scanner — een chairside-systeem waarmee de praktijk restauraties zelf ontwerpt en freest, soms binnen één afspraak",
        ],
      },
      {
        kop: "Wat verandert er aan het werk?",
        paragrafen: [
          "Voor tandartsen verschuift het werk van afdrukken maken naar digitaal beoordelen en ontwerpen; bij chairside-systemen zoals CEREC komt daar het ontwerpen en afwerken van restauraties in eigen huis bij. Voor assistenten ontstaat een nieuwe kerntaak: het maken van kwalitatief goede scans wordt in veel praktijken aan de assistent gedelegeerd, inclusief het beheer van de digitale patiëntdossiers die eruit voortkomen.",
          "In de orthodontie is de scanner inmiddels de standaard voor aligner-trajecten; orthodontieassistenten die zelfstandig scannen zijn daar onmisbaar. En voor mondhygiënisten bieden scan-vergelijkingen door de tijd heen een sterk voorlichtingsmiddel: slijtage en gingivarecessie worden letterlijk zichtbaar voor de patiënt.",
        ],
      },
      {
        kop: "Moet je scannerervaring hebben om te solliciteren?",
        paragrafen: [
          "Meestal niet. In vacatures op mondzorgwerkt staat scannerervaring vrijwel altijd als 'bespreekbaar' — praktijken weten dat het systeemspecifieke deel in dagen tot weken is aan te leren, zeker met de trainingen die fabrikanten bij hun systemen leveren. Wat praktijken wél zoeken is digitale nieuwsgierigheid: de bereidheid om de workflow te leren en er in het team het beste uit te halen.",
          "Andersom is de scanner een goed signaal over de praktijk zelf: wie in deze apparatuur investeert, investeert doorgaans ook in behandelkwaliteit en ontwikkeling van het team. Filter op het platform op apparatuur om gericht bij hightech-praktijken te zoeken — of juist bewust bij praktijken die (nog) conventioneel werken.",
        ],
      },
    ],
    bronperiode: BRONPERIODE,
    auteur: AUTEUR,
    actualisatiedatum: ACTUALISATIE,
    methodologie: [
      "Dit artikel is geschreven door de redactie van Mondzorgwerkt op basis van publiek beschikbare productinformatie van de fabrikanten (3Shape, Align Technology, Dentsply Sirona) en de manier waarop praktijken op het platform apparatuur in vacatures vermelden.",
      "Mondzorgwerkt heeft geen commerciële relatie met scannerfabrikanten; systemen worden genoemd omdat ze in vacatures voorkomen, niet als aanbeveling. Productlijnen veranderen snel; details kunnen per softwareversie verschillen.",
    ],
    gerelateerdeFuncties: ["tandarts", "tandartsassistent", "orthodontieassistent"],
    gerelateerdeRegios: [],
  },

  /* ------------------------ salaris/tandartsassistent ------------------------ */
  {
    slug: "tandartsassistent",
    pad: "/salaris/tandartsassistent",
    kortLabel: "Salaris tandartsassistent (indicatie)",
    categorie: "salaris",
    categorieLabel: "Salaris",
    titel: "Salaris tandartsassistent: indicatieve bandbreedtes en wat je loon bepaalt",
    beschrijving:
      "Indicatieve salarisbandbreedtes voor tandartsassistenten, de factoren die je loon bepalen en hoe je vacatures op beloning vergelijkt — met methodologische toelichting.",
    directAntwoord:
      "Het salaris van een tandartsassistent in loondienst ligt — als indicatie, bij een voltijds dienstverband — grofweg tussen € 2.400 en € 3.300 bruto per maand, afhankelijk van ervaring, bevoegdheden en regio. Gespecialiseerde assistenten (preventie, orthodontie) en coördinerende rollen zitten aan de bovenkant van die bandbreedte of erboven. Dit zijn nadrukkelijk indicaties, geen cao-bedragen: lees de methodologie onderaan dit artikel.",
    secties: [
      {
        kop: "Indicatieve bandbreedtes per ervaringsniveau",
        paragrafen: [
          "Onderstaande bandbreedtes zijn een redactionele indicatie op basis van openbare vacature-informatie en de vacatures die praktijken op mondzorgwerkt publiceren (bruto per maand bij een voltijds dienstverband van 36–40 uur; parttime naar rato). Ze zijn bedoeld om vacatures te kunnen plaatsen, niet als toezegging of norm:",
        ],
        lijst: [
          "Startend (0–2 jaar, geen aanvullende bevoegdheden): indicatief € 2.400 – € 2.700",
          "Ervaren allround (2+ jaar, vaak met röntgenbevoegdheid): indicatief € 2.600 – € 3.200",
          "Gespecialiseerd (preventie- of orthodontieassistent): indicatief € 2.700 – € 3.400",
          "Coördinerend (hoofdassistent, aansturing team): indicatief € 3.000 – € 3.600",
        ],
      },
      {
        kop: "Er is geen algemeen verbindende cao — wat betekent dat?",
        paragrafen: [
          "Voor tandartspraktijken geldt geen algemeen verbindend verklaarde cao. Veel praktijken volgen vrijwillig een arbeidsvoorwaardenregeling met functieschalen en periodieken (zoals de door de beroepsvereniging gepubliceerde modelregeling), maar dat is een keuze per werkgever. Twee identieke functies bij twee praktijken kunnen daardoor verschillend betalen.",
          "Praktisch gevolg: vraag bij een sollicitatie altijd welke regeling of schaal de praktijk hanteert, hoe periodieken werken en wat er geldt voor vakantiegeld, eindejaarsuitkering en pensioen. Op mondzorgwerkt tonen praktijken de salarisbandbreedte per vacature; die zichtbare bandbreedte is leidend boven elke indicatie in dit artikel.",
        ],
      },
      {
        kop: "Wat bepaalt waar je in de bandbreedte zit?",
        paragrafen: [
          "De grootste loonverschillen tussen assistenten met vergelijkbare ervaring zijn terug te voeren op een handvol factoren:",
        ],
        lijst: [
          "Bevoegdheden: aantoonbare röntgenbekwaamheid en preventiecertificaten verhogen de inschaling vrijwel altijd",
          "Specialisatie: orthodontie- en implantologie-ervaring is schaars en wordt navenant beloond",
          "Regio en arbeidsmarkt: in gebieden met veel onvervulde vacatures liggen aanbiedingen hoger",
          "Roostertoeslagen: avond- en zaterdagdiensten kennen doorgaans een toeslag — relevant als je bewust buiten kantoortijden werkt",
          "Praktijkgrootte en rolinhoud: coördinerende taken en aansturing tellen mee in de schaal",
        ],
      },
      {
        kop: "Zo vergelijk je vacatures op beloning",
        paragrafen: [
          "Vergelijk nooit alleen het maandbedrag. Een vacature met een iets lager bruto salaris maar structurele opleidingsruimte, reiskostenvergoeding en een rooster dat exact bij je week past, kan per saldo de betere baan zijn. Zet bij het vergelijken drie dingen naast elkaar: het uurloon (maandbedrag gedeeld door contracturen), de toeslagen voor jouw specifieke rooster, en wat de praktijk aantoonbaar in ontwikkeling investeert.",
          "Op mondzorgwerkt staan uren, werkdagen en salarisbandbreedte per vacature bij elkaar, zodat die vergelijking in één oogopslag kan.",
        ],
      },
    ],
    bronperiode: BRONPERIODE,
    auteur: AUTEUR,
    actualisatiedatum: ACTUALISATIE,
    methodologie: [
      "BELANGRIJK — dit zijn indicaties. De genoemde bandbreedtes zijn door de redactie samengesteld op basis van openbare vacature-informatie en de salarisbandbreedtes die praktijken op mondzorgwerkt publiceren (bronperiode: juli 2026). Ze zijn géén cao-bedragen, géén rechtens afdwingbare norm en géén advies over wat jij zou moeten verdienen of bieden.",
      "Individuele aanbiedingen kunnen — legitiem — buiten deze bandbreedtes vallen. De zichtbare salarisbandbreedte op een concrete vacature is altijd leidend boven dit artikel.",
      "Zodra het market-insights read-model van het platform voldoende gepubliceerde vacatures omvat, vervangen we deze redactionele indicaties door geaggregeerde platformdata met vermelding van steekproefgrootte en peildatum.",
    ],
    gerelateerdeFuncties: ["tandartsassistent", "preventieassistent", "orthodontieassistent"],
    gerelateerdeRegios: [],
  },

  /* -------------------- arbeidsmarkt/mondhygienist/utrecht -------------------- */
  {
    slug: "mondhygienist/utrecht",
    pad: "/arbeidsmarkt/mondhygienist/utrecht",
    kortLabel: "Arbeidsmarkt mondhygiënist — Utrecht",
    categorie: "arbeidsmarkt",
    categorieLabel: "Arbeidsmarkt",
    titel: "Arbeidsmarkt voor mondhygiënisten in Utrecht",
    beschrijving:
      "Hoe de arbeidsmarkt voor mondhygiënisten in de regio Utrecht ervoor staat: kwalitatief beeld, wat het betekent voor kandidaten en praktijken, en welke cijfers hier komen zodra platformdata beschikbaar is.",
    directAntwoord:
      "De arbeidsmarkt voor mondhygiënisten is in vrijwel heel Nederland krap, en de regio Utrecht — met een grote bevolkingsdichtheid én een eigen hbo-opleiding Mondzorgkunde — vormt daarop geen uitzondering: praktijken concurreren om beschikbare uren. Concrete regionale cijfers publiceren we hier uitsluitend indicatief en op basis van platformdata zodra die beschikbaar is; tot die tijd is dit een kwalitatief redactioneel beeld.",
    secties: [
      {
        kop: "Hoe je deze pagina moet lezen",
        paragrafen: [
          "Mondzorgwerkt verzint geen arbeidsmarktcijfers. Zolang het market-insights read-model van het platform (geaggregeerde, geanonimiseerde vraag- en aanbodcijfers per functie en regio) nog niet publiceert, vind je op deze pagina een kwalitatief beeld met duidelijke bronvermelding. Zodra de platformdata er is, verschijnen hier indicatieve cijfers — altijd gemarkeerd als 'indicatief, gebaseerd op platformdata' en met peildatum en steekproefomvang erbij.",
        ],
      },
      {
        kop: "Het beeld in de regio Utrecht",
        paragrafen: [
          "Landelijk is het beeld al jaren consistent: er zijn meer vacature-uren voor mondhygiënisten dan er beschikbare mondhygiënisten zijn, en dat tekort is structureel van aard. De regio Utrecht heeft daarbij twee bijzonderheden. Ten eerste een hoge dichtheid aan praktijken — van solopraktijken in de wijken tot grote groepspraktijken en verwijspraktijken. Ten tweede de aanwezigheid van een hbo-opleiding Mondzorgkunde in de stad, waardoor er jaarlijks nieuwe professionals in de regio instromen die er relatief vaak ook blijven werken.",
          "Per saldo betekent dit: veel keuze en onderhandelingsruimte voor mondhygiënisten, en voor praktijken de noodzaak om zich met meer dan alleen salaris te onderscheiden — behandeltijden, vakinhoudelijke ruimte, roosterflexibiliteit en ontwikkelbudget wegen zichtbaar mee.",
        ],
      },
      {
        kop: "Wat betekent dit voor jou als mondhygiënist?",
        paragrafen: [
          "In een krappe markt is niet de vraag óf je een baan vindt, maar welke baan echt bij je week en je vakopvatting past. Drie praktische adviezen:",
        ],
        lijst: [
          "Begin bij je week, niet bij de vacaturetekst: bepaal welke dagen en uren je wilt werken en filter daarop — in deze regio is dat een realistische eis",
          "Weeg vakinhoud expliciet mee: behandeltijd per afspraak, een eigen patiëntenstam en ruimte voor het paro-spreekuur maken het verschil op de lange termijn",
          "Vergelijk contractvormen bewust: zowel loondienst als zzp komt in de regio veel voor; reken beide scenario's door voordat je kiest",
        ],
      },
      {
        kop: "Wat betekent dit voor praktijken in Utrecht?",
        paragrafen: [
          "Voor praktijken in de regio is de vijver klein en de concurrentie zichtbaar. Wat in de praktijk werkt: vacatures die de werkweek concreet maken (welke dagen, welke behandeltijden, welke patiëntenstam), zichtbaar maken waar de praktijk inhoudelijk voor staat, en snel en persoonlijk reageren op belangstelling. Een mondhygiënist die drie dagen zoekt en er maar twee aangeboden krijgt, is in deze regio binnen een week elders in gesprek.",
        ],
      },
      {
        kop: "Cijfers: wat hier komt te staan",
        paragrafen: [
          "Zodra het market-insights read-model publiceert, tonen we hier per kwartaal indicatieve regiocijfers: het aantal openstaande vacature-uren voor mondhygiënisten in de regio Utrecht, de mediane gevraagde werkdagen, de verhouding loondienst/zzp in vacatures en de gemiddelde publicatieduur tot vervulling. Alle cijfers krijgen een peildatum, een steekproefomvang en het label 'indicatief, gebaseerd op platformdata' — omdat platformdata per definitie alleen het platform beschrijft, niet de hele markt.",
        ],
      },
    ],
    bronperiode: BRONPERIODE,
    auteur: AUTEUR,
    actualisatiedatum: ACTUALISATIE,
    methodologie: [
      "Deze pagina bevat bewust géén concrete regionale arbeidsmarktcijfers: het market-insights read-model van mondzorgwerkt publiceert nog niet, en cijfers uit andere bronnen zouden hier zonder context een eigen leven gaan leiden. Het kwalitatieve beeld is gebaseerd op het landelijk bekende, structurele tekort aan mondhygiënisten en op kenmerken van de regio (praktijkdichtheid, aanwezigheid van de hbo-opleiding Mondzorgkunde).",
      "Zodra platformdata beschikbaar is, worden cijfers hier uitsluitend indicatief gepresenteerd — met peildatum, steekproefomvang en de kanttekening dat platformdata alleen vacatures en profielen op mondzorgwerkt beschrijft, niet de totale markt.",
    ],
    gerelateerdeFuncties: ["mondhygienist"],
    gerelateerdeRegios: ["Utrecht"],
  },
];

/* --------------------------------- helpers -------------------------------- */

/** Alle artikelen binnen één categorie. */
export function artikelenInCategorie(
  categorie: KennisArtikel["categorie"],
): KennisArtikel[] {
  return KENNIS_ARTIKELEN.filter((a) => a.categorie === categorie);
}

/** Vind een artikel op categorie + slug; null bij onbekende slug (→ 404). */
export function vindArtikel(
  categorie: KennisArtikel["categorie"],
  slug: string,
): KennisArtikel | null {
  return (
    KENNIS_ARTIKELEN.find(
      (a) => a.categorie === categorie && a.slug === slug,
    ) ?? null
  );
}

/** De overige artikelen, voor het "verder lezen"-blok (interne links). */
export function andereArtikelen(huidige: KennisArtikel): KennisArtikel[] {
  return KENNIS_ARTIKELEN.filter((a) => a.pad !== huidige.pad);
}
