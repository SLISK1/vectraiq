

# Problem: Krypto, metaller och fonder syns inte i dashboarden

## Orsaker

### 1. `fund` exkluderas i type-definitionen (huvudproblemet)
I `useMarketData.ts` rad 116 och 143 castas `asset_type` till `'stock' | 'crypto' | 'metal'` -- **`fund` saknas**. Samma sak i `createAnalysisContext` (engine.ts rad 416) och `AnalysisContext`-typen. Fonder passerar troligen igenom men med fel typ.

### 2. Bara top 10 visas -- krypto/metaller drunknar bland 260 aktier
`useRankedAssets` (rad 276) gör `.slice(0, 10)` INNAN filtreringen per tillgangstyp. Sa nar man valjer "Krypto" i filtret filtreras en lista som redan bara innehaller de 10 hogst rankade (nastan alltid aktier). Krypto, metaller och fonder syns aldrig.

### 3. Fonder saknar live-priser i `raw_prices`
43 av 50 fonder har `price = null` i `raw_prices`. `fetch-prices` hanterar fondernas proxy-system men det har inte korts efter den senaste deploy:en dar `metadata` lades till i SELECT.

## Losning

### Steg 1: Utoka typdefinitionen till att inkludera `fund`
- `src/lib/analysis/engine.ts`: Andra `assetType`-parametern i `createAnalysisContext` fran `'stock' | 'crypto' | 'metal'` till `'stock' | 'crypto' | 'metal' | 'fund'`
- `src/lib/analysis/types.ts`: Uppdatera `AnalysisContext.assetType` till att inkludera `'fund'`
- `src/hooks/useMarketData.ts`: Andra typcasten pa rad 116 och 143 till `'stock' | 'crypto' | 'metal' | 'fund'`

### Steg 2: Flytta `.slice()` EFTER filtrering, och oka grans per tillgangstyp
- I `useRankedAssets`: Ta bort `.slice(0, 10)` fran queryFn
- Returnera ALLA validAssets istallet
- Lat filtreringen i `Index.tsx` (`filteredTopUp`, `filteredTopDown`) hantera begransningen -- lagg till `.slice(0, 10)` EFTER typfiltret

### Steg 3: Kora `fetch-prices` for att fylla fondernas live-priser
- Redan deployad med `metadata` i SELECT -- behover bara koras via cron eller manuellt

## Tekniska detaljer

### Filer som andras

**`src/lib/analysis/types.ts`** -- Uppdatera AnalysisContext-typen:
```typescript
assetType: 'stock' | 'crypto' | 'metal' | 'fund';
```

**`src/lib/analysis/engine.ts`** (rad 416):
```typescript
assetType: 'stock' | 'crypto' | 'metal' | 'fund',
```

**`src/hooks/useMarketData.ts`**:
- Rad 116, 143: Andra cast till `as 'stock' | 'crypto' | 'metal' | 'fund'`
- Rad 273-276: Ta bort `.slice(0, 10)`, returnera alla validAssets

**`src/pages/Index.tsx`**:
- `filteredTopUp` och `filteredTopDown`: Lagg till `.slice(0, 10)` i slutet av varje filter

Inga forandringar i backend, edge functions, eller det sjalvlarande systemet.

