import { useEffect, useMemo, useState } from "react";
import { useDataset } from "./useDataset";
import { ResolveDeck } from "./ResolveDeck";
import {
  Decision,
  Row,
  addDays,
  buildRows,
  byDay,
  dowFullOf,
  dowOf,
  fullDate,
  money,
  parseISO,
  payouts,
  periodDates,
  shortDate,
  splitCents,
  toCents,
} from "./engine";

declare global {
  interface Window {
    storage?: {
      get: (k: string, s?: boolean) => Promise<{ value: string } | null>;
      set: (k: string, v: string, s?: boolean) => Promise<unknown>;
    };
  }
}

const C = {
  shell: "#245A6E",
  shellSoft: "rgba(255,255,255,0.07)",
  shellLine: "rgba(255,255,255,0.13)",
  mint: "#B7EFC8",
  mintInk: "#14402A",
  sky: "#BEDDF7",
  skyInk: "#123249",
  amber: "#F6D372",
  ink: "#0E2A35",
};

const HEAD = { fontFamily: "Outfit, system-ui, sans-serif" };

/** Dollars bold, cents dimmed, matching the reference number treatment. */
function Amt({ cents, size = "", cls = "" }: { cents: number; size?: string; cls?: string }) {
  const s = money(cents);
  const [d, c] = s.split(".");
  return (
    <span className={`${size} ${cls} tabular-nums`}>
      ${d}
      <span className="opacity-45">.{c}</span>
    </span>
  );
}

export default function App() {
  const [periodStart, setPeriodStart] = useState("2026-07-26");
  const { data, source } = useDataset();
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [tab, setTab] = useState<"overview" | "shifts" | "grid" | "resolve">("overview");
  const [copied, setCopied] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [resolveStartKey, setResolveStartKey] = useState<string | null>(null);
  const [resolveKeys, setResolveKeys] = useState<string[]>([]);
  const [resolveEpoch, setResolveEpoch] = useState(0);

  const storeKey = `tipdash:${periodStart}`;

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = await window.storage?.get(storeKey);
        if (live) setDecisions(r?.value ? JSON.parse(r.value) : {});
      } catch {
        if (live) setDecisions({});
      }
    })();
    return () => {
      live = false;
    };
  }, [storeKey]);

  const save = (next: Record<string, Decision>) => {
    setDecisions(next);
    window.storage?.set(storeKey, JSON.stringify(next)).catch(() => {});
  };
  const setDec = (key: string, patch: Partial<Decision>) =>
    save({ ...decisions, [key]: { ...decisions[key], ...patch } });

  const dates = useMemo(() => periodDates(periodStart), [periodStart]);
  const sheetName = useMemo(() => {
    const a = parseISO(periodStart);
    const b = parseISO(addDays(periodStart, 13));
    return `${a.getUTCMonth() + 1}.${a.getUTCDate()}-${b.getUTCMonth() + 1}.${b.getUTCDate()}`;
  }, [periodStart]);

  const rows = useMemo(() => buildRows(data, dates, decisions), [data, dates, decisions]);
  const pays = useMemo(() => payouts(rows), [rows]);
  const days = useMemo(() => byDay(rows), [rows]);

  const offRoster = useMemo(
    () =>
      Array.from(new Set(pays.map((p) => p.person)))
        .filter((p) => !data.squad.includes(p))
        .sort((a, b) => a.localeCompare(b)),
    [pays, data.squad]
  );
  const people = useMemo(() => [...data.squad, ...offRoster], [data.squad, offRoster]);

  const poolCents = rows.reduce((s, r) => s + (r.pool ? toCents(r.pool.tips) : 0), 0);
  const readyCents = pays.filter((p) => !p.held).reduce((s, p) => s + p.cents, 0);
  const heldCents = pays.filter((p) => p.held).reduce((s, p) => s + p.cents, 0);
  const unassigned = poolCents - readyCents - heldCents;
  const pct = poolCents ? Math.round((readyCents / poolCents) * 100) : 0;

  const openTodos = rows.filter((r) => r.worst === 3);
  const edited = rows.filter((r) => r.tipsEdited || r.rosterEdited);
  const rowsByKey = useMemo(
    () => Object.fromEntries(rows.map((r) => [r.key, r])),
    [rows]
  );

  const openResolve = (key?: string) => {
    const keys = openTodos.map((r) => r.key);
    if (key && !keys.includes(key)) keys.unshift(key);
    setResolveKeys(keys);
    setResolveStartKey(key ?? null);
    setResolveEpoch((n) => n + 1);
    setTab("resolve");
  };

  const cellCents = (p: string, d: string) =>
    pays.filter((x) => x.person === p && x.date === d).reduce((s, x) => s + x.cents, 0);
  const rowCents = (p: string) => pays.filter((x) => x.person === p).reduce((s, x) => s + x.cents, 0);
  const colCents = (d: string) => pays.filter((x) => x.date === d).reduce((s, x) => s + x.cents, 0);

  const earners = people
    .map((p) => ({ p, c: rowCents(p) }))
    .filter((x) => x.c > 0)
    .sort((a, b) => b.c - a.c);
  const topEarn = earners[0]?.c ?? 1;

  const exportRows = () =>
    people.map((p) => [
      p,
      ...dates.map((d) => {
        const c = pays
          .filter((x) => x.person === p && x.date === d && !x.held)
          .reduce((s, x) => s + x.cents, 0);
        return c ? (c / 100).toFixed(2) : "";
      }),
    ]);

  async function copyForExcel() {
    try {
      await navigator.clipboard.writeText(exportRows().map((r) => r.join("\t")).join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  function downloadCSV() {
    const out: string[][] = [];
    out.push(["", ...dates.map(dowOf), "TOTAL"]);
    out.push(["Employee Names", ...dates.map(fullDate), ""]);
    exportRows().forEach((r) => out.push([...r, ""]));
    out.push([
      "TOTAL BY DATE",
      ...dates.map((d) => {
        const c = pays.filter((x) => x.date === d && !x.held).reduce((s, x) => s + x.cents, 0);
        return c ? (c / 100).toFixed(2) : "";
      }),
      (readyCents / 100).toFixed(2),
    ]);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([out.map((r) => r.map((v) => `"${v}"`).join(",")).join("\n")], { type: "text/csv" })
    );
    a.download = `tips_${sheetName}.csv`;
    a.click();
  }

  return (
    <div
      className="min-h-screen p-3 md:p-8"
      style={{
        background: "linear-gradient(140deg,#EDF4FA 0%,#DCEAF6 45%,#E7F0F8 100%)",
        fontFamily: "'DM Sans', system-ui, sans-serif",
      }}
    >
      <div
        className="mx-auto max-w-[1440px] rounded-[28px] p-4 md:rounded-[36px] md:p-7"
        style={{ background: C.shell, boxShadow: "0 30px 70px -30px rgba(20,60,80,.55)" }}
      >
        {/* nav */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-black text-lg font-bold text-white">
            ☕
          </div>
          <div className="flex items-center gap-2 rounded-full px-3 py-1.5" style={{ background: C.shellSoft }}>
            <button
              onClick={() => setPeriodStart(addDays(periodStart, -14))}
              className="text-white/50 transition hover:text-white"
            >
              ‹
            </button>
            <span className="text-sm font-medium text-white" style={HEAD}>
              {sheetName}
            </span>
            <button
              onClick={() => setPeriodStart(addDays(periodStart, 14))}
              className="text-white/50 transition hover:text-white"
            >
              ›
            </button>
          </div>

          <div className="ml-0 flex items-center gap-1 md:ml-6">
            {(
              [
                ["overview", "Overview"],
                ["shifts", "Shifts"],
                ["grid", "Payout Grid"],
                ...(openTodos.length > 0 || tab === "resolve"
                  ? ([["resolve", "Resolve"]] as ["resolve", "Resolve"][])
                  : []),
              ] as [typeof tab | "resolve", string][]
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => (k === "resolve" ? openResolve() : setTab(k))}
                className="rounded-full px-4 py-2 text-sm transition"
                style={{
                  ...HEAD,
                  background: tab === k ? C.sky : "transparent",
                  color: tab === k ? C.skyInk : "rgba(255,255,255,.72)",
                  fontWeight: tab === k ? 600 : 400,
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-3">
            {openTodos.length > 0 && (
              <button
                onClick={() => openResolve()}
                className="rounded-full px-3 py-1 text-xs font-bold transition hover:opacity-90"
                style={{ background: "#F8B4A8", color: "#5A1D14" }}
              >
                {openTodos.length} need you
              </button>
            )}
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-sm text-white">
              JM
            </div>
          </div>
        </div>

        {/* status strip */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <span
            className="rounded-full px-4 py-2 text-sm font-medium"
            style={{ background: "#A9E8B4", color: "#14402A" }}
          >
            {fullDate(periodStart)} – {fullDate(addDays(periodStart, 13))}
          </span>
          <span className="text-sm text-white/60">Courtyard Bozeman, MT</span>
          <span className="ml-0 text-lg text-white md:ml-6" style={HEAD}>
            <Amt cents={poolCents} />
            <span className="ml-2 text-sm text-white/50">POS pool</span>
          </span>
          <div className="ml-auto flex gap-2">
            <button
              onClick={copyForExcel}
              className="rounded-full bg-white px-5 py-2.5 text-sm font-medium transition hover:opacity-90"
              style={{ ...HEAD, color: C.ink }}
            >
              {copied ? "Copied · paste at A4" : "Copy for Excel"}
            </button>
            <button
              onClick={downloadCSV}
              className="rounded-full px-5 py-2.5 text-sm font-medium transition hover:opacity-90"
              style={{ ...HEAD, background: C.amber, color: "#4A3708" }}
            >
              Export CSV
            </button>
          </div>
        </div>

        {tab === "overview" && (
          <>
            {/* hero */}
            <div className="mb-6 grid gap-4 lg:grid-cols-[1fr_1.1fr_1fr]">
              <div
                className="flex flex-col justify-between rounded-3xl p-6"
                style={{ background: "rgba(255,255,255,.09)" }}
              >
                <h1
                  className="text-[42px] leading-[0.95] text-white/95 md:text-[52px]"
                  style={{ ...HEAD, fontWeight: 600 }}
                >
                  Tips
                  <br />
                  by
                  <br />
                  <span className="text-white/40">Handoff</span>
                </h1>
                <div className="mt-6">
                  <div className="text-xs text-white/45">Level5 worksheet</div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-white" style={HEAD}>
                      Sheet {sheetName}
                    </span>
                    <button
                      onClick={() => setTab("grid")}
                      className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15 text-white/70 transition hover:bg-white/25"
                    >
                      ›
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-center rounded-3xl py-4">
                <Donut ready={readyCents} held={heldCents} pool={poolCents} pct={pct} />
              </div>

              <div className="rounded-3xl p-6" style={{ background: "rgba(255,255,255,.09)" }}>
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-white/90" style={{ ...HEAD, fontWeight: 500 }}>
                    Squad earnings
                  </span>
                  <span className="text-xs text-white/45">{earners.length} paid</span>
                </div>
                <div className="space-y-3">
                  {earners.slice(0, 5).map(({ p, c }) => (
                    <div key={p}>
                      <div className="mb-1 flex items-baseline justify-between text-sm">
                        <span className="text-white/85">{p}</span>
                        <span className="text-white">
                          <Amt cents={c} />
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-white/12">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${(c / topEarn) * 100}%`, background: "#8FE0A8" }}
                        />
                      </div>
                    </div>
                  ))}
                  {earners.length === 0 && (
                    <p className="text-sm text-white/50">No payouts in this period yet.</p>
                  )}
                </div>
              </div>
            </div>

            {/* shift strip */}
            <div className="mb-6">
              <div className="flex flex-wrap items-center gap-6">
                <h2 className="text-[40px] leading-none text-white/95" style={{ ...HEAD, fontWeight: 600 }}>
                  Shifts
                </h2>
                <div className="flex flex-1 gap-3 overflow-x-auto pb-2">
                  {rows.length === 0 && (
                    <div className="rounded-2xl bg-white/8 px-5 py-4 text-sm text-white/50">
                      No handoffs or tip records in this period.
                    </div>
                  )}
                  {rows.map((r) => {
                    const active = focus === r.key;
                    const flagged = r.worst === 3;
                    return (
                      <button
                        key={r.key}
                        onClick={() => {
                          setFocus(r.key);
                          setTab("shifts");
                        }}
                        className="min-w-[210px] shrink-0 rounded-2xl p-4 text-left transition"
                        style={{
                          background: active ? "#fff" : "rgba(255,255,255,.09)",
                          color: active ? C.ink : "#fff",
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <span style={{ ...HEAD, fontWeight: 600, fontSize: 17 }}>
                            {dowOf(r.date)} {shortDate(r.date)}
                          </span>
                          <span
                            className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                            style={{
                              background: r.shift === "AM" ? "#BEDDF7" : "#D6CCF5",
                              color: r.shift === "AM" ? "#123249" : "#2E2159",
                            }}
                          >
                            {r.shift}
                          </span>
                        </div>
                        <div className={`mt-3 flex items-end justify-between ${active ? "" : "opacity-70"}`}>
                          <span className="text-xs">
                            {r.handoffPeople.length
                              ? `${r.handoffPeople.length} on handoff`
                              : "no handoff"}
                          </span>
                          <span style={{ ...HEAD, fontWeight: 600 }}>
                            {r.pool ? <Amt cents={toCents(r.pool.tips)} /> : "—"}
                          </span>
                        </div>
                        {flagged && (
                          <div
                            className="mt-2 rounded-lg px-2 py-1 text-[10px] font-bold"
                            style={{ background: "#F8B4A8", color: "#5A1D14" }}
                          >
                            {r.pool?.provisional ? "PROVISIONAL" : "NO HANDOFF"}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* three panels */}
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-3xl p-6" style={{ background: C.mint, color: C.mintInk }}>
                <div className="mb-5 flex items-center justify-between">
                  <span className="text-[22px]" style={{ ...HEAD, fontWeight: 600 }}>
                    Payout Summary
                  </span>
                  <button
                    onClick={() => setTab("grid")}
                    className="flex items-center gap-2 text-sm opacity-70 transition hover:opacity-100"
                  >
                    Full grid
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black/10">›</span>
                  </button>
                </div>
                <div className="mb-2 flex text-xs opacity-55">
                  <span className="flex-1">Name</span>
                  <span className="w-24 text-right">Paid</span>
                  <span className="ml-4 w-20">Share</span>
                </div>
                <div className="space-y-2.5">
                  {earners.slice(0, 6).map(({ p, c }) => (
                    <div key={p} className="flex items-center text-sm">
                      <span className="flex-1 truncate pr-2">{p}</span>
                      <span className="w-24 text-right" style={{ fontWeight: 600 }}>
                        <Amt cents={c} />
                      </span>
                      <span className="ml-4 h-1.5 w-20 overflow-hidden rounded-full bg-black/10">
                        <span
                          className="block h-full rounded-full"
                          style={{
                            width: `${poolCents ? (c / poolCents) * 100 : 0}%`,
                            background: "#2E9E63",
                          }}
                        />
                      </span>
                    </div>
                  ))}
                  {earners.length === 0 && <p className="text-sm opacity-60">Nothing allocated yet.</p>}
                </div>
                <div className="mt-4 flex items-center border-t border-black/10 pt-3 text-sm">
                  <span className="flex-1" style={{ fontWeight: 600 }}>
                    Total
                  </span>
                  <span className="w-24 text-right" style={{ fontWeight: 700 }}>
                    <Amt cents={readyCents + heldCents} />
                  </span>
                  <span className="ml-4 w-20" />
                </div>
              </div>

              <div className="rounded-3xl p-6" style={{ background: "rgba(255,255,255,.09)" }}>
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-white/90" style={{ ...HEAD, fontWeight: 500 }}>
                    Before payroll
                  </span>
                  <span className="text-xs text-white/45">
                    {openTodos.length ? `${openTodos.length} open` : "all clear"}
                  </span>
                </div>
                <div className="space-y-2">
                  {openTodos.length === 0 && (
                    <div className="flex items-center gap-3 rounded-2xl px-4 py-3 text-sm"
                      style={{ background: "#A9E8B4", color: "#14402A" }}>
                      <span className="flex h-5 w-5 items-center justify-center rounded-full text-[11px] text-white"
                        style={{ background: "#14402A" }}>✓</span>
                      Nothing blocking. Every pool has someone to pay.
                    </div>
                  )}
                  {openTodos.length > 0 && (
                    <button
                      onClick={() => openResolve()}
                      className="mb-1 w-full rounded-2xl px-4 py-3 text-left text-sm font-semibold transition hover:opacity-90"
                      style={{ background: C.mint, color: C.mintInk }}
                    >
                      Resolve {openTodos.length} open shift{openTodos.length > 1 ? "s" : ""} →
                    </button>
                  )}
                  {openTodos.map((r) => (
                    <button
                      key={r.key}
                      onClick={() => openResolve(r.key)}
                      className="flex w-full items-center gap-3 rounded-2xl bg-white px-4 py-3 text-left text-sm transition hover:opacity-90"
                      style={{ color: C.ink }}
                    >
                      <span
                        className="h-5 w-5 shrink-0 rounded-full"
                        style={{ border: "1.5px solid rgba(0,0,0,.25)" }}
                      />
                      <span>
                        {r.held ? "Release or enter settled" : "Assign tips"} · {dowOf(r.date)}{" "}
                        {shortDate(r.date)} {r.shift}
                      </span>
                      <span className="ml-auto" style={{ fontWeight: 600 }}>
                        <Amt cents={r.cents} />
                      </span>
                    </button>
                  ))}
                  {edited.length > 0 && (
                    <div className="pt-2 text-xs text-white/45">
                      {edited.length} shift{edited.length > 1 ? "s" : ""} edited by hand this period
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-3xl p-6" style={{ background: C.sky, color: C.skyInk }}>
                <div className="mb-5 flex items-center justify-between">
                  <span className="text-[22px]" style={{ ...HEAD, fontWeight: 600 }}>
                    Money Status
                  </span>
                </div>
                <MoneyLine label="Ready to pay" cents={readyCents} pool={poolCents} color="#2E9E63" />
                <MoneyLine label="Held, provisional" cents={heldCents} pool={poolCents} color="#E8A33D" />
                <MoneyLine label="Unassigned" cents={unassigned} pool={poolCents} color="#E2705C" />
                <div className="mt-5 border-t border-black/10 pt-3">
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm opacity-60">POS pool</span>
                    <span className="text-[20px]" style={{ ...HEAD, fontWeight: 600 }}>
                      <Amt cents={poolCents} />
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {tab === "resolve" && (
          <ResolveDeck
            key={resolveEpoch}
            rowsByKey={rowsByKey}
            initialKeys={resolveKeys.length ? resolveKeys : openTodos.map((r) => r.key)}
            startKey={resolveStartKey}
            squad={data.squad}
            onChange={setDec}
            onReset={(key) => {
              const next = { ...decisions };
              delete next[key];
              save(next);
            }}
            onExit={() => setTab("overview")}
          />
        )}

        {tab === "shifts" && (
          <div className="space-y-7">
            {days.length === 0 && (
              <div className="rounded-3xl bg-white/10 p-8 text-center text-white/60">
                No handoffs or tip records in this pay period.
              </div>
            )}
            {days.map(({ date, rows: dayRows, cents }) => (
              <div key={date}>
                <div className="mb-3 flex flex-wrap items-baseline gap-3 border-b border-white/12 pb-2">
                  <h3 className="text-[30px] leading-none text-white/95" style={{ ...HEAD, fontWeight: 600 }}>
                    {dowFullOf(date)}
                  </h3>
                  <span className="text-white/45" style={HEAD}>
                    {fullDate(date)}
                  </span>
                  <span className="ml-auto flex items-center gap-3">
                    <span className="text-xs text-white/40">
                      {dayRows.length} shift{dayRows.length > 1 ? "s" : ""}
                    </span>
                    <span className="text-[19px] text-white" style={{ ...HEAD, fontWeight: 600 }}>
                      <Amt cents={cents} />
                    </span>
                  </span>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {dayRows.map((r) => (
                    <ShiftCard
                      key={r.key}
                      row={r}
                      squad={data.squad}
                      focused={focus === r.key}
                      onChange={(patch) => setDec(r.key, patch)}
                      onReset={() => {
                        const next = { ...decisions };
                        delete next[r.key];
                        save(next);
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "grid" && (
          <div className="rounded-3xl bg-white p-5 md:p-6" style={{ color: C.ink }}>
            <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-[26px] leading-tight" style={{ ...HEAD, fontWeight: 600 }}>
                  Paste into the Level5 worksheet
                </h2>
                <ol className="mt-2 space-y-0.5 text-sm opacity-70">
                  <li>1. Duplicate the last sheet, rename it <b>{sheetName}</b>.</li>
                  <li>2. Set <b>B2</b> to <b>{fullDate(periodStart)}</b>. The rest fill themselves.</li>
                  <li>3. Copy for Excel, click <b>A4</b>, paste.</li>
                  <li>4. Leave column <b>P</b> and row <b>16</b> alone. The SUM formulas still work.</li>
                </ol>
              </div>
              <div className="flex flex-col gap-2">
                {heldCents > 0 && (
                  <span
                    className="rounded-xl px-3 py-2 text-xs font-semibold"
                    style={{ background: "#FBE6B8", color: "#5A4108" }}
                  >
                    ${money(heldCents)} held, excluded from the copy
                  </span>
                )}
                {unassigned > 0 && (
                  <span
                    className="rounded-xl px-3 py-2 text-xs font-semibold"
                    style={{ background: "#FAD9D2", color: "#5A1D14" }}
                  >
                    ${money(unassigned)} unassigned, excluded
                  </span>
                )}
              </div>
            </div>

            <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: "#E3EAF0" }}>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr style={{ background: "#F4F8FB" }}>
                    <th
                      className="sticky left-0 z-10 min-w-[160px] p-3 text-left text-xs font-semibold uppercase tracking-wide opacity-55"
                      style={{ background: "#F4F8FB" }}
                    >
                      Employee
                    </th>
                    {dates.map((d) => (
                      <th key={d} className="p-2 text-center">
                        <div className="text-[10px] uppercase opacity-45">{dowOf(d)}</div>
                        <div className="text-xs font-semibold">{shortDate(d)}</div>
                      </th>
                    ))}
                    <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide opacity-55">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((p, i) => (
                    <tr key={p} style={{ background: i % 2 ? "#FAFCFD" : "#fff" }}>
                      <td
                        className="sticky left-0 z-10 p-3 font-medium"
                        style={{ background: i % 2 ? "#FAFCFD" : "#fff" }}
                      >
                        {p}
                        {offRoster.includes(p) && (
                          <span
                            className="ml-2 rounded px-1.5 py-0.5 text-[9px] font-bold"
                            style={{ background: "#FAD9D2", color: "#5A1D14" }}
                          >
                            OFF ROSTER
                          </span>
                        )}
                      </td>
                      {dates.map((d) => {
                        const c = cellCents(p, d);
                        const held = pays.some((x) => x.person === p && x.date === d && x.held);
                        return (
                          <td
                            key={d}
                            className="p-2 text-right tabular-nums"
                            style={{
                              background: held ? "#FBE6B8" : undefined,
                              opacity: c ? 1 : 0.22,
                              fontWeight: c ? 500 : 400,
                            }}
                          >
                            {c ? money(c) : "·"}
                          </td>
                        );
                      })}
                      <td className="p-3 text-right" style={{ fontWeight: 600 }}>
                        <Amt cents={rowCents(p)} />
                      </td>
                    </tr>
                  ))}
                  <tr style={{ background: "#EDF6F0" }}>
                    <td className="sticky left-0 z-10 p-3 text-xs font-bold uppercase tracking-wide" style={{ background: "#EDF6F0" }}>
                      Total by date
                    </td>
                    {dates.map((d) => (
                      <td key={d} className="p-2 text-right tabular-nums" style={{ fontWeight: 600 }}>
                        {colCents(d) ? money(colCents(d)) : ""}
                      </td>
                    ))}
                    <td className="p-3 text-right" style={{ fontWeight: 700 }}>
                      <Amt cents={readyCents + heldCents} />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p className="mt-6 text-center text-[11px] text-white/35">
          {source === "live" ? "Live" : source === "snapshot" ? "SNAPSHOT, not live" : "Loading"} ·
          pulled {data.pulledAt} · read-only, writes nothing to Airtable ·{" "}
          {data.pools.length} tip records · {data.handoffs.length} handoffs
        </p>
      </div>
    </div>
  );
}

function Donut({
  ready,
  held,
  pool,
  pct,
}: {
  ready: number;
  held: number;
  pool: number;
  pct: number;
}) {
  const R = 108;
  const CIRC = 2 * Math.PI * R;
  const readyLen = pool ? (ready / pool) * CIRC : 0;
  const heldLen = pool ? (held / pool) * CIRC : 0;

  return (
    <div className="relative" style={{ width: 268, height: 268 }}>
      <svg width="268" height="268" viewBox="0 0 268 268" className="-rotate-90">
        <circle cx="134" cy="134" r={R} fill="none" stroke="rgba(255,255,255,.13)" strokeWidth="26" />
        <circle
          cx="134"
          cy="134"
          r={R}
          fill="none"
          stroke="#CFF2A8"
          strokeWidth="26"
          strokeLinecap="round"
          strokeDasharray={`${heldLen} ${CIRC}`}
          strokeDashoffset={-readyLen}
        />
        <circle
          cx="134"
          cy="134"
          r={R}
          fill="none"
          stroke="#79D3A4"
          strokeWidth="26"
          strokeLinecap="round"
          strokeDasharray={`${readyLen} ${CIRC}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm text-white/60">Ready to pay</span>
        <span className="text-[64px] leading-none text-white" style={{ ...HEAD, fontWeight: 500 }}>
          {pct}%
        </span>
        <span className="mt-1 text-sm text-white/70">
          <Amt cents={ready} />
          <span className="mx-1.5 text-white/35">of</span>
          <span className="text-white/50">
            <Amt cents={pool} />
          </span>
        </span>
      </div>
    </div>
  );
}

function MoneyLine({
  label,
  cents,
  pool,
  color,
}: {
  label: string;
  cents: number;
  pool: number;
  color: string;
}) {
  return (
    <div className="mb-4">
      <div className="flex items-baseline justify-between">
        <span className="text-sm opacity-60">{label}</span>
        <span className="text-[17px]" style={{ ...HEAD, fontWeight: 600 }}>
          <Amt cents={cents} />
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-black/10">
        <div
          className="h-full rounded-full"
          style={{ width: `${pool ? (cents / pool) * 100 : 0}%`, background: color }}
        />
      </div>
    </div>
  );
}

function ShiftCard({
  row,
  squad,
  focused,
  onChange,
  onReset,
}: {
  row: Row;
  squad: string[];
  focused: boolean;
  onChange: (patch: Partial<Decision>) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (open) setDraft((row.cents / 100).toFixed(2));
  }, [open, row.cents]);

  const split = splitCents(row.cents, row.people);
  const edited = row.tipsEdited || row.rosterEdited;

  // everyone selectable: full roster plus anyone on the handoff who is not on it
  const options = Array.from(new Set([...squad, ...row.handoffPeople]));

  const commitTips = () => {
    const n = parseFloat(draft.replace(/[^0-9.]/g, ""));
    if (!isNaN(n) && n >= 0) onChange({ tips: Math.round(n * 100) / 100 });
  };

  const toggle = (p: string) => {
    const cur = row.people;
    onChange({ manual: cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p] });
  };

  const bump = (delta: number) => {
    const n = Math.max(0, Math.round((row.cents + delta * 100)) / 100);
    onChange({ tips: n });
  };

  return (
    <div
      className="rounded-3xl bg-white p-5 transition"
      style={{ color: C.ink, outline: focused ? `3px solid ${C.amber}` : "none", outlineOffset: 2 }}
    >
      <div className="flex items-center gap-2">
        <span className="text-[19px]" style={{ ...HEAD, fontWeight: 600 }}>
          {row.shift}
        </span>
        {row.roles.map((r) => (
          <span
            key={r}
            className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-semibold uppercase opacity-60"
          >
            {r}
          </span>
        ))}
        {edited && (
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-bold"
            style={{ background: "#E4DAF8", color: "#3A2668" }}
          >
            EDITED
          </span>
        )}
        <button
          onClick={() => setOpen(!open)}
          className="ml-auto rounded-full px-3 py-1.5 text-xs font-medium transition"
          style={{ background: open ? C.ink : "#EEF3F7", color: open ? "#fff" : C.ink }}
        >
          {open ? "Done" : "Edit"}
        </button>
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-[30px]" style={{ ...HEAD, fontWeight: 600 }}>
          {row.cents ? <Amt cents={row.cents} /> : <span className="opacity-25">$0.00</span>}
        </span>
        {row.tipsEdited && row.pool && (
          <span className="text-xs line-through opacity-35">
            ${money(toCents(row.pool.tips))}
          </span>
        )}
        {row.people.length > 0 && row.cents > 0 && (
          <span className="ml-auto text-xs opacity-45">
            ${money(Math.floor(row.cents / row.people.length))} each · {row.people.length} way
          </span>
        )}
      </div>

      {row.flags.map((f) => (
        <div
          key={f.code}
          className="mt-3 rounded-xl px-3 py-2 text-xs font-medium"
          style={{
            background:
              f.severity === 3 ? "#FAD9D2" : f.code === "EDITED" ? "#EDE7FA" : "#FBF3D2",
            color: f.severity === 3 ? "#5A1D14" : f.code === "EDITED" ? "#3A2668" : "#5A4108",
          }}
        >
          {f.text}
        </div>
      ))}

      {/* payout chips */}
      <div className="mt-4">
        {row.people.length === 0 ? (
          <p className="text-sm opacity-45">Nobody assigned.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {row.people.map((p) => (
              <span
                key={p}
                className="rounded-full px-3 py-1.5 text-sm"
                style={{
                  background: row.held ? "#FBE6B8" : row.cents ? "#B7EFC8" : "#EEF3F7",
                  color: row.held ? "#5A4108" : C.mintInk,
                  fontWeight: 500,
                }}
              >
                {p}
                {row.cents > 0 && (
                  <>
                    {" · "}
                    <b>
                      <Amt cents={split[p] ?? 0} />
                    </b>
                  </>
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* editor */}
      {open && (
        <div className="mt-4 rounded-2xl p-4" style={{ background: "#F4F8FB" }}>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide opacity-50">
            Tip pool
          </div>
          <div className="flex items-center gap-2">
            <div
              className="flex flex-1 items-center rounded-xl bg-white px-3 py-2"
              style={{ border: "1px solid #DCE6EE" }}
            >
              <span className="mr-1 opacity-40">$</span>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitTips}
                onKeyDown={(e) => e.key === "Enter" && commitTips()}
                inputMode="decimal"
                className="w-full bg-transparent text-lg tabular-nums outline-none"
                style={{ ...HEAD, fontWeight: 600 }}
              />
            </div>
            <button
              onClick={() => bump(-1)}
              className="h-10 w-10 rounded-xl bg-white text-lg"
              style={{ border: "1px solid #DCE6EE" }}
            >
              −
            </button>
            <button
              onClick={() => bump(1)}
              className="h-10 w-10 rounded-xl bg-white text-lg"
              style={{ border: "1px solid #DCE6EE" }}
            >
              +
            </button>
          </div>
          {row.pool && (
            <p className="mt-1.5 text-[11px] opacity-45">
              POS reported ${money(toCents(row.pool.tips))}
              {row.pool.provisional && ` with ${row.pool.outstandingChecks} check(s) still open`}.
            </p>
          )}

          <div className="mb-1.5 mt-4 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide opacity-50">
              Split between
            </span>
            <span className="text-[11px] opacity-45">
              {row.people.length} selected
              {row.handoffPeople.length > 0 && ` · handoff had ${row.handoffPeople.length}`}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {options.map((p) => {
              const on = row.people.includes(p);
              const fromHandoff = row.handoffPeople.includes(p);
              return (
                <button
                  key={p}
                  onClick={() => toggle(p)}
                  className="rounded-full px-3 py-1.5 text-xs transition"
                  style={{
                    background: on ? "#2E9E63" : "#fff",
                    color: on ? "#fff" : C.ink,
                    fontWeight: on ? 600 : 400,
                    border: on
                      ? "none"
                      : fromHandoff
                        ? "1.5px dashed #2E9E63"
                        : "1px solid rgba(0,0,0,.12)",
                  }}
                >
                  {p}
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {row.held && (
              <button
                onClick={() => onChange({ approved: true })}
                className="rounded-full px-4 py-2 text-xs font-medium"
                style={{ background: C.amber, color: "#4A3708" }}
              >
                Release provisional as-is
              </button>
            )}
            {edited && (
              <button
                onClick={onReset}
                className="rounded-full px-4 py-2 text-xs font-medium"
                style={{ background: "#fff", color: C.ink, border: "1px solid rgba(0,0,0,.12)" }}
              >
                Reset to source
              </button>
            )}
            <span className="ml-auto text-[11px] opacity-45">Changes save automatically</span>
          </div>
        </div>
      )}
    </div>
  );
}
