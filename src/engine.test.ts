import { describe, expect, it } from "vitest";
import { SNAPSHOT } from "./data";
import {
  Decision,
  buildRows,
  byDay,
  payouts,
  periodDates,
  splitCents,
  toCents,
} from "./engine";

const DATES = periodDates(SNAPSHOT.periodStart);
const rowsWith = (d: Record<string, Decision> = {}) => buildRows(SNAPSHOT, DATES, d);
const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

describe("splitCents", () => {
  it("always sums back to the pool exactly", () => {
    // Every pool 0..5000 cents across 1..6 people. No rounding drift anywhere.
    for (let total = 0; total <= 5000; total += 7) {
      for (let n = 1; n <= 6; n++) {
        const people = Array.from({ length: n }, (_, i) => `P${i}`);
        expect(sum(splitCents(total, people))).toBe(total);
      }
    }
  });

  it("gives odd pennies to the earliest name alphabetically", () => {
    // $100.00 / 3 = 33.34 / 33.33 / 33.33
    expect(splitCents(10000, ["Charlie", "Alice", "Bob"])).toEqual({
      Alice: 3334,
      Bob: 3333,
      Charlie: 3333,
    });
  });

  it("is order independent, so the same shift always pays the same", () => {
    const a = splitCents(10045, ["Autumn Britt", "Elizabeth Ayers", "Madison Edwards"]);
    const b = splitCents(10045, ["Madison Edwards", "Autumn Britt", "Elizabeth Ayers"]);
    expect(a).toEqual(b);
  });

  it("pays nobody when the roster is empty", () => {
    expect(splitCents(10000, [])).toEqual({});
  });
});

describe("known-good cases from the Level5 worksheet", () => {
  // These three were verified against 2026_Level5_TIPS_Worksheet.xlsx sheet
  // 7.12-7.25 before any code was written. They anchor the whole model.
  it.each([
    ["7/22 AM", 5960, ["Elizabeth Ayers", "Autumn Britt"], 2980],
    ["7/24 AM", 11440, ["Elizabeth Ayers", "Brielle Critelli"], 5720],
    ["7/22 PM", 16550, ["Erik Eng"], 16550],
  ])("%s splits to the amount on the sheet", (_label, pool, people, each) => {
    const split = splitCents(pool as number, people as string[]);
    (people as string[]).forEach((p) => expect(split[p]).toBe(each));
  });
});

describe("money identity", () => {
  it("pool always equals ready + held + unassigned", () => {
    const cases: Record<string, Decision>[] = [
      {},
      { "2026-07-29|PM": { manual: ["Erik Eng"] } },
      { "2026-07-28|PM": { tips: 118.75 } },
      { "2026-07-27|PM": { manual: [] } },
      { "2026-07-26|PM": { tips: 64.2 } },
    ];
    for (const d of cases) {
      const rows = rowsWith(d);
      const pays = payouts(rows);
      const pool = rows.reduce((s, r) => s + r.cents, 0);
      const ready = pays.filter((p) => !p.held).reduce((s, p) => s + p.cents, 0);
      const held = pays.filter((p) => p.held).reduce((s, p) => s + p.cents, 0);
      expect(ready + held).toBeLessThanOrEqual(pool);
      expect(pool - ready - held).toBeGreaterThanOrEqual(0);
    }
  });

  it("matches the 2026-07-26 period totals verified against Airtable", () => {
    const rows = rowsWith();
    const pays = payouts(rows);
    expect(rows.reduce((s, r) => s + r.cents, 0)).toBe(114845); // $1,148.45
    expect(pays.filter((p) => !p.held).reduce((s, p) => s + p.cents, 0)).toBe(77135);
    expect(pays.filter((p) => p.held).reduce((s, p) => s + p.cents, 0)).toBe(10300);
  });
});

describe("handoffs are the source of truth", () => {
  it("never pays someone who is not on the effective roster", () => {
    const rows = rowsWith();
    for (const p of payouts(rows)) {
      const row = rows.find((r) => r.key === p.key)!;
      expect(row.people).toContain(p.person);
    }
  });

  it("leaves tips unassigned when no handoff exists", () => {
    const row = rowsWith().find((r) => r.key === "2026-07-29|PM")!;
    expect(row.cents).toBe(14250);
    expect(row.people).toHaveLength(0);
    expect(row.flags.map((f) => f.code)).toContain("NO_HANDOFF");
  });

  it("excludes cook handoffs, since BOH is not tipped", () => {
    // 2026-07-29 PM has a Cook handoff (Erick Luna) and no bartender handoff.
    // It must still read as NO_HANDOFF rather than paying the cook.
    const row = rowsWith().find((r) => r.key === "2026-07-29|PM")!;
    expect(row.people).not.toContain("Erick Luna");
  });
});

describe("manager overrides", () => {
  it("assigning a roster releases stranded tips", () => {
    const row = rowsWith({ "2026-07-29|PM": { manual: ["Erik Eng"] } }).find(
      (r) => r.key === "2026-07-29|PM"
    )!;
    expect(payouts([row])[0]).toMatchObject({ person: "Erik Eng", cents: 14250 });
    expect(row.flags.map((f) => f.code)).not.toContain("NO_HANDOFF");
  });

  it("typing a settled amount over a provisional pool clears the hold", () => {
    const before = rowsWith().find((r) => r.key === "2026-07-28|PM")!;
    expect(before.held).toBe(true);

    const after = rowsWith({ "2026-07-28|PM": { tips: 118.75 } }).find(
      (r) => r.key === "2026-07-28|PM"
    )!;
    expect(after.held).toBe(false);
    expect(after.cents).toBe(11875);
    expect(after.tipsEdited).toBe(true);
  });

  it("an empty roster override means pay nobody, and stays flagged", () => {
    const row = rowsWith({ "2026-07-27|PM": { manual: [] } }).find(
      (r) => r.key === "2026-07-27|PM"
    )!;
    expect(row.people).toHaveLength(0);
    expect(row.rosterEdited).toBe(true);
    expect(row.flags.map((f) => f.code)).toContain("NO_HANDOFF");
    expect(payouts([row])).toHaveLength(0);
  });

  it("an amount can be entered where POS has no record yet", () => {
    const row = rowsWith({ "2026-07-26|PM": { tips: 64.2 } }).find(
      (r) => r.key === "2026-07-26|PM"
    )!;
    expect(row.cents).toBe(6420);
    expect(row.people).toEqual(["Zechariah Nelson"]);
    expect(payouts([row])[0].cents).toBe(6420);
  });

  it("marks every edited shift so overrides are never invisible", () => {
    const rows = rowsWith({ "2026-07-28|PM": { tips: 118.75 } });
    const row = rows.find((r) => r.key === "2026-07-28|PM")!;
    expect(row.flags.map((f) => f.code)).toContain("EDITED");
  });
});

describe("day grouping", () => {
  it("orders days ascending with AM before PM", () => {
    const days = byDay(rowsWith());
    expect(days.map((d) => d.date)).toEqual([...days.map((d) => d.date)].sort());
    days.forEach((d) => {
      if (d.rows.length === 2) expect(d.rows.map((r) => r.shift)).toEqual(["AM", "PM"]);
    });
  });

  it("day totals equal the sum of their shifts", () => {
    byDay(rowsWith()).forEach((d) => {
      expect(d.cents).toBe(d.rows.reduce((s, r) => s + r.cents, 0));
    });
  });

  it("matches the Airtable group sums for the current period", () => {
    const got = Object.fromEntries(byDay(rowsWith()).map((d) => [d.date, d.cents]));
    expect(got["2026-07-28"]).toBe(21100); // $211.00
    expect(got["2026-07-29"]).toBe(24295); // $242.95
    expect(got["2026-07-30"]).toBe(16210); // $162.10
    expect(got["2026-07-31"]).toBe(16330); // $163.30
    expect(got["2026-08-01"]).toBe(24930); // $249.30
  });
});

describe("payroll roster", () => {
  it("keeps the 12 worksheet rows in worksheet order", () => {
    expect(SNAPSHOT.squad.slice(0, 12)).toEqual([
      "Elizabeth Ayers",
      "Autumn Britt",
      "Caldwell Armstrong",
      "An Nguyen",
      "Madison Edwards",
      "Brooklyn Worman",
      "Brielle Critelli",
      "Vinh Nguyen",
      "Zechariah Nelson",
      "Erik Eng",
      "Alexandr Zaharchook",
      "Meagan Wagner",
    ]);
  });

  it("pays nobody who is missing from the roster in the current period", () => {
    // If this fails, someone new filed a handoff and must be added to the
    // worksheet, or the export will silently drop them.
    const paid = new Set(payouts(rowsWith()).map((p) => p.person));
    const off = [...paid].filter((p) => !SNAPSHOT.squad.includes(p));
    expect(off).toEqual([]);
  });
});

describe("pool source", () => {
  it("treats outstanding checks as the completeness signal, not the dollar amount", () => {
    // 2026-08-02 AM is $33.80 with 8 checks open: small number, badly incomplete.
    const row = rowsWith().find((r) => r.key === "2026-08-02|AM")!;
    expect(row.pool?.provisional).toBe(true);
    expect(toCents(row.pool!.tips)).toBe(3380);
  });
});
