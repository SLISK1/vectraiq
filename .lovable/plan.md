

## Fix: Aktivera nyhetsdata och Firecrawl for aktieanalys

### Problem
- **Ingen automatisk nyhetshämtning**: `fetch-news` saknar cron-jobb, sa `news_cache` ar gammal/tom
- **Firecrawl avstängt**: Medvetet borttaget fran sentiment-analysen for att spara API-budget
- **Resultat**: Sentimentmodulen ger nastan alltid "neutral basestimering" istallet for faktiska nyhetsbaserade signaler

### Losning (3 delar)

#### 1. Cron-jobb: Hamta nyheter automatiskt
Lagg till ett dagligt cron-jobb som kor `fetch-news` tva ganger per dag (morgon + kvall):
- **08:00 UTC** och **18:00 UTC**
- Hamtar GNews-artiklar for alla aktiva symboler
- Haller `news_cache` farskt (max 6 timmar gammalt)

SQL:
```text
SELECT cron.schedule('fetch-news-morning', '0 8 * * *', $$ ... fetch-news ... $$);
SELECT cron.schedule('fetch-news-evening', '0 18 * * *', $$ ... fetch-news ... $$);
```

#### 2. Aktivera Firecrawl for sentiment (budgetsakert)
Uppdatera `ai-analysis` edge function:
- Ateraktivera Firecrawl-sokning i `sentiment`-typen, men med begransning:
  - Max 1 sokning per sentiment-anrop (istallet for 5 i deep_analysis)
  - Begransat till `limit: 2` resultat
  - Enbart for aktier och krypto (inte metaller, dar det ger lite)
- Uppdatera system-prompten sa AI:n far bade nyheter fran `news_cache` OCH Firecrawl-snippets

Uppskattad budget-paverkan: ca 10-15 extra Firecrawl-sokningar/dag (inom gratis-nivaens 30/dag).

#### 3. Forbattra sentiment-prompten
Uppdatera prompten i `ai-analysis` for sentiment-typen:
- Ge AI:n tydligare instruktioner att vikta faktiska nyheter tungt
- Inkludera Firecrawl-resultaten som "extern marknadsanalys"
- Krav pa att referera till specifika kallor i evidence-arrayen

### Tekniska detaljer

**Filer som andras:**
- `supabase/functions/ai-analysis/index.ts` -- ateraktivera Firecrawl i sentiment-caset, uppdatera prompt

**Databasandringar:**
- 2 nya cron-jobb via SQL-migrering (fetch-news morgon + kvall)

**Ingen andringar i:**
- Frontend (sentimentmodulen laser redan AI-resultatet korrekt)
- `fetch-news` edge function (fungerar redan, bara saknar cron-trigger)

### Implementationsordning
1. SQL-migrering: skapa 2 cron-jobb for `fetch-news`
2. Uppdatera `ai-analysis`: ateraktivera Firecrawl i sentiment med budgetgrans
3. Deploya `ai-analysis`
4. Verifiera att nyheter borjar floda in i `news_cache`

