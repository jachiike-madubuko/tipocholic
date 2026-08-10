import { useEffect, useMemo, useState } from "react";
import {
  Decision,
  Row,
  dowFullOf,
  money,
  shortDate,
  splitCents,
  toCents,
} from "./engine";

const C = {
  ink: "#0E2A35",
  amber: "#F6D372",
  sky: "#BEDDF7",
  skyInk: "#123249",
};

const HEAD = { fontFamily: "Outfit, system-ui, sans-serif" };

function Amt({ cents }: { cents: number }) {
  const s = money(cents);
  const [d, c] = s.split(".");
  return (
    <span className="tabular-nums">
      ${d}
      <span className="opacity-45">.{c}</span>
    </span>
  );
}

function canConfirm(row: Row) {
  return row.worst < 3;
}

function confirmHint(row: Row) {
  if (row.held) return "Enter the settled amount or release the provisional pool.";
  if (row.cents > 0 && row.people.length === 0) return "Pick who shares this pool, then confirm.";
  return "Ready to confirm.";
}

export function ResolveDeck({
  rowsByKey,
  initialKeys,
  startKey,
  squad,
  onChange,
  onReset,
  onExit,
}: {
  rowsByKey: Record<string, Row>;
  /** Snapshot of open blockers when the deck opened. Survives live resolution until Confirm. */
  initialKeys: string[];
  startKey: string | null;
  squad: string[];
  onChange: (key: string, patch: Partial<Decision>) => void;
  onReset: (key: string) => void;
  onExit: () => void;
}) {
  const [keys] = useState(initialKeys);
  const [cursor, setCursor] = useState(() => {
    if (!startKey) return 0;
    const i = initialKeys.indexOf(startKey);
    return i >= 0 ? i : 0;
  });
  const [exitDir, setExitDir] = useState<"left" | "right" | null>(null);
  const [draft, setDraft] = useState("");

  const remaining = useMemo(() => keys.slice(cursor), [keys, cursor]);
  const currentKey = remaining[0] ?? null;
  const current = currentKey ? rowsByKey[currentKey] ?? null : null;
  const behind = remaining.slice(1, 3).map((k) => rowsByKey[k]).filter(Boolean) as Row[];

  useEffect(() => {
    if (current) setDraft((current.cents / 100).toFixed(2));
  }, [current?.key, current?.cents]);

  const advance = (dir: "left" | "right") => {
    if (!current || exitDir) return;
    setExitDir(dir);
    window.setTimeout(() => {
      setExitDir(null);
      setCursor((c) => c + 1);
    }, 280);
  };

  const confirm = () => {
    if (!current || !canConfirm(current)) return;
    advance("right");
  };

  const skip = () => {
    if (!current) return;
    advance("left");
  };

  if (!currentKey || !current) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center py-16 text-center">
        <div
          className="mb-5 flex h-16 w-16 items-center justify-center rounded-full text-2xl text-white"
          style={{ background: "#2E9E63" }}
        >
          ✓
        </div>
        <h2 className="text-[36px] leading-none text-white" style={{ ...HEAD, fontWeight: 600 }}>
          All clear
        </h2>
        <p className="mt-3 max-w-sm text-sm text-white/55">
          You worked through every open shift. Unassigned and held pools are cleared for this pass.
        </p>
        <button
          onClick={onExit}
          className="mt-8 rounded-full px-6 py-3 text-sm font-semibold"
          style={{ background: C.sky, color: C.skyInk }}
        >
          Back to Overview
        </button>
      </div>
    );
  }

  const options = Array.from(new Set([...squad, ...current.handoffPeople]));
  const split = splitCents(current.cents, current.people);
  const edited = current.tipsEdited || current.rosterEdited;
  const ready = canConfirm(current);
  const position = cursor + 1;

  const commitTips = () => {
    const n = parseFloat(draft.replace(/[^0-9.]/g, ""));
    if (!isNaN(n) && n >= 0) onChange(current.key, { tips: Math.round(n * 100) / 100 });
  };

  const toggle = (p: string) => {
    const cur = current.people;
    onChange(current.key, {
      manual: cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p],
    });
  };

  const bump = (delta: number) => {
    const n = Math.max(0, Math.round(current.cents + delta * 100) / 100);
    onChange(current.key, { tips: n });
  };

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[36px] leading-none text-white" style={{ ...HEAD, fontWeight: 600 }}>
            Resolve
          </h2>
          <p className="mt-2 text-sm text-white/50">
            One shift at a time. Confirm when the pool is ready to pay.
          </p>
        </div>
        <div className="text-right">
          <div className="text-[28px] text-white tabular-nums" style={{ ...HEAD, fontWeight: 600 }}>
            {position}
            <span className="text-white/35">/{keys.length}</span>
          </div>
          <div className="text-[11px] uppercase tracking-wide text-white/40">this pass</div>
        </div>
      </div>

      <div className="relative mx-auto h-[min(640px,78vh)] w-full">
        {behind
          .map((row, i) => ({ row, i }))
          .reverse()
          .map(({ row, i }) => (
            <div
              key={row.key}
              className="resolve-stack-card absolute inset-x-0 top-0"
              style={{
                transform: `translateY(${(i + 1) * 10}px) scale(${1 - (i + 1) * 0.03})`,
                opacity: 0.55 - i * 0.12,
                zIndex: 10 - i,
              }}
              aria-hidden
            >
              <div className="rounded-[28px] bg-white/90 p-5 shadow-lg" style={{ color: C.ink }}>
                <div className="flex items-baseline justify-between">
                  <span style={{ ...HEAD, fontWeight: 600 }}>
                    {dowFullOf(row.date)} {row.shift}
                  </span>
                  <Amt cents={row.cents} />
                </div>
              </div>
            </div>
          ))}

        <div
          key={current.key}
          className={`resolve-front-card absolute inset-x-0 top-0 z-20 ${
            exitDir === "right"
              ? "resolve-exit-right"
              : exitDir === "left"
                ? "resolve-exit-left"
                : "resolve-enter"
          }`}
        >
          <div
            className="flex max-h-[min(640px,78vh)] flex-col overflow-hidden rounded-[28px] bg-white shadow-2xl"
            style={{ color: C.ink }}
          >
            <div className="border-b border-black/5 px-5 pb-4 pt-5">
              <div className="flex items-center gap-2">
                <span
                  className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide"
                  style={{
                    background: current.held ? "#FBE6B8" : "#FAD9D2",
                    color: current.held ? "#5A4108" : "#5A1D14",
                  }}
                >
                  {current.held ? "Held" : "Unassigned"}
                </span>
                {edited && (
                  <span
                    className="rounded-full px-2.5 py-1 text-[10px] font-bold"
                    style={{ background: "#E4DAF8", color: "#3A2668" }}
                  >
                    EDITED
                  </span>
                )}
                {ready && (
                  <span
                    className="rounded-full px-2.5 py-1 text-[10px] font-bold"
                    style={{ background: "#B7EFC8", color: "#14402A" }}
                  >
                    Ready
                  </span>
                )}
                <button
                  onClick={onExit}
                  className="ml-auto text-xs font-medium opacity-40 transition hover:opacity-70"
                >
                  Close
                </button>
              </div>

              <div className="mt-3 flex items-end justify-between gap-3">
                <div>
                  <div className="text-[32px] leading-none" style={{ ...HEAD, fontWeight: 600 }}>
                    {dowFullOf(current.date)}
                  </div>
                  <div className="mt-1 text-sm opacity-45">
                    {shortDate(current.date)} · {current.shift}
                    {current.roles.length > 0 && ` · ${current.roles.join(", ")}`}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[34px] leading-none" style={{ ...HEAD, fontWeight: 600 }}>
                    {current.cents ? (
                      <Amt cents={current.cents} />
                    ) : (
                      <span className="opacity-25">$0.00</span>
                    )}
                  </div>
                  {current.people.length > 0 && current.cents > 0 && (
                    <div className="mt-1 text-xs opacity-45">
                      ${money(Math.floor(current.cents / current.people.length))} each ·{" "}
                      {current.people.length} way
                    </div>
                  )}
                </div>
              </div>

              {current.flags
                .filter((f) => f.code !== "EDITED")
                .map((f) => (
                  <div
                    key={f.code}
                    className="mt-4 rounded-2xl px-3 py-2.5 text-xs font-medium"
                    style={{
                      background:
                        f.severity === 3 ? "#FAD9D2" : f.code === "EDITED" ? "#EDE7FA" : "#FBF3D2",
                      color:
                        f.severity === 3 ? "#5A1D14" : f.code === "EDITED" ? "#3A2668" : "#5A4108",
                    }}
                  >
                    {f.text}
                  </div>
                ))}
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide opacity-50">
                Tip pool
              </div>
              <div className="flex items-center gap-2">
                <div
                  className="flex flex-1 items-center rounded-xl bg-[#F4F8FB] px-3 py-2.5"
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
                  className="h-11 w-11 rounded-xl bg-[#F4F8FB] text-lg"
                  style={{ border: "1px solid #DCE6EE" }}
                >
                  −
                </button>
                <button
                  onClick={() => bump(1)}
                  className="h-11 w-11 rounded-xl bg-[#F4F8FB] text-lg"
                  style={{ border: "1px solid #DCE6EE" }}
                >
                  +
                </button>
              </div>
              {current.pool && (
                <p className="mt-1.5 text-[11px] opacity-45">
                  POS reported ${money(toCents(current.pool.tips))}
                  {current.pool.provisional &&
                    ` with ${current.pool.outstandingChecks} check(s) still open`}
                  .
                </p>
              )}

              <div className="mb-1.5 mt-5 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide opacity-50">
                  Split between
                </span>
                <span className="text-[11px] opacity-45">
                  {current.people.length} selected
                  {current.handoffPeople.length > 0 &&
                    ` · handoff had ${current.handoffPeople.length}`}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {options.map((p) => {
                  const on = current.people.includes(p);
                  const fromHandoff = current.handoffPeople.includes(p);
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
                      {on && current.cents > 0 && (
                        <span className="ml-1 opacity-80">
                          · <Amt cents={split[p] ?? 0} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {(current.held || edited) && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {current.held && (
                    <button
                      onClick={() => onChange(current.key, { approved: true })}
                      className="rounded-full px-4 py-2 text-xs font-medium"
                      style={{ background: C.amber, color: "#4A3708" }}
                    >
                      Release provisional as-is
                    </button>
                  )}
                  {edited && (
                    <button
                      onClick={() => onReset(current.key)}
                      className="rounded-full px-4 py-2 text-xs font-medium"
                      style={{
                        background: "#fff",
                        color: C.ink,
                        border: "1px solid rgba(0,0,0,.12)",
                      }}
                    >
                      Reset to source
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="border-t border-black/5 px-5 py-4">
              <p className="mb-3 text-center text-xs opacity-45">{confirmHint(current)}</p>
              <div className="flex gap-3">
                <button
                  onClick={skip}
                  disabled={!!exitDir}
                  className="flex-1 rounded-full py-3.5 text-sm font-semibold transition disabled:opacity-30"
                  style={{ background: "#EEF3F7", color: C.ink }}
                >
                  Skip
                </button>
                <button
                  onClick={confirm}
                  disabled={!ready || !!exitDir}
                  className="flex-[1.4] rounded-full py-3.5 text-sm font-semibold text-white transition disabled:opacity-35"
                  style={{ background: ready ? "#2E9E63" : "#9BB0BB" }}
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
