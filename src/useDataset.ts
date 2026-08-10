import { useCallback, useEffect, useState } from "react";
import { Dataset, SNAPSHOT } from "./data";

export type Source = "live" | "snapshot" | "loading";

/**
 * Loads the dataset from /api/tips, falling back to the baked-in snapshot.
 *
 * The fallback is deliberate but not silent: `source` is surfaced in the UI so a
 * stale snapshot can never masquerade as live data. That exact failure shipped
 * once already, and the numbers looked completely plausible while being days old.
 */
export function useDataset(periodStart?: string) {
  const [data, setData] = useState<Dataset>(SNAPSHOT);
  const [source, setSource] = useState<Source>("loading");
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const qs = periodStart ? `?start=${periodStart}` : "";
        const res = await fetch(`/api/tips${qs}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`API ${res.status}`);
        const json = (await res.json()) as Dataset & { error?: string };
        if (json.error) throw new Error(json.error);
        if (!Array.isArray(json.pools) || !Array.isArray(json.handoffs))
          throw new Error("Unexpected response shape");
        if (!live) return;
        // Keep the locked roster order from the snapshot if the API omits it.
        setData({ ...json, squad: json.squad?.length ? json.squad : SNAPSHOT.squad });
        setSource("live");
        setError(null);
      } catch (e) {
        if (!live) return;
        setData(SNAPSHOT);
        setSource("snapshot");
        setError((e as Error).message);
      }
    })();
    return () => {
      live = false;
    };
  }, [periodStart, tick]);

  return { data, source, error, reload };
}
