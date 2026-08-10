import { Dataset, Pool, Shift } from "./data";

export type FlagCode = "NO_HANDOFF" | "NO_POOL" | "PROVISIONAL" | "EDITED";

export interface Flag {
  code: FlagCode;
  severity: 1 | 3;
  text: string;
}

/** Manager overrides. Absent keys mean "use the source". */
export interface Decision {
  /** Roster override. [] is meaningful: pay nobody. undefined means use the handoff. */
  manual?: string[];
  /** Tip pool override in dollars. Also creates a pool where POS has none yet. */
  tips?: number;
  /** Release a provisional POS pool without editing the amount. */
  approved?: boolean;
}

export interface Row {
  key: string;
  date: string;
  shift: Shift;

  // source
  pool: Pool | null;
  handoffPeople: string[];
  roles: string[];

  // effective, after overrides
  cents: number;
  people: string[];
  tipsEdited: boolean;
  rosterEdited: boolean;
  held: boolean;

  flags: Flag[];
  worst: number;
}

export const money = (c: number) =>
  (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const toCents = (n: number) => Math.round(n * 100);

/** Largest remainder. Extra pennies to the earliest name alphabetically. Sum is exact. */
export function splitCents(total: number, people: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  const n = people.length;
  if (n === 0) return out;
  const sorted = [...people].sort((a, b) => a.localeCompare(b));
  const base = Math.floor(total / n);
  const rem = total - base * n;
  sorted.forEach((p, i) => (out[p] = base + (i < rem ? 1 : 0)));
  return out;
}

export function buildRows(
  data: Dataset,
  dates: string[],
  decisions: Record<string, Decision>
): Row[] {
  const inRange = (d: string) => dates.includes(d);
  const keys = new Set<string>();
  data.pools.filter((p) => inRange(p.date)).forEach((p) => keys.add(`${p.date}|${p.shift}`));
  data.handoffs.filter((h) => inRange(h.date)).forEach((h) => keys.add(`${h.date}|${h.shift}`));
  // an override can bring a shift into existence on its own
  Object.keys(decisions).forEach((k) => {
    const [d] = k.split("|");
    if (inRange(d)) keys.add(k);
  });

  return Array.from(keys)
    .sort()
    .map((key) => {
      const [date, shift] = key.split("|") as [string, Shift];
      const d = decisions[key];
      const pool = data.pools.find((p) => p.date === date && p.shift === shift) ?? null;
      const hs = data.handoffs.filter((h) => h.date === date && h.shift === shift);
      const handoffPeople = Array.from(new Set(hs.flatMap((h) => h.squad))).sort((a, b) =>
        a.localeCompare(b)
      );
      const roles = Array.from(new Set(hs.map((h) => h.role)));

      const tipsEdited = d?.tips !== undefined;
      const rosterEdited = d?.manual !== undefined;

      const cents = tipsEdited ? toCents(d!.tips!) : pool ? toCents(pool.tips) : 0;
      const people = rosterEdited ? d!.manual! : handoffPeople;

      // Typing a settled amount over a provisional pool clears the hold:
      // the manager has entered the real number.
      const held = !!pool?.provisional && !d?.approved && !tipsEdited;

      const flags: Flag[] = [];

      if (cents > 0 && people.length === 0) {
        flags.push({
          code: "NO_HANDOFF",
          severity: 3,
          text: `$${money(cents)} with nobody to pay. Edit the shift to assign it.`,
        });
      }

      if (cents === 0 && people.length > 0) {
        flags.push({
          code: "NO_POOL",
          severity: 1,
          text: "No POS tip record yet. Edit to enter the amount by hand.",
        });
      }

      if (held) {
        flags.push({
          code: "PROVISIONAL",
          severity: 3,
          text: `${pool!.outstandingChecks} outstanding check(s). Tips understated. Enter the settled amount or release.`,
        });
      }

      if (tipsEdited || rosterEdited) {
        const bits: string[] = [];
        if (tipsEdited)
          bits.push(
            pool ? `amount changed from $${money(toCents(pool.tips))}` : "amount entered by hand"
          );
        if (rosterEdited)
          bits.push(
            handoffPeople.length
              ? `roster changed from ${handoffPeople.join(", ")}`
              : "roster assigned by hand"
          );
        flags.push({ code: "EDITED", severity: 1, text: `Edited: ${bits.join(" · ")}.` });
      }

      return {
        key,
        date,
        shift,
        pool,
        handoffPeople,
        roles,
        cents,
        people,
        tipsEdited,
        rosterEdited,
        held,
        flags,
        worst: flags.reduce((m, f) => Math.max(m, f.severity), 0),
      };
    });
}

export interface Payout {
  person: string;
  date: string;
  shift: Shift;
  cents: number;
  key: string;
  held: boolean;
}

export function payouts(rows: Row[]): Payout[] {
  const out: Payout[] = [];
  rows.forEach((r) => {
    if (r.cents <= 0 || r.people.length === 0) return;
    const split = splitCents(r.cents, r.people);
    r.people.forEach((p) =>
      out.push({ person: p, date: r.date, shift: r.shift, cents: split[p], key: r.key, held: r.held })
    );
  });
  return out;
}

/** Rows grouped by date, in date order, for the day-sectioned Shifts view. */
export function byDay(rows: Row[]): { date: string; rows: Row[]; cents: number }[] {
  const map = new Map<string, Row[]>();
  rows.forEach((r) => {
    if (!map.has(r.date)) map.set(r.date, []);
    map.get(r.date)!.push(r);
  });
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, rs]) => ({
      date,
      rows: rs.sort((a, b) => (a.shift === b.shift ? 0 : a.shift === "AM" ? -1 : 1)),
      cents: rs.reduce((s, r) => s + r.cents, 0),
    }));
}

// ---- dates ----
export const parseISO = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
};
export const toISO = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => {
  const t = parseISO(d);
  t.setUTCDate(t.getUTCDate() + n);
  return toISO(t);
};
export const periodDates = (start: string) =>
  Array.from({ length: 14 }, (_, i) => addDays(start, i));
export const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DOW_FULL = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
export const dowOf = (iso: string) => DOW[parseISO(iso).getUTCDay()];
export const dowFullOf = (iso: string) => DOW_FULL[parseISO(iso).getUTCDay()];
export const shortDate = (iso: string) => {
  const d = parseISO(iso);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};
export const fullDate = (iso: string) => {
  const d = parseISO(iso);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${String(d.getUTCFullYear()).slice(2)}`;
};
