
## Fix: Automatisk scoring av avslutade betting-prediktioner

### Problem
Det finns redan ett cron-jobb (jobid 21) som kör `score-predictions` varje timme, men det har ett **felaktigt API-nyckel** i headern. Nyckeln slutar på `QQ28ERTpKMU` istället för det korrekta `QQ78ERTpKMU`. Detta innebär att varje anrop misslyckas med 401 Unauthorized, och inga prediktioner scoreas automatiskt.

### Orsak
En bokstav i Authorization-headern ar fel: `QQ28` ska vara `QQ78`.

### Fix (1 steg)
Uppdatera det befintliga cron-jobbet (jobid 21) med korrekt anon key via SQL:

```text
cron.alter_job(21, command := ... med korrekt Bearer-token ...)
```

Det korrigerade jobbet fortsatter att kora varje timme (`0 * * * *`), vilket gar att:
1. `fetch-matches` hämtar matchresultat (kor 09:30 och 19:30 UTC)
2. `score-predictions` kor varje hel timme och scorear alla avslutade prediktioner dar `outcome IS NULL` och matchen ar `finished` med resultat

### Tekniska detaljer
- Enbart en SQL-sats behövs: `SELECT cron.alter_job(21, command := ...)` med den korrekta Authorization Bearer-token
- Inga kodfiler behöver andras
- Inga nya edge functions eller tabeller
- score-predictions-funktionen fungerar korrekt -- det ar bara cron-anropet som har fel nyckel
