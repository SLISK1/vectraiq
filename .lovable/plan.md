

# Fix: Tillat bara riktiga aktier/tillgangar att laggas till

## Problem

`add-symbol` edge function gor en FMP-lookup (rad 121-142) men anvander resultatet **bara for att hamta namn** -- den stoppar aldrig tillagget om tickern inte finns pa FMP. "BAJS" gar rakt igenom med `displayName = "BAJS"` och laggs in i databasen.

## Losning

Gor FMP-profil-lookup till en **gate** istallet for bara en name-enrichment. Om FMP returnerar tom array (tickern finns inte), avvisa med 404.

### Andring 1: `supabase/functions/add-symbol/index.ts`

**Flytta FMP-lookup FORE insert och avvisa okanda tickers:**

```
// FMP lookup (GATE -- inte bara enrichment)
let displayName = cleanTicker;
let verified = false;

if (fmpApiKey) {
  const profileRes = await fetch(
    `https://financialmodelingprep.com/api/v3/profile/${encodeURIComponent(cleanTicker)}?apikey=${fmpApiKey}`
  );
  if (profileRes.ok) {
    const profileData = await profileRes.json();
    if (Array.isArray(profileData) && profileData.length > 0 && profileData[0].companyName) {
      verified = true;
      displayName = profileData[0].companyName;
      // ... enrichment (isEtf, currency, sector) som idag
    }
  }
}

// Fallback for kanda krypto/metaller som FMP kanske inte har profil for
if (!verified) {
  if (cryptos.includes(cleanTicker.replace(/-.*$/, ""))) {
    verified = true; // BTC, ETH etc. ar kanda
  } else if (metals.includes(cleanTicker)) {
    verified = true;
  }
}

if (!verified) {
  return Response(JSON.stringify({ 
    error: `Kunde inte hitta "${cleanTicker}". Kontrollera att tickern ar korrekt.` 
  }), { status: 404 });
}
```

**Logik:**
- FMP har profil -> godkand (stock, ETF, fund)
- Kand krypto (BTC, ETH, etc.) -> godkand utan FMP
- Kand metall (XAU, XAG, etc.) -> godkand utan FMP  
- Inget av ovanstaende -> **avvisad med 404**

### Andring 2: `src/components/SearchAssets.tsx`

Uppdatera frontend for att visa felmeddelandet fran backend:

- Fanga 404-svaret i `onAddNew`-callbacken
- Visa ett tydligt felmeddelande: "Kunde inte hitta BAJS. Kontrollera att tickern ar korrekt."
- Istallet for att bara svalja felet, visa det i soksresultat-panelen

### Andring 3: Hitta var `onAddNew` anropas

Behover hitta komponenten som kopplar SearchAssets till `add-symbol` edge function for att lagga till error-handling dar.

## Filer som andras

| Fil | Andring |
|-----|---------|
| `supabase/functions/add-symbol/index.ts` | FMP-lookup som gate + 404 vid okand ticker |
| `src/components/SearchAssets.tsx` | Visa felmeddelande vid avvisning |
| Foralder-komponent (Index.tsx eller liknande) | Error-handling i onAddNew callback |

## Edge cases

- **FMP API nere**: Om FMP-anropet failar (naterksfel) -> tillat INTE tillagg (fail closed, inte fail open). Visa "Kunde inte verifiera ticker, forsok igen."
- **FMP saknar API-nyckel**: Om `FMP_API_KEY` ar tom -> avvisa alla nya tillagg med "Verifiering ej tillganglig"
- **Krypto med suffix** (t.ex. BTC-USD): Hanteras redan via `cleanTicker.replace(/-.*$/, "")` matchning

