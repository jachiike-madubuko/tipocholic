import type { Shift } from "./data";

export type PersistShiftInput = {
  date: string;
  shift: Shift;
  tips?: number;
  people?: string[];
  clearProvisional?: boolean;
  reason?: string;
};

export type PersistShiftResult = {
  ok: true;
  key: string;
  written: string[];
};

/** Writes tip amount and/or handoff roster to Airtable via /api/tips. */
export async function persistShift(input: PersistShiftInput): Promise<PersistShiftResult> {
  const res = await fetch("/api/tips", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = (await res.json()) as PersistShiftResult & { error?: string };
  if (!res.ok || json.error) {
    throw new Error(json.error || `Save failed (${res.status})`);
  }
  return json;
}
