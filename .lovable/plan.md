
# Plan — Senast uppdaterad 2026-02-23

## ✅ Genomförda uppgifter

### Firecrawl-budgetmätare (klart)
- Ny tabell `api_usage_tracker` för daglig spårning per kategori
- `ai-analysis`: budget-check före Firecrawl (15/dag aktier)
- `fetch-matches`: migrerad till `api_usage_tracker` (15/dag betting)
- Visuell mätare på Dashboard + BettingPage

### Självlärande system (klart)
- `signal_snapshots`-tabell bevarar modulprediktioner
- `generate-signals` läser `module_reliability` och justerar vikter
- `score-predictions` fyller `module_reliability` med hit_rate per modul

### Krypto, metaller & fonder (klart)
- **Krypto historik**: Yahoo Finance fallback (BTC-USD etc.) när CoinGecko rate-limitar
- **Metall historik**: Förbättrad loggning, Yahoo futures (GC=F etc.) fungerar som fallback
- **Fonder**: 7 svenska proxy-fonder aktiverade (SWE-USA, SWE-GLOB, SWE-TECH, SWE-ASIA, SWE-SMAL, HB-ENRG, SPLT-INV)
- Alla tillgångstyper har nu 60+ dagars historik + live-priser

## Möjliga nästa steg

- Utöka fond-utbudet med fler svenska fonder
- Koppla fonder till `generate-signals` för analys
- Lägga till CoinGecko Pro-nyckel för bättre krypto-historik
