# Aktieanalys & beslutsstöd — planförbättringar & implementeringsstatus (v2)

*Komplement till den ursprungliga projektplanen. Detta dokument (1) skärper planen på tio
punkter, (2) korrigerar ett sakfel, och (3) kartlägger vad som faktiskt byggts (P0–P2) mot
planens avsnitt. Verktyg för eget bruk i lärosyfte — inte finansiell rådgivning.*

> **Grundprincipen står fast:** appen ska göra dig till en mer systematisk beslutsfattare,
> inte förutsäga vinnare. En backtest som ser lysande ut är skyldig tills motsatsen bevisats.

---

## Del A — Förbättringar på planen (1–10) + en korrigering

För varje punkt: **förbättringen**, **varför**, och **status** i kodbasen.

### 1. Benchmark ska vara total-avkastning, inte prisindex
**Förbättring:** Jämför strategin mot ett **total-avkastningsindex (OMXSGI)**, inte prisindexet
OMXSPI, *när* strategin återinvesterar utdelningar. En strategi som jämförs mot ett prisindex
"slår index" delvis på utdelningar du inte räknat bort (~2–4 %/år) — ett tyst, vanligt fel.
**Varför:** Äpplen-mot-äpplen. Prisavkastande strategi → prisindex; total-avkastande → OMXSGI.
**Status: i allt väsentligt åtgärdad, med dokumenterad asymmetri.** Backtest-motorn
(`supabase/functions/run-backtest/index.ts`) använder **OMXSPI som primär** (äpplen-mot-äpplen,
eftersom strategin är prisavkastande utan utdelningsåterinvestering) och hämtar **OMXSGI som
striktare sekundär ribba** (flaggat i `metrics.note` att den inkluderar utdelningar strategin
inte tjänar). Paper-portföljens benchmark (`paper-snapshot`) använder ännu OMXSPI.
**Återstår:** låt paper-benchmark växla till OMXSGI, och/eller gör strategin total-avkastande
(utdelningsåterinvestering) så att OMXSGI blir den naturliga primära ribban.

### 2. Point-in-time gäller särskilt *fundamenta* — kalla ut det explicit
**Förbättring:** Den svåra point-in-time-fällan är inte pris (lätt) utan **fundamenta**:
rapportdatum vs *offentliggörandedatum*, och restatements. Regel: *använd aldrig ett bokslut
före det datum det offentliggjordes, och frys siffrorna som de var då.*
**Varför:** Appen hade redan trillat i fällan — fundamenta skrevs som en överskrivande
JSONB-blob utan as-of-datum, vilket ger lookahead i all backtest.
**Status: åtgärdad (lagring).** Ny append-only-tabell `fundamentals_snapshots`
(`as_of`, `report_date`, `fundamentals` jsonb, unik per symbol/as_of/källa) i migration
`20260601100000_pit_fundamentals.sql`; `fetch-fundamentals` skriver en daterad snapshot per
hämtning (den gamla metadata-bloben behålls för bakåtkompatibilitet).
**Återstår:** låt *konsumenterna* (backtest, screening) läsa `fundamentals_snapshots` **as-of
rebalansdatum** i stället för senaste värdet. Idag är priserna point-in-time i backtesten men
fundamenta läses ännu "senaste". (Momentum-backtesten är opåverkad — den är prisbaserad.)

### 3. Princip: *en* kanonisk pipeline / single source of truth
**Förbättring:** Lägg till en uttalad arkitekturprincip: **det som visas, handlas, backtestas
och lärs på måste komma från samma persisterade data.**
**Varför:** Den största praktiska risken var datateknik, inte modellval — tre divergerande
analysvägar (13-modulers front-end som *inte* sparas, 6-modulers edge som persisteras, samt en
orphanad "B1"-väg) och överskrivande cacher.
**Status: delvis åtgärdad.** B1-vägen är deprecation-markerad; edge-pipelinens hårdkodade
`NEUTRAL`-makro är ersatt med riktig makro (`generate-signals`), så 20 % av signalvikten inte
längre slösas på en konstant; stale-pris-buggen (rankade på ~200 dagar gamla priser) är lagad.
**Återstår:** den kvarvarande klyftan mellan den rikare front-end-motorn (13 moduler) och den
persisterade edge-motorn (6 moduler) — antingen lyft edge till paritet eller persistera
front-end-resultatet. Bör vara nästa arkitektoniska steg.

### 4. Skärp "LLM:n får inte förutsäga pris"
**Förbättring:** Förtydliga gränsen: **scenarioband med explicit osäkerhet och sannolikhet att
slå index över en horisont är OK; punktmål och "förväntad avkastning %" är det inte.**
**Varför:** Regeln är annars antingen ignorerad eller övertolkad. Appen bryter idag mot
grundprincipen: `ai-analysis` returnerar `predictedReturn` och `price_targets {bear/base/bull}`,
och `engine.ts` (`calculateCalibratedReturns`) ger förväntad %-rörelse per horisont.
**Status: rekommendation (ej ändrad — ditt beslut).** Detta är en beteende-/UX-förändring som
du kan ha åsikter om (du kanske *vill* ha prognoserna). Rekommenderad åtgärd om du vill följa
principen: presentera utfall som **band med osäkerhet** (p10/p90 finns redan) och en
**sannolikhet att slå index**, och nedtona/ommärk punktprognoser. Säg till så genomför jag det.

### 5. Kvarts-Kelly förutsätter ett edge-estimat — gör beroendet explicit
**Förbättring:** Skriv in i §5 att **ingen Kelly-sizing sker innan en kalibrerad edge finns**
(trovärdig vinstsannolikhet/payoff) — och den fås bara ur backtesten + kalibreringen.
**Varför:** Annars storlekssätter du på brus; överskattad edge översizar och riskerar ruin.
**Status: åtgärdad.** `quarterKellySize()` i `src/lib/strategy/engine.ts` implementerar
kvarts-Kelly med ett hårt 25 %-tak och en framträdande dokumenterad varning om att
`winProb`/`payoffRatio` måste komma från backtest/kalibrering, annars använd fast-fraktionell
sizing. Även `volatilityTargetSize()` tillagd som icke-edge-beroende alternativ.

### 6. Survivorship-fri Norden-data är dyrt/svårt — var ärlig, snapshotta framåt
**Förbättring:** Erkänn att avnoterad/konkursad nordisk historik är svår att köpa. Pragmatiskt
alternativ: **börja snapshotta index-/universmedlemskap point-in-time *framåt* från idag**, så
du om 12–24 mån har en survivorship-korrekt levande databas.
**Varför:** `fetch-sp500` ger bara dagens konstituenter (survivorship bias), vilket UI:t t.o.m.
varnar för. Det går inte att "toggla på" historik som inte finns.
**Status: delvis / rekommendation.** `fundamentals_snapshots` ger point-in-time-fundamenta
framåt. Den nya data-QA-funktionen (punkt 10) snapshottar dataläget. **Återstår:** en explicit
nattlig snapshot av *universmedlemskap* (vilka tickers som var aktiva/likvida vid varje datum).

### 7. Marknadsimpact är ~noll för dig på likvida large caps — överbygg inte
**Förbättring:** För ett privatkonto i OMXS30-namn är marknadspåverkan försumbar; det är
**spread + courtage** (och i ISK: ingen reavinstskatt) som styr. Behåll impact-modellen för
fas 3 (small cap), men i fas 1 räcker spread + courtage.
**Status: åtgärdad/medveten.** Kostnadsgrinden och backtestens kostnadsmodell
(`expectedMoveSurvivesCosts`, `run-backtest`) använder **slippage_bps + commission_bps + fast
courtage** — ingen separat impact-term. Korrekt avgränsning för likvida large caps; lägg till
impact först när small cap/First North (fas 3) införs.

### 8. Definiera *kill-kriterier* statistiskt
**Förbättring:** "Slår den inte OMXS30 har den inget värde" — bra, men sätt ribban: **hur många
månaders paper trading och vilken signifikans?** En strategi kan slå index på ren tur i 6 mån.
Föreslå: minst N månaders paper + positiv informationskvot med rimligt konfidensintervall,
annars förkasta.
**Status: stödd, formell regel rekommenderas.** Backtesten rapporterar `beat_benchmark`,
`excess_return_pct` och `information_ratio`; beslutsdagboken + kalibreringen mäter utfall över
tid. **Återstår:** en uttalad, kodad kill-regel (t.ex. tröskel på IR/antal perioder) och en
"förkasta strategi"-signal i UI.

### 9. Regimdetektering är själv overfitting-känslig
**Förbättring:** Behandla inte regim som en ren fördel. Regimmodeller laggar och kurvanpassas
lätt; håll dem **enkla** (t.ex. 200-dagars MA + volatilitetströskel) och **out-of-sample**-
validera dem som vilken signal som helst.
**Status: åtgärdad.** `src/lib/analysis/regime.ts` använder avsiktligt **runda, publicerade
trösklar** (200-dagars MA-trend + 60-dagars volatilitetspercentil), är *inte* intrimmad mot
in-sample-träffsäkerhet, och behandlas som en mjuk prior — `tiltWeightsForRegime` nudgar bara
vikterna några punkter och nollar aldrig en modul. Overfitting-varningen är dokumenterad i filen.

### 10. Lägg till ett data-kontrakt / QA-steg i §3
**Förbättring:** Inför ett explicit dataintegritetslager innan data når signallagret:
sanity-checks (inga framtida datum, inga >X % dagshopp utan split, inga icke-positiva priser,
ingen för gammal data, källspårning).
**Varför:** Givet stale-pris-buggen och muterande korsvalidering behövs ett skyddsnät.
**Status: åtgärdad (denna fas).** Ny `validate-data`-funktion + tabell `data_quality_issues`
flaggar future-date/implausible-jump/nonpositive-price/stale/no-data, körs nattligt
(icke-fatalt) och visas i admin-panelen. Läsande validering — muterar aldrig `price_history`.

### 11. (KORRIGERING) Skattemetoden är *genomsnittsmetoden*, inte FIFO
**Korrigering:** Planen (§8) angav **FIFO** för skattemotorn. Det är **fel för svensk depå-
beskattning.** Svensk lag (Inkomstskattelagen 48 kap. 7 §) beräknar en akties omkostnadsbelopp
med **genomsnittsmetoden** (vägt snitt av allt innehav), med **schablonmetoden** (48 kap. 15 §:
omkostnadsbelopp = 20 % av försäljningspriset, endast marknadsnoterade aktier) som tillåtet
alternativ. FIFO används i bl.a. USA, inte i Sverige, och hade gett felaktiga K4-siffror.
**Status: åtgärdad korrekt.** `src/lib/tax.ts` implementerar genomsnittsmetoden + schablon­metoden
(väljer den med lägst skatt), schablonskatt för ISK/KF, och K4-sammanställning. Paper-portföljen
förde redan vägd snittkostnad — vilket *är* genomsnittsmetoden — så ingen riskabel FIFO-omskrivning
behövdes. (Bonus: en konkret poäng för svenskt fokus — den korrekta metoden var redan på plats.)

---

## Del B — Implementeringsstatus (plan → kod)

Vad som levererats i P0–P2 (commits på grenen `claude/gifted-mendel-gS4yF`, PR #15).
Status: ✅ klart · 🟡 delvis · ⬜ återstår.

| Planavsnitt | Funktion | Status | Var (urval) |
|---|---|---|---|
| §3 Lagring | Point-in-time-fundamenta (append-only) | ✅ | `fundamentals_snapshots`, `fetch-fundamentals` |
| §3 Lagring | Stale-pris-bugg lagad; riktig makro i edge | ✅ | `generate-signals` |
| §3 Lagring | B1-dubblettpipeline deprecation-markerad | 🟡 | `ingest-prices`/`build-features`/`run-rank`/`score-outcomes` |
| §3 Likviditet | ADV + `is_liquid` + likviditetsfilter | ✅ | `compute-liquidity`, `symbols.*`, `strategy-evaluate` |
| §3 QA | Data-kvalitetslager (sanity-checks) | ✅ | `validate-data`, `data_quality_issues` |
| §4 Screening | Piotroski F-score, Altman Z, Magic Formula | ✅ | `src/lib/analysis/screening.ts`, Screener |
| §4 Teknisk | Momentum/MA/MACD/RSI/Bollinger/ATR | ✅ (sedan tidigare) | `src/lib/analysis/*` |
| §4 Regim | Marknadsregim (bull/björn/sidledes) + vikt-tilt | ✅ | `src/lib/analysis/regime.ts` |
| §4 Kostnad | Kostnadsgrind vid signalgenerering | ✅ | `engine.ts`, `strategy-evaluate` |
| §4 DCF / EV/EBITDA / Fama-French / GARCH / ML | — | ⬜ | (ej byggt; se Del C) |
| §5 Sizing | Vol-target + kvarts-Kelly (med edge-varning) | ✅ | `src/lib/strategy/engine.ts` |
| §5 Riskramar | `max_open_pos` + `max_sector_pct` *enforced* | ✅ | `strategy-evaluate` |
| §5 Korrelation | Korrelationsmatris + "samma vad"-varning | ✅ | `useCorrelation`, `CorrelationPanel` |
| §5 VaR / max drawdown (portfölj) | — | ⬜ | (ej byggt) |
| §6 LLM | Tes (bear/bull-input) inkopplad + visad | 🟡 | `analyze-thesis`, `CandidateDetailModal` |
| §6 LLM | Pre-mortem; läsning av kvartalsrapporter | ⬜ | (ej byggt) |
| §6 LLM | Slutar förutsäga pris (scenarioband) | ⬜ | se A·4 |
| §7 Backtest | Point-in-time momentum vs OMXS + kostnader | ✅ | `run-backtest`, `StrategyBacktestPanel` |
| §7 Benchmark | OMXSPI primär + OMXSGI sekundär; "slog index?" | ✅ | `run-backtest` |
| §7 Survivorship | Avnoterad/konkurs-historik | 🟡 | se A·6 |
| §7 Walk-forward / OOS | — | 🟡 | parameterfri (ej intrimmad) — formell WF återstår |
| §8 Paper trading | Riktiga priser, avgifter, equity-kurva, benchmark-linje | ✅ | `paper-trade`, `paper-snapshot`, `PaperPortfolioPage` |
| §8 Beslutsdagbok | Tes + beslut + utfall | ✅ | `decision_journal`, "Dagbok"-flik |
| §8 Skattemotor | ISK/KF/depå, schablonskatt, K4, genomsnittsmetoden | ✅ | `src/lib/tax.ts`, "Skatt"-flik |
| §8 Alerts | Bevakningstes + stop-loss + "tesen bruten"; utdelningar | ✅ | `watchlist_cases.*`, `WatchlistCard`, `fetch-events` |
| §8 Benchmark-vy | Portfölj vs OMXS, alltid synlig | ✅ | `paper-snapshot` + graf |

---

## Del C — Återstående (rekommenderade nästa steg, prioriterad)

1. **Konsumera point-in-time-fundamenta i backtest/screening** (A·2): läs `fundamentals_snapshots`
   *as-of* rebalansdatum. Detta låser upp en ärlig **F-score + momentum**-backtest (planens MVP-steg).
2. **Konsolidera pipelinen** (A·3): lyft edge-motorn till paritet med front-end (eller persistera
   front-end-resultatet) — så visning = handel = inlärning.
3. **Universmedlemskap point-in-time framåt** (A·6) + på sikt avnoterad historik → äkta
   survivorship-korrekt backtest (planens §7-dödssynd #2).
4. **Total-avkastning genomgående** (A·1): utdelningsåterinvestering i strategin + OMXSGI som primär.
5. **Kodad kill-regel** (A·8): IR-/signifikanströskel som flaggar "förkasta strategi" i UI.
6. **LLM-scenarioband** (A·4): ersätt punktprognoser med band + sannolikhet-att-slå-index — *ditt beslut*.
7. **Djupare modeller** (§4): DCF/intrinsiskt värde, EV/EBITDA & P/S peer-relativt, Fama-French-faktorer,
   GARCH-volatilitetsprognos, gradient boosting för *rankning*. Bygg först när det enkla bevisats slå index.
8. **Portföljrisk: VaR + max drawdown-broms**; pre-mortem & rapport-/transkriptläsning i LLM-lagret.

> **Byggordningens lärdom:** appen byggdes i bredd före djup. Med P0–P2 finns nu ärlighetslagret
> (backtest, point-in-time, kostnader, likviditet, dagbok, kalibrering). Nästa kliv bör vara att
> *bevisa* att F-score + momentum slår OMXSGI i en ärlig, point-in-time backtest **innan** mer
> avancerade modeller byggs — precis som planens §9 föreskriver.
