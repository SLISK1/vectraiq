Plan för att fixa integritetstestet utan att påverka predictions eller aktieanalys:

1. Reparera datakvalitetstabellen
- Skapa/återställ `data_quality_issues` i backend eftersom den saknas i live-databasen trots att kod för panel och test finns.
- Lägg till korrekta rättigheter så appen kan läsa resultat och service-funktioner kan skriva resultat.
- Behåll RLS låst för klientskrivningar så testet inte kan mutera analysdata från frontend.

2. Gör integritetstestet strikt read-only mot analyskedjan
- Säkerställ att `validate-data` bara läser `symbols`, `raw_prices`, `price_history` och `signals`.
- Tillåt endast skrivning till `data_quality_issues`, inte till predictions-, betting-, signal- eller pris-tabeller.
- Lämna `generate-signals`, `analyze-match`, `recommend_bets`, `score-predictions`, `price_history`, `raw_prices` och `signals` oförändrade.

3. Lägg in coverage-rapporten i testresultatet
- Utöka `validate-data` så den rapporterar coverage för kedjan:
```text
symbols -> raw_prices -> price_history -> signals
```
- Rapportera antal aktiva symboler, färska raw-priser, färsk historik, färska signaler och vilka tickers/källor som saknar data.
- Markera saknad/föråldrad data som issues i `data_quality_issues`, men utan att trigga någon ny hämtning eller signalgenerering.

4. Knyt Admin-panelen till samma isolerade test
- Behåll `DataQualityPanel` som läsare av `data_quality_issues`.
- Om tabellen saknar resultat visas ett tydligt tomläge; inga prediction- eller analysfunktioner körs från panelen.

5. Validering efter ändring
- Kontrollera att tabellen finns och har rätt policies/grants.
- Köra `validate-data` separat och verifiera att den bara skapar datakvalitetsrader/coverage, inte ändrar predictions eller aktieanalys.
- Kontrollera senaste funktionsloggarna för att säkerställa att integritetstestet inte längre faller på schema/rättigheter.