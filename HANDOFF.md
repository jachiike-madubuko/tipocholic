# HANDOFF

**Project:** Tip Reconciliation, Courtyard Marriott Bozeman F&B
**Owner:** Jachiike Madubuko
**Built:** 2026-07-31 to 2026-08-03
**State:** Working, deployed nowhere yet, running on a baked-in snapshot
**Last data pull:** 2026-08-02

This document is the reasoning that is not in the code. `README.md` covers setup,
`.cursorrules` covers rules an AI needs to not break things. This covers **why the
thing is shaped the way it is**, what has been proven, and what has not.

---

## 1. The problem this replaces

Every two weeks, tips were matched to people by hand: read the POS report, work out
who was on which shift, split it, type 12 names × 14 days into the Level5 worksheet.
Slow, and no record of the judgment calls.

The app does the matching. It does **not** make the judgment calls. That distinction
drove most of the design.

---

## 2. Decision log

Each of these was a fork in the road. If you are considering reversing one, the
reason it went that way is here.

### 2.1 Handoffs are the source of truth for who gets paid

Three candidate rosters existed: the Handoffs table, the Shifts table (schedule),
and both cross-checked.

**Chose Handoffs alone.** Consequence accepted: a shift with no handoff pays nobody
and the money sits flagged as unassigned rather than falling back to the schedule.

**Why not the schedule:** scheduled ≠ worked. No-shows and swaps would get paid.

**Why not both:** the cross-check version was built first and worked, but it put a
second opinion on screen for every shift when the manager only wanted flags. It was
removed on request.

**What was given up:** the schedule was the only signal that someone *worked but got
left off a coworker's handoff*. That case is now silent. If Zechariah works and Erik
files the handoff without him, Zechariah gets $0 and nothing flags it. Manual assign
covers it, but only if noticed.

> If missing-pay complaints start showing up, this is the first thing to look at.
> The schedule join still exists in git history.

### 2.2 Tips ride on handoff submission, which is a real incentive

Making pay depend on filing the handoff will drive submission rates up fast. Two
second-order effects to watch:

- **The handoff became a claim.** Whoever fills it out decides who gets paid.
  Worth telling the squad plainly that leaving a coworker off takes money out of
  their pocket.
- **Quality may drop as submission rises.** People will file to get paid, not to
  communicate shift condition. The `Gaps Found` and `Shift Rating` fields are the
  canary. If they go blank or uniform while submission hits 100%, the form is
  being gamed.

Neither is a reason to reverse. Both are reasons to watch.

### 2.3 Outstanding Checks, not the dollar amount, signals completeness

A POS report pulled mid-shift shows a plausible but wrong number. `2026-08-02 AM`
read `$33.80` with 8 checks open. Small enough to look like a quiet morning,
incomplete enough to underpay everyone on it.

Any pool with `Outstanding Checks > 0` is **held** and excluded from the export.
Two ways to clear it: type the settled amount (which clears the hold automatically,
since the manager has supplied the real number), or explicitly release it as-is.

### 2.4 Held and unassigned money is excluded from the export

The paste block contains only money that is ready. The amounts withheld are shown
on screen so the omission is never a surprise.

Rationale: sending an understated total to payroll is the error you cannot claw
back. Under-paying and fixing next period is recoverable; over-paying is not.

**This is reversible if the preference is to export everything and sort it in
Excel.** One-line change in `exportRows()`.

### 2.5 Roster order is hardcoded and must never be sorted

Taken from `2026_Level5_TIPS_Worksheet.xlsx` rows 4-15. Verified stable across four
pay periods (5.31-6.13, 6.14-6.27, 6.28-7.11, 7.12-7.25). Positions 1-8 FOH,
9-12 bar. It is **not** alphabetical and not derived from any table.

Slot 4 held Mary Kondelik for at least three periods, then An Nguyen took the same
slot. People are swapped into positions, not appended.

The export pastes at cell `A4`. A reordered roster misaligns by a row and pays the
wrong person while looking completely correct. There is a test pinning the order.

Anyone paid who is not on the roster is appended below row 15, which pushes the
worksheet TOTAL row down. That is deliberate: it should be annoying enough to notice.

### 2.6 Overrides are always visible

Editing an amount or a roster is allowed, and every edit carries an `EDITED` flag
naming the original value plus a one-click reset. A silent override in a payroll
tool is worse than no override.

### 2.7 Design system diverges from the house standard

The UI follows a soft teal/pastel dashboard reference, not the neo-brutalist system
used in Yo Bistro and the printed materials. Chosen deliberately from a reference
screenshot.

**Known tradeoff:** the soft palette makes a $274 hole and a $771 payout feel about
equally calm. The old louder version was doing real work at 11pm on payroll night.
Red flag pills and the checklist were kept to preserve some urgency.

There are now two design systems in the stack. Fine for a solo tool, a problem the
moment it sits next to anything else in front of Celia.

---

## 3. What is verified, and how

Nothing below is assumed. Each was checked against a source.

| Claim | Verified against |
|---|---|
| Split rule is pool ÷ handoff roster, evenly | 3 independent dates in the July 12-25 worksheet: 7/22 AM $59.60→$29.80 ea, 7/22 PM $165.50→$165.50, 7/24 AM $114.40→$57.20 ea |
| Splits reconcile to the penny | Exhaustive test, every pool $0-$50 across 1-6 people |
| Period totals | Airtable group sums in the POS Tip Summary view |
| Day totals | Same, per Business Date |
| Roster order | Four consecutive worksheet sheets |
| Worksheet format | Cell-level read of formulas, fills, number formats via openpyxl |

Current period (7/26 - 8/8) as of the 2026-08-02 pull:

```
pool         $1,148.45
ready          $771.35
held           $103.00    7/28 PM, 2 checks open
unassigned     $274.10    7/29 PM $142.50 · 8/1 AM $97.80 · 8/2 AM $33.80
```

Per person, roster order: Elizabeth $125.48, Autumn $33.49, Caldwell $36.00,
An $62.10, Madison $33.48, Brooklyn $29.90, Brielle $26.10, Zechariah $102.30,
Erik $189.00 (incl. $103.00 held), Meagan $236.50.

---

## 4. Open questions, unresolved

1. **`7/26 PM` has a handoff from Zechariah and no POS tip record at all.** Every
   other date in the period has at least one. Zechariah pulled $102.30 on 7/30 PM
   for the same shift type, so a true zero looks unlikely. Either the report never
   landed or that night genuinely took no card tips. Not resolved.

2. **Three unassigned pools, two of them AM.** 7/29 PM has been open since it
   happened. 8/1 AM and 8/2 AM are newer. The AM skew suggests the morning crew may
   not know the handoff is now what pays them.

3. **Unresolved discrepancy from the prior period.** On 7/23 AM the handoff listed
   Elizabeth + Caldwell; the worksheet paid Elizabeth + Autumn. One of them is
   wrong. Outside the current scope but worth knowing the disagreement existed
   before the tool did.

4. **Pre-7/26 data cannot be reproduced.** Handoffs has no records for 7/13-7/17
   and POS Tip Summary starts 7/22. Scope was set at 7/26 forward for this reason.
   Do not try to backfill older periods from these tables.

---

## 5. Traps

Things that will cost time if rediscovered the hard way.

- **Linked-record fields return record IDs over raw REST, not names.** The Airtable
  MCP resolves them; `fetch` does not. `api/tips.ts` fetches the Squad table and
  builds an id→name map, taking the primary field ID from the meta endpoint so a
  field rename does not break it.
- **Never prefix the PAT with `VITE_`.** Anything `VITE_*` is inlined into the
  client bundle and readable by anyone who opens devtools.
- **Single-selects read as `{id, name, color}` objects and write as plain strings.**
- **The snapshot rots silently.** This already happened once: the app showed
  confident, plausible, three-day-old numbers and was only caught because the POS
  table was opened by chance. `useDataset` now reports `live` vs `SNAPSHOT` in the
  footer. Do not remove that indicator.
- **`npm run dev` cannot reach `/api/tips`.** Use `npx vercel dev` for live data.
- **Money is integer cents everywhere.** Never introduce floating-point dollars.

---

## 6. Next, in priority order

1. **Deploy to Vercel.** Everything else is an improvement; this is a correctness
   fix. It removes the stale-snapshot failure class permanently.
   ```bash
   npx vercel && npx vercel env add AIRTABLE_PAT && npx vercel --prod
   ```

2. **Write overrides back to Airtable** with timestamp and reason. They currently
   live in one browser's local storage. If anyone asks in September why a number
   was adjusted, the answer exists nowhere durable. This should land before the tool
   is used to defend a payroll decision.

3. **Wire the period selector to the API.** `?start=` is accepted server-side and
   ignored by the client today.

4. **Fix the stale-EDITED case.** An override sits on top of refreshed POS data. If
   POS later self-corrects to the same number the manager typed, the `EDITED` flag
   persists and implies a change that is no longer a change. Minor, but it erodes
   trust in the flag.

5. **Consider restoring the schedule as a warn-only signal** if missing-pay
   complaints appear. See 2.1.

---

## 7. Metrics that tell you if this is working

Track per pay period. All three should trend to zero.

| Metric | Measures | Now |
|---|---|---|
| Shifts with tips and no handoff | Team adoption | 3 |
| Off-roster payouts | Roster drift | 0 |
| Manual overrides | Data quality | 0 |

When adoption hits zero for two consecutive periods, the Shifts tab can be deleted
and this becomes a pure export tool. That is the finish line.

If overrides stay high *after* handoffs reach 100%, the problem has moved from the
team to the POS.

---

## 8. Resuming work

```bash
unzip tip-reconciliation.zip && cd tip-reconciliation
npm install
npm test          # 23 tests, all should pass
npm run dev
```

Read `.cursorrules` before changing `src/engine.ts`. Add a test before changing
split behaviour. The point of this app is that the arithmetic is not in question.

Anything touching money: verify against a source file before writing code, and
state what was checked. Claims that cannot be traced to a file should be flagged,
not shipped.
