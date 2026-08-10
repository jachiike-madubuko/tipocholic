/**
 * GET /api/tips?start=YYYY-MM-DD
 *
 * Reads POS Tip Summary + Handoffs from Airtable and returns the Dataset shape
 * that src/data.ts defines. Runs server-side so the PAT never reaches the client.
 *
 * Env:
 *   AIRTABLE_PAT      personal access token, scopes: data.records:read, schema.bases:read
 *   AIRTABLE_BASE_ID  defaults to appbhZtJ44f7jvxrB
 *
 * Note on linked records: the REST API returns Squad as record IDs, not names
 * (the MCP tool resolves them for you, raw REST does not). So we fetch the Squad
 * table and build an id -> name map first. The primary field ID comes from the
 * meta endpoint rather than being hardcoded, so renaming a field will not break it.
 */

const BASE = process.env.AIRTABLE_BASE_ID || "appbhZtJ44f7jvxrB";
const PAT = process.env.AIRTABLE_PAT;

const T = {
  pos: "tbl7PjvfuXuy3dTNp",
  handoffs: "tblUzMOvoQH7IO2Yp",
  squad: "tblTTqZvavztz2pPb",
};

const F = {
  pos: {
    key: "fldadsIYyZvL8ZJlN",
    date: "fldeTjnySf4NBA0Wq",
    shift: "fldTYPgphRvgGaQel",
    tips: "fld16gpgtDzdeFrkm",
    outstanding: "flduwFJZsyQfTQn7g",
  },
  handoff: {
    title: "fldGvZLyGjI140GYO",
    date: "fldP7fN7pcCa1EHbF",
    shift: "fldg8mcBcv6ic6YQY",
    role: "fldgQQ9y5f9Z5J6n9",
    squad: "fld6Uxaf6uLNcHqk1",
  },
};

/** Only these roles share the tip pool. BOH is not tipped. */
const TIP_ELIGIBLE = new Set(["Barista", "Bartender"]);

/** Payroll roster order from the Level5 worksheet. Never sort this. */
const ROSTER = [
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
];

type AirtableRecord = {
  id: string;
  fields: Record<string, unknown>;
};

async function airtable(path: string, params: Record<string, string | string[]> = {}) {
  const url = new URL(`https://api.airtable.com/v0/${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x));
    else url.searchParams.set(k, v);
  });

  const out: AirtableRecord[] = [];
  let offset: string | undefined;

  do {
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${PAT}` },
    });
    if (!res.ok) {
      throw new Error(`Airtable ${res.status} on ${path}: ${await res.text()}`);
    }
    const json = (await res.json()) as { records: AirtableRecord[]; offset?: string };
    out.push(...json.records);
    offset = json.offset;
  } while (offset);

  return out;
}

/** Single-selects come back as { id, name, color }; plain values come back as-is. */
const selName = (v: unknown): string =>
  typeof v === "object" && v !== null && "name" in v
    ? String((v as { name: unknown }).name)
    : String(v ?? "");

async function squadNames(): Promise<Map<string, string>> {
  const meta = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE}/tables`, {
    headers: { Authorization: `Bearer ${PAT}` },
  });
  if (!meta.ok) throw new Error(`Airtable meta ${meta.status}: ${await meta.text()}`);
  const { tables } = (await meta.json()) as {
    tables: { id: string; primaryFieldId: string }[];
  };
  const primary = tables.find((t) => t.id === T.squad)?.primaryFieldId;
  if (!primary) throw new Error("Squad table not found in base metadata");

  const recs = await airtable(`${BASE}/${T.squad}`, {
    returnFieldsByFieldId: "true",
    "fields[]": [primary],
  });

  return new Map(recs.map((r) => [r.id, String(r.fields[primary] ?? "")]));
}

export default async function handler(req: Request): Promise<Response> {
  if (!PAT) {
    return Response.json({ error: "AIRTABLE_PAT is not set" }, { status: 500 });
  }

  try {
    const start = new URL(req.url).searchParams.get("start") || undefined;

    const [names, posRecs, handoffRecs] = await Promise.all([
      squadNames(),
      airtable(`${BASE}/${T.pos}`, {
        returnFieldsByFieldId: "true",
        "fields[]": Object.values(F.pos),
      }),
      airtable(`${BASE}/${T.handoffs}`, {
        returnFieldsByFieldId: "true",
        "fields[]": Object.values(F.handoff),
      }),
    ]);

    const pools = posRecs
      .map((r) => {
        const oc = Number(r.fields[F.pos.outstanding] ?? 0);
        return {
          date: String(r.fields[F.pos.date] ?? "").slice(0, 10),
          shift: selName(r.fields[F.pos.shift]) as "AM" | "PM",
          tips: Number(r.fields[F.pos.tips] ?? 0),
          outstandingChecks: oc,
          provisional: oc > 0,
        };
      })
      .filter((p) => p.date && (p.shift === "AM" || p.shift === "PM"))
      .sort((a, b) => a.date.localeCompare(b.date) || a.shift.localeCompare(b.shift));

    const handoffs = handoffRecs
      .map((r) => {
        const links = (r.fields[F.handoff.squad] as string[] | undefined) ?? [];
        return {
          id: r.id,
          date: String(r.fields[F.handoff.date] ?? "").slice(0, 10),
          shift: selName(r.fields[F.handoff.shift]) as "AM" | "PM",
          role: selName(r.fields[F.handoff.role]),
          squad: links.map((id) => names.get(id) ?? id).filter(Boolean),
        };
      })
      .filter(
        (h) => h.date && (h.shift === "AM" || h.shift === "PM") && TIP_ELIGIBLE.has(h.role)
      )
      .sort((a, b) => a.date.localeCompare(b.date) || a.shift.localeCompare(b.shift));

    // Anyone paid who is not on the payroll roster must stay visible, never dropped.
    const seen = new Set(handoffs.flatMap((h) => h.squad));
    const extra = [...seen].filter((n) => !ROSTER.includes(n)).sort();

    return Response.json(
      {
        pulledAt: new Date().toISOString().slice(0, 10),
        periodStart: start ?? pools[pools.length - 1]?.date ?? ROSTER[0],
        pools,
        handoffs,
        squad: [...ROSTER, ...extra],
      },
      { headers: { "cache-control": "s-maxage=60, stale-while-revalidate=300" } }
    );
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}

export const config = { runtime: "edge" };
