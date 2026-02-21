

# FMP som primär datakälla — IMPLEMENTERAD ✅

## Flöde
```
US-aktier:    FMP batch -> [om misslyckad] -> Yahoo per ticker
Nordic:       FMP per ticker -> [om misslyckad] -> Yahoo per ticker  
Crypto:       CoinGecko (oförändrat)
Metaller:     Alpha Vantage (oförändrat)
Fonder:       NAV-uppskattning (oförändrat)

Korsvalidering: Yahoo validerar FMP-priser (3% warning, 15% replace)
Finnhub:      Tredje källa för US-aktier
```

## Ändrade filer
- `supabase/functions/fetch-prices/index.ts` - FMP primär + Yahoo fallback + omvänd korsvalidering
- `supabase/functions/fetch-history/index.ts` - FMP primär + Yahoo fallback
