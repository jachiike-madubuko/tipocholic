/**
 * GET  /api/tips?start=YYYY-MM-DD  — read POS pools + tip-eligible handoffs
 * POST /api/tips                   — write tip amount and/or handoff roster
 *
 * Env:
 *   AIRTABLE_PAT      scopes: data.records:read, data.records:write, schema.bases:read
 *   AIRTABLE_BASE_ID  defaults to appbhZtJ44f7jvxrB
 *
 * Writes:
 *   tips / clearProvisional → POS Tip Summary (Shift Tips, Outstanding Checks, Notes)
 *   people                  → Handoffs.Squad on tip-eligible records for that date|shift
 *                             (creates a Barista/Bartender handoff if none exists)
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
    notes: "fldUhQtK1iaC9IVLv",
    provisional: "fldayjxPvdJah8nOk",
  },
  handoff: {
    title: "fldGvZLyGjI140GYO",
    date: "fldP7fN7pcCa1EHbF",
    shift: "fldg8mcBcv6ic6YQY",
    role: "fldgQQ9y5f9Z5J6n9",
    squad: "fld6Uxaf6uLNcHqk1",
    submitLog: "fldB85rpwsFS9IOL4",
  },
};

const TIP_ELIGIBLE = new Set(["Barista", "Bartender"]);

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

type Shift = "AM" | "PM";

type WriteBody = {
  date?: string;
  shift?: Shift;
  tips?: number;
  people?: string[];
  clearProvisional?: boolean;
  reason?: string;
};

const selName = (v: unknown): string =>
  typeof v === "object" && v !== null && "name" in v
    ? String((v as { name: unknown }).name)
    : String(v ?? "");

async function airtableGet(path: string, params: Record<string, string | string[]> = {}) {
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

async function airtableWrite(
  method: "POST" | "PATCH",
  tableId: string,
  records: { id?: string; fields: Record<string, unknown> }[]
) {
  const res = await fetch(`https://api.airtable.com/v0/${BASE}/${tableId}`, {
    method,
    headers: {
      Authorization: `Bearer ${PAT}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ records, typecast: true }),
  });
  if (!res.ok) {
    throw new Error(`Airtable ${res.status} ${method} ${tableId}: ${await res.text()}`);
  }
  return (await res.json()) as { records: AirtableRecord[] };
}

async function squadMaps(): Promise<{
  idToName: Map<string, string>;
  nameToId: Map<string, string>;
  primary: string;
}> {
  const meta = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE}/tables`, {
    headers: { Authorization: `Bearer ${PAT}` },
  });
  if (!meta.ok) throw new Error(`Airtable meta ${meta.status}: ${await meta.text()}`);
  const { tables } = (await meta.json()) as {
    tables: { id: string; primaryFieldId: string }[];
  };
  const primary = tables.find((t) => t.id === T.squad)?.primaryFieldId;
  if (!primary) throw new Error("Squad table not found in base metadata");

  const recs = await airtableGet(`${BASE}/${T.squad}`, {
    returnFieldsByFieldId: "true",
    "fields[]": [primary],
  });

  const idToName = new Map(recs.map((r) => [r.id, String(r.fields[primary] ?? "")]));
  const nameToId = new Map<string, string>();
  for (const [id, name] of idToName) {
    if (name) nameToId.set(name, id);
  }
  return { idToName, nameToId, primary };
}

function stamp(reason?: string) {
  const iso = new Date().toISOString();
  return reason?.trim()
    ? `[tipocholic ${iso}] ${reason.trim()}`
    : `[tipocholic ${iso}]`;
}

function appendNote(existing: unknown, line: string) {
  const prev = String(existing ?? "").trim();
  return prev ? `${prev}\n${line}` : line;
}

async function handleGet(req: Request): Promise<Response> {
  const start = new URL(req.url).searchParams.get("start") || undefined;
  const { idToName } = await squadMaps();

  const [posRecs, handoffRecs] = await Promise.all([
    airtableGet(`${BASE}/${T.pos}`, {
      returnFieldsByFieldId: "true",
      "fields[]": Object.values(F.pos),
    }),
    airtableGet(`${BASE}/${T.handoffs}`, {
      returnFieldsByFieldId: "true",
      "fields[]": Object.values(F.handoff),
    }),
  ]);

  const pools = posRecs
    .map((r) => {
      const oc = Number(r.fields[F.pos.outstanding] ?? 0);
      return {
        date: String(r.fields[F.pos.date] ?? "").slice(0, 10),
        shift: selName(r.fields[F.pos.shift]) as Shift,
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
        shift: selName(r.fields[F.handoff.shift]) as Shift,
        role: selName(r.fields[F.handoff.role]),
        squad: links.map((id) => idToName.get(id) ?? id).filter(Boolean),
      };
    })
    .filter(
      (h) => h.date && (h.shift === "AM" || h.shift === "PM") && TIP_ELIGIBLE.has(h.role)
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.shift.localeCompare(b.shift));

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
}

async function handlePost(req: Request): Promise<Response> {
  const body = (await req.json()) as WriteBody;
  const date = String(body.date ?? "").slice(0, 10);
  const shift = body.shift;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (shift !== "AM" && shift !== "PM")) {
    return Response.json({ error: "date and shift (AM|PM) are required" }, { status: 400 });
  }

  const hasTips = typeof body.tips === "number" && Number.isFinite(body.tips) && body.tips >= 0;
  const hasPeople = Array.isArray(body.people);
  const clearProvisional = !!body.clearProvisional || hasTips;
  if (!hasTips && !hasPeople && !body.clearProvisional) {
    return Response.json(
      { error: "Provide tips, people, and/or clearProvisional" },
      { status: 400 }
    );
  }

  const { nameToId } = await squadMaps();
  const key = `${date}|${shift}`;
  const line = stamp(body.reason);
  const written: string[] = [];

  if (hasTips || clearProvisional) {
    const all = await airtableGet(`${BASE}/${T.pos}`, {
      returnFieldsByFieldId: "true",
      "fields[]": [F.pos.key, F.pos.tips, F.pos.outstanding, F.pos.notes, F.pos.date, F.pos.shift],
    });
    const match =
      all.find((r) => String(r.fields[F.pos.key] ?? "") === key) ??
      all.find(
        (r) =>
          String(r.fields[F.pos.date] ?? "").slice(0, 10) === date &&
          selName(r.fields[F.pos.shift]) === shift
      );

    const fields: Record<string, unknown> = {};
    if (hasTips) fields[F.pos.tips] = Math.round(body.tips! * 100) / 100;
    if (clearProvisional) {
      fields[F.pos.outstanding] = 0;
      fields[F.pos.provisional] = false;
    }
    const tipBit = hasTips
      ? `Shift Tips → $${(Math.round(body.tips! * 100) / 100).toFixed(2)}`
      : "released provisional";
    fields[F.pos.notes] = appendNote(match?.fields[F.pos.notes], `${line} ${tipBit}`);

    if (match) {
      await airtableWrite("PATCH", T.pos, [{ id: match.id, fields }]);
      written.push(`pos:${match.id}`);
    } else if (hasTips) {
      const created = await airtableWrite("POST", T.pos, [
        {
          fields: {
            [F.pos.key]: key,
            [F.pos.date]: date,
            [F.pos.shift]: shift,
            ...fields,
          },
        },
      ]);
      written.push(`pos:${created.records[0]?.id ?? "new"}`);
    }
  }

  if (hasPeople) {
    const names = body.people!.map((n) => String(n).trim()).filter(Boolean);
    const missing = names.filter((n) => !nameToId.has(n));
    if (missing.length) {
      return Response.json(
        { error: `Unknown squad names: ${missing.join(", ")}` },
        { status: 400 }
      );
    }
    const linkIds = names.map((n) => nameToId.get(n)!);

    const handoffRecs = await airtableGet(`${BASE}/${T.handoffs}`, {
      returnFieldsByFieldId: "true",
      "fields[]": [
        F.handoff.date,
        F.handoff.shift,
        F.handoff.role,
        F.handoff.squad,
        F.handoff.submitLog,
        F.handoff.title,
      ],
    });

    const eligible = handoffRecs.filter(
      (r) =>
        String(r.fields[F.handoff.date] ?? "").slice(0, 10) === date &&
        selName(r.fields[F.handoff.shift]) === shift &&
        TIP_ELIGIBLE.has(selName(r.fields[F.handoff.role]))
    );

    const rosterLabel = names.length ? names.join(", ") : "(nobody)";
    const logLine = `${line} Squad → ${rosterLabel}`;

    if (eligible.length === 0) {
      const role = shift === "AM" ? "Barista" : "Bartender";
      const created = await airtableWrite("POST", T.handoffs, [
        {
          fields: {
            [F.handoff.title]: `Tip assign ${date} ${shift}`,
            [F.handoff.date]: date,
            [F.handoff.shift]: shift,
            [F.handoff.role]: role,
            [F.handoff.squad]: linkIds,
            [F.handoff.submitLog]: logLine,
          },
        },
      ]);
      written.push(`handoff:${created.records[0]?.id ?? "new"}`);
    } else {
      // Put the resolved roster on the first tip-eligible handoff; clear siblings
      // so the union read path cannot resurrect removed names.
      const [primary, ...rest] = eligible;
      await airtableWrite("PATCH", T.handoffs, [
        {
          id: primary.id,
          fields: {
            [F.handoff.squad]: linkIds,
            [F.handoff.submitLog]: appendNote(primary.fields[F.handoff.submitLog], logLine),
          },
        },
        ...rest.map((r) => ({
          id: r.id,
          fields: {
            [F.handoff.squad]: [],
            [F.handoff.submitLog]: appendNote(
              r.fields[F.handoff.submitLog],
              `${line} Squad cleared (roster consolidated onto ${primary.id})`
            ),
          },
        })),
      ]);
      written.push(`handoff:${primary.id}`);
      rest.forEach((r) => written.push(`handoff-clear:${r.id}`));
    }
  }

  return Response.json({ ok: true, key, written });
}

export default async function handler(req: Request): Promise<Response> {
  if (!PAT) {
    return Response.json({ error: "AIRTABLE_PAT is not set" }, { status: 500 });
  }

  try {
    if (req.method === "GET") return await handleGet(req);
    if (req.method === "POST") return await handlePost(req);
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}

export const config = { runtime: "edge" };
