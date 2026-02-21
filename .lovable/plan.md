

## Fix: Budget input and slider bugs in PoolTipsCard

### Problem
In `src/components/betting/PoolTipsCard.tsx`, the "Budget (SEK)" input field has a leading zero problem. When the user types, the initial value persists as a prefix (e.g., "0123" instead of "123"). This is caused by using a raw `<input type="number">` with `value={budgetSek}` where `budgetSek` is a number state. On mobile browsers especially, this creates inconsistent behavior with leading zeros.

### Root Cause
- The input uses `value={budgetSek}` (a number) directly, but `e.target.value` returns a string. The conversion via `Number()` strips the zero in state, but the DOM input retains the raw typed string.
- The input is a raw `<input>` element instead of the project's `Input` component, missing consistent styling and behavior.

### Fix (single file: `src/components/betting/PoolTipsCard.tsx`)

1. **Use a string-based state** for the budget input to properly control the displayed value:
   - Add a `budgetInput` string state initialized to `"64"`
   - On change, update the string state directly (allowing free editing)
   - On blur, parse the value to a number, clamp it within min/max, and update both `budgetSek` (number) and `budgetInput` (cleaned string)

2. **Replace the raw `<input>`** with the project's `Input` component from `@/components/ui/input` for consistent styling.

3. **Add `inputMode="numeric"`** instead of `type="number"` to avoid mobile number-input quirks while still showing a numeric keyboard.

### Technical Details

```text
State changes:
  - budgetSek: number (used for calculations, API calls)
  - budgetInput: string (used for display in the input field)

On change: setBudgetInput(e.target.value)
On blur:
  const num = parseInt(budgetInput) || 1
  const clamped = Math.min(1000, Math.max(1, num))
  setBudgetSek(clamped)
  setBudgetInput(String(clamped))
```

This is a minimal, focused fix in one file only.

