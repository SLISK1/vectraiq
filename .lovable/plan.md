
# Visa kommande matcher forst, behall avslutade for historik

## Problem
Betting-sidan sorterar alla matcher kronologiskt (aldsta forst), vilket gor att 21 avslutade och 3 live-matcher visas fore de 38 kommande matcherna. Anvandaren maste scrolla langt for att hitta kommande matcher.

## Losning
Separera matcherna i tva sektioner: **Kommande matcher** visas forst (sorterade med narmaste matchen overst), och **Avslutade matcher** visas i en hopfallbar sektion nedanfor for att kunna foljas upp for prediktionsprecision och ROI.

## Andringar

### 1. BettingPage.tsx - Dela upp matcher i sektioner
- Filtrera matchlistan i tva grupper: `upcoming`/`live` och `finished`
- Visa kommande matcher forst, sorterade med narmaste match overst
- Visa avslutade matcher i en `Collapsible`-sektion med rubrik "Avslutade matcher (for ROI-uppfoljning)"
- Avslutade matcher sorteras med senast spelade forst

### 2. Andrad databasfraga
- Andra `loadMatches`-fragor fran `.order('match_date', { ascending: true })` till `.order('match_date', { ascending: false })` sa att vi far ratt ordning i minnet
- Alternativt: behall ASC-ordning och vand i koden for respektive sektion

## Teknisk detalj

```text
Fore:
  [Alla matcher, ASC]  -->  gamla matcher overst

Efter:
  [Kommande/Live, ASC]     --> narmaste match overst
  ---collapsible---
  [Avslutade, DESC]        --> senast spelade overst
```

Filen som andras:
- `src/pages/BettingPage.tsx`: Dela `filteredMatches` i `upcomingMatches` och `finishedMatches`, rendera i tva separata sektioner. Anvand befintlig `Collapsible`-komponent fran shadcn for den hopfallbara sektionen.
