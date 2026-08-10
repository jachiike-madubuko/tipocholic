# Tip Reconciliation

Courtyard Marriott Bozeman, F&B. Splits POS tip pools across the squad who filed
each shift's handoff, then exports the result into the Level5 TIPS worksheet.

Replaces matching 14 days of tips to people by hand every pay period.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173, runs on the baked-in snapshot
npm test             # invariants, run this before touching engine.ts
```

For live Airtable data you need the API route, which means running through Vercel:

```bash
cp .env.example .env      # add your PAT
npx vercel dev            # serves the app + /api/tips together
```

`npm run dev` alone cannot reach `/api/tips`, so it falls back to the snapshot in
`src/data.ts` and says so in the UI footer.

## Deploy

```bash
npx vercel
npx vercel env add AIRTABLE_PAT       # paste token, all environments
npx vercel env add AIRTABLE_BASE_ID   # appbhZtJ44f7jvxrB
npx vercel --prod
```

The PAT needs `data.records:read`, `data.records:write`, and `schema.bases:read`
on the F&B Inventory base. It stays server-side. Do not prefix it with `VITE_`.

Confirm in Resolve (and Save to Airtable on Shifts) writes tip amounts to
**POS Tip Summary** and assigned people to **Handoffs.Squad**, with a timestamped
line in Notes / Submit Log.

---

## The model

```
POS Tip Summary  ──┐
   (Business Date  │
    + AM/PM        ├──►  pool ÷ handoff roster  ──►  per-person payout
    + Shift Tips)  │
Handoffs        ──┘
   (Date + AM/PM + Squad links, Barista/Bartender only)
```

Handoffs decide who gets paid. The schedule is not consulted; that was removed
deliberately after an earlier version used it as a fallback.

Three things stop money from reaching the export:

| State | Meaning | Clears by |
|---|---|---|
| **Unassigned** | Tips exist, no handoff filed | Filing the handoff, or assigning by hand |
| **Held** | `Outstanding Checks > 0`, report incomplete | Typing the settled amount, or releasing |
| **Off roster** | Paid but missing from the worksheet | Adding them to `squad` in `data.ts` |

### Why outstanding checks matter more than the amount

A POS report pulled mid-shift shows a plausible number that is simply wrong.
`2026-08-02 AM` read `$33.80` with 8 checks still open. Small enough to look like
a quiet morning, incomplete enough to underpay everyone on it.

## Export

`Copy for Excel` puts 12 tab-separated rows on the clipboard in payroll roster
order. In the worksheet: duplicate the last sheet, rename it to the period
(`7.26-8.8`), set `B2` to the start date, click `A4`, paste.

Columns `P` and row `16` are left alone; their `=SUM()` formulas still work.
Held and unassigned money is excluded from the copy on purpose, with the amounts
shown on screen so the omission is never a surprise.

---

## Layout

```
api/tips.ts          Vercel edge function. Fetches Airtable, holds the PAT.
src/engine.ts        All money math. Pure, no React.
src/engine.test.ts   Invariants. 20+ cases including exhaustive split checks.
src/data.ts          Snapshot fallback + the locked payroll roster order.
src/useDataset.ts    Live fetch with snapshot fallback, reports which is in use.
src/App.tsx          UI. Overview / Shifts / Payout Grid.
.cursorrules         Domain rules. Read this before changing engine logic.
```

## Tests

`npm test` covers the rules that matter:

- Splits reconcile exactly for every pool 0 to $50 across 1 to 6 people
- Three known-good cases traced to the July 12-25 worksheet
- `pool === ready + held + unassigned` under five override scenarios
- Nobody is ever paid who is not on the effective roster
- Cook handoffs never take a share
- Editing a provisional amount clears the hold; an empty roster pays nobody
- Day totals match the Airtable group sums

Add a test before changing split behaviour. The whole point of this app is that
the arithmetic is not in question.

## State as of the 2026-08-02 snapshot

Pay period 7/26 to 8/8:

```
pool         $1,148.45
ready          $771.35
held           $103.00   7/28 PM, 2 checks open
unassigned     $274.10   7/29 PM $142.50, 8/1 AM $97.80, 8/2 AM $33.80
```

`7/26 PM` has a handoff from Zechariah and no POS record at all. Worth checking
whether that report ever landed.

## Next

1. **Write overrides back to Airtable.** They currently live in browser storage on
   one machine. Until this ships, a manual adjustment cannot be defended later.
2. **Wire the period selector to the API.** `?start=` is accepted and ignored by
   the client today.
3. **Track three numbers per period:** missing handoffs (adoption), off-roster
   payouts (roster drift), manual overrides (data quality). When all three sit at
   zero for two periods, the Shifts tab can be deleted and this becomes a pure
   export tool.
