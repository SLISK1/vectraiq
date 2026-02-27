

# Fix: fetch-matches Returns 0 Matches Due to API Date Range Limit

## Root Cause
Football-data.org (free tier) limits the date range in a single API call to **10 days maximum**. The current defaults are `days_back=7` + `days_ahead=8` = **15-day range**, which causes the API to return 0 matches for the target competitions (it silently fails without an HTTP error).

Confirmed via logs:
- `2026-02-20 to 2026-03-07` (15 days) -> "0 matches in target competitions"
- `2026-02-24 to 2026-03-03` (7 days) -> "56 matches in target competitions"

## Fix: Split into Two API Calls

**File**: `supabase/functions/fetch-matches/index.ts`

Instead of one API call spanning 15+ days, split into two calls that each stay under 10 days:

1. **Past matches**: `today - 7 days` to `today` (7 days)
2. **Future matches**: `today` to `today + 8 days` (8 days)

Then merge the results before filtering by competition.

### Changes (lines ~89-117):
- Replace the single `/v4/matches?dateFrom=...&dateTo=...` call with two parallel `fetch()` calls
- Merge the returned arrays into `allMatches`
- Add better error logging that includes the actual HTTP response when the API returns a non-200 status

### Additional improvement:
- Log the date ranges for each sub-call for easier debugging
- Add a console.log showing how many raw matches each sub-call returned

## No Frontend Changes Needed
The `BettingPage.tsx` already handles the data correctly -- the issue is purely in the edge function's API call exceeding the provider's date range limit.
