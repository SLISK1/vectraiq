
# Fix: Riktig data för match-analys

## Rotorsak

`fetch-matches` sparar bara grundläggande matchinfo och försöker scrapa en hårdkodad `goal.com`-URL som alltid returnerar 404. Ingen H2H, ingen lagform, inga tabellpositioner skickas vidare till AI:n — som då tvingas gissa och väljer "oavgjort 33%".

Tre konkreta luckor att täppa:

1. **Football-Data.org utnyttjas knappt** — API:t erbjuder H2H, standings, och team-stats men inget av det hämtas
2. **Firecrawl scrape = fel strategi** — hårdkodade `goal.com`-preview-URLer fungerar aldrig; rätt strategi är Firecrawl Search med lagnamnets termer
3. **`analyze-match` gör ingen extra datahämtning** — den litar helt på vad `source_data` råkar innehålla sedan `fetch-matches` kördes

---

## Ändringar: `supabase/functions/fetch-matches/index.ts`

**Ny datahämtning per match från Football-Data.org:**

För varje match hämtas även:

```
GET /v4/matches/{matchId}/head2head?limit=5
→ Senaste 5 möten lag A vs lag B
→ Vinster/förluster/oavgjorda räknas
→ Spara i source_data.h2h

GET /v4/competitions/{compCode}/standings?season=2025
→ Hemmalagets position, form, mål, poäng
→ Bortalagets position, form, mål, poäng
→ Spara i source_data.standings (hemma + borta rad)
```

Football-Data.org gratis-tier tillåter 10 req/min. Lägg in `sleep(6000ms)` mellan match-iterationer, eller batcha med 10 matcher per körning.

**Ersätt Firecrawl scrape med Firecrawl Search:**

Nuläge (fungerar aldrig):
```
URL: https://www.goal.com/en/match/real-sociedad-vs-real-oviedo/preview
→ 404
```

Ersätts med:
```
Firecrawl Search API:
POST https://api.firecrawl.dev/v1/search
{
  "query": "Real Sociedad vs Real Oviedo La Liga 2026 preview prediction",
  "limit": 3,
  "scrapeOptions": { "formats": ["markdown"] }
}
→ Returnerar relevanta artiklar från nätet med innehåll
→ Spara i source_data.scraped_articles[]
```

Dessutom: **Lägre Firecrawl-budget** (3 sökningar per match, max 10 matcher/dag = 30 req) — Firecrawl Search förbrukar färre credits än scrape.

---

## Ändringar: `supabase/functions/analyze-match/index.ts`

**Hämta rik data direkt i analyze-match:**

Eftersom `source_data` kan vara gammal (matcher hämtades för dagar sedan), ska `analyze-match` alltid göra egna live-anrop för att komplettera:

```
1. Läs match från DB → hämta external_id (football-{id})
2. Extrahera Football-Data.org match-ID ur external_id
3. GET /v4/matches/{id}/head2head?limit=10
   → Spara h2h-statistik i prompten
4. GET /v4/competitions/{compCode}/standings
   → Hitta hem/borta-lagets position och form
5. Kör GNews search för matchen (om GNEWS_API_KEY finns)
6. Kör Firecrawl Search för matchen (om FIRECRAWL_API_KEY finns)
```

Allt sammansätts i en strukturerad prompt med faktiska siffror:

```
H2H (senaste 5 möten):
- Real Sociedad 2-0 Real Oviedo (2024-11-03)
- Real Oviedo 1-1 Real Sociedad (2024-04-21)
→ Real Sociedad 2V, 1O, 2F i H2H

STANDINGS (La Liga 2025):
Real Sociedad: Plats 8, 34 poäng, Form: WDLWW
Real Oviedo: Plats 18, 22 poäng, Form: LLLWD

RECENT FORM (senaste 5):
Real Sociedad: W(2-0), D(1-1), L(0-2), W(3-1), W(1-0)
Real Oviedo: L(1-3), L(0-2), W(2-1), D(1-1), L(0-1)
```

**Förbättrad prompt till Gemini:**

Prompten byggs dynamiskt med all tillgänglig data och instruerar AI:n:
- Beräkna Poisson-sannolikheter baserat på goals scored/conceded per match
- Vikta tabellposition + form + H2H
- Sätt confidence baserat på datakvalitet

---

## Confidence-capping justering

Ny logik:

| Datasituation | Cap |
|---|---|
| H2H >= 5 + standings + form | 80 |
| H2H >= 3 + standings | 70 |
| Standings men ingen H2H | 65 |
| Bara football-data.org (inga stats) | 55 |
| Inga källor alls | 45 |

---

## Filer som ändras

| Fil | Ändring |
|---|---|
| `supabase/functions/fetch-matches/index.ts` | Lägg till H2H + standings per match, ersätt Firecrawl scrape med Firecrawl Search |
| `supabase/functions/analyze-match/index.ts` | Hämta live H2H + standings + GNews + Firecrawl Search i analyze-steget, bygg strukturerad prompt med faktiska siffror |

Secrets som redan finns och används: `FOOTBALL_DATA_API_KEY`, `FIRECRAWL_API_KEY`, `GNEWS_API_KEY`
