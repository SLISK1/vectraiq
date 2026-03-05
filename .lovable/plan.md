

# Fix: Firecrawl/Forza data inte nås + Build-fel

## Problem 1: `modelEdge` används innan den deklareras (KRITISKT)
Rad 842 refererar `modelEdge` men den deklareras på rad 863. Hela `analyze-match` kraschar med `ReferenceError: Cannot access 'modelEdge' before initialization` -- detta syns i edge function-loggarna. Eftersom funktionen kraschar hinner den aldrig nå Firecrawl/Forza-anropen (rad 349-430), och all enrichment-data (scraped_articles, forza_football) förblir tom.

**Fix**: Flytta confidence-filtret (rad 841-852) till EFTER `modelEdge`-deklarationen (efter rad 863).

## Problem 2: BettingPage.tsx TypeScript-fel
`coupon_recommendations`-tabellen finns inte i TypeScript-typerna, vilket ger `TS2589`/`TS2769`-fel.

**Fix**: Byt till `.from('coupon_recommendations' as any)` eller ta bort queryn om tabellen inte finns.

## Problem 3: Firecrawl-data används men syns aldrig i DB
Databaskontrollen visar `scraped: []` och `forza: <nil>` på alla matcher -- bekräftar att Firecrawl aldrig körs pga kraschen i Problem 1. Koden för att hämta Firecrawl-data (rad 349-430) och Forza (rad 387-430) är korrekt implementerad och behöver ingen ändring. Den blockeras bara av kraschen.

## Sammanfattning

| Fil | Ändring |
|-----|---------|
| `analyze-match/index.ts` | Flytta rad 841-852 (confidence-filter) till efter rad 863 (modelEdge-deklaration) |
| `src/pages/BettingPage.tsx` | Fixa `coupon_recommendations` typfel |

## Förväntad effekt
När `modelEdge`-felet fixas kommer `analyze-match` att köra färdigt utan krasch. Firecrawl-sökning + Forza Football-skrapning exekveras då som vanligt och data sparas i `source_data`. AI-prompten får tillgång till webbskrapad data vilket förbättrar analysens precision.

