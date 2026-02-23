

# Firecrawl-budgetmätare på aktiesidan

## Översikt

Lägger till en visuell budgetmätare på dashboard-sidan (aktie-fliken) identisk med den på betting-sidan, plus backend-spårning av Firecrawl-anrop i `ai-analysis`.

Idag saknas all spårning på aktiesidan -- `ai-analysis` anropar Firecrawl utan att räkna. Betting-sidan lagrar redan sin budget i `betting_matches`-tabellen med `external_id = budget-fc-{date}`.

## Budget-uppdelning

Total Firecrawl-gräns: 30 sökningar/dag, uppdelat:
- **15 för aktier** (ai-analysis sentiment)
- **15 för betting** (fetch-matches + analyze-match)

## Plan

### 1. Ny budget-tracker-tabell (eller återanvänd befintlig mekanism)

Skapa en enkel tabell `api_usage_tracker` för att spåra daglig Firecrawl-användning per kategori:

```sql
CREATE TABLE public.api_usage_tracker (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,        -- 'stocks' eller 'betting'
  date_key text NOT NULL,        -- '2026-02-23'
  searches_used integer DEFAULT 0,
  last_updated timestamptz DEFAULT now(),
  UNIQUE(category, date_key)
);

ALTER TABLE api_usage_tracker ENABLE ROW LEVEL SECURITY;
CREATE POLICY "api_usage_select_all" ON api_usage_tracker FOR SELECT USING (true);
```

### 2. Uppdatera `ai-analysis` -- spåra Firecrawl-anrop

I `fetchFirecrawlAnalyses()`:
- Före anrop: läs `api_usage_tracker` WHERE `category='stocks'` AND `date_key=today`
- Om `searches_used >= 15`: hoppa över Firecrawl, logga "budget exhausted"
- Efter lyckat anrop: upsert `searches_used + 1`

### 3. Uppdatera `fetch-matches` -- migrera till ny tabell

Byt från `betting_matches` budget-tracker-hack till `api_usage_tracker` med `category='betting'` och gräns 15 (istället för nuvarande 30).

### 4. Frontend -- budgetmätare på Index.tsx

Lägg till samma mätare som på BettingPage, placerad under "Reality Check" och ovanför sökfältet:

```text
[DB-ikon] Firecrawl-budget (Aktier) idag    8 / 15 sökningar
           [========--------]
```

- Hämtar data från `api_usage_tracker` WHERE `category='stocks'`
- Färgkodning: grönt (0-10), gult (11-13), rött (14-15)

### 5. Uppdatera BettingPage.tsx

Byt datakälla från `betting_matches` budget-hack till `api_usage_tracker` WHERE `category='betting'`, och ändra gräns från 30 till 15.

## Filer att ändra

1. **Databasmigrering** -- skapa `api_usage_tracker`
2. **`supabase/functions/ai-analysis/index.ts`** -- lägg till budget-check och tracking
3. **`supabase/functions/fetch-matches/index.ts`** -- migrera till `api_usage_tracker`
4. **`src/pages/Index.tsx`** -- lägg till budgetmätare i dashboard
5. **`src/pages/BettingPage.tsx`** -- byt datakälla och gräns till 15

