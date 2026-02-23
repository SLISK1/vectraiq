
# Datakällsindikatorer pa MatchCard

## Oversikt
Lagg till en rad med kompakta ikoner/badges pa varje MatchCard som visar vilka datakallor som anvandes i analysen. Informationen finns redan i `prediction.sources_used` -- den behovs bara parsas och visas visuellt.

## Kallor att detektera

Foljande kallor identifieras fran `sources_used`-arrayen baserat pa URL och type:

| Kalla | Ikon | Villkor (URL/title innehaller) |
|---|---|---|
| Football-Data (H2H, tabell) | `Database` | `football-data.org` |
| Odds (The Odds API) | `DollarSign` | `market_odds_home !== null` |
| Forza Football | `Flame` | `forzafootball.com` |
| Firecrawl (skrapade artiklar) | `Globe` | URL inte fran ovanstaende + type=`stats` fran skrapning |
| Nyheter (GNews/NewsAPI) | `Newspaper` | type=`news` eller `[NewsAPI]` i title |
| Pool Tips | `Users` | `pool_tips` i title |

## UI-design

En rad med sma fargade ikoncirklar (16x16px) placerade under prediction-sektionen, ovanfor action-knapparna. Varje ikon har en tooltip som visar kallan. Exempelrad:

```
[DB] [$$] [F] [Globe] [News]  -- 6 kallor
```

Anvander befintliga lucide-react-ikoner och Tooltip-komponenten.

## Teknisk plan

### 1. Skapa hjalp-funktion i MatchCard.tsx

En funktion `detectSources(prediction)` som:
- Loopar igenom `prediction.sources_used` (array av `{url, title, date, type}`)
- Kollar `prediction.market_odds_home` for odds
- Returnerar en lista av `{ key, label, icon, colorClass }`
- Deduplicerar per key (t.ex. bara en "H2H"-badge oavsett antal football-data-kallor)

### 2. Rendera ikoner i MatchCard

Inuti prediction-sektionen (raden under cap-warning, ovanfor "Se fullstandig analys"-lanken), lagg till:

```tsx
<div className="flex flex-wrap items-center gap-1.5">
  {detectedSources.map(src => (
    <Tooltip key={src.key}>
      <TooltipTrigger>
        <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border", src.colorClass)}>
          <src.icon className="w-3 h-3" />
          {src.label}
        </span>
      </TooltipTrigger>
      <TooltipContent>{src.tooltip}</TooltipContent>
    </Tooltip>
  ))}
</div>
```

### 3. Filer att andra

- **`src/components/betting/MatchCard.tsx`**: Lagg till `detectSources`-funktion, importera ikoner och Tooltip, rendera badges i prediction-sektionen.

Inga nya filer, inga backend-andringar, ingen databasmigrering. All data finns redan tillganglig i `prediction.sources_used` och `prediction.market_odds_*`.
