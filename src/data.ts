// ---------------------------------------------------------------------------
// Airtable snapshot, base appbhZtJ44f7jvxrB. Read 2026-08-02 via MCP.
//
//   POS Tip Summary  tbl7PjvfuXuy3dTNp  -> pools   (16 records total)
//   Handoffs         tblUzMOvoQH7IO2Yp  -> roster  (33 records total)
//
// Handoffs are the only roster. Cook handoffs are excluded: BOH is not tipped.
// Scope below is the 2026-07-26 pay period.
// ---------------------------------------------------------------------------

export type Shift = "AM" | "PM";

export interface Pool {
  date: string;
  shift: Shift;
  tips: number;
  outstandingChecks: number;
  provisional: boolean;
}

export interface Handoff {
  id: string;
  date: string;
  shift: Shift;
  role: "Barista" | "Bartender";
  squad: string[];
}

export interface Dataset {
  pulledAt: string;
  periodStart: string;
  pools: Pool[];
  handoffs: Handoff[];
  squad: string[];
}

const P = (date: string, shift: Shift, tips: number, oc = 0): Pool => ({
  date,
  shift,
  tips,
  outstandingChecks: oc,
  provisional: oc > 0,
});

const H = (
  id: string,
  date: string,
  shift: Shift,
  role: "Barista" | "Bartender",
  squad: string[]
): Handoff => ({ id, date, shift, role, squad });

export const SNAPSHOT: Dataset = {
  pulledAt: "2026-08-02",
  periodStart: "2026-07-26",

  // 7/26 has no POS record. 8/2 AM was pulled mid-shift with 8 checks open.
  pools: [
    P("2026-07-27", "PM", 86.0),
    P("2026-07-28", "AM", 108.0),
    P("2026-07-28", "PM", 103.0, 2),
    P("2026-07-29", "AM", 100.45),
    P("2026-07-29", "PM", 142.5),
    P("2026-07-30", "AM", 59.8),
    P("2026-07-30", "PM", 102.3),
    P("2026-07-31", "AM", 78.3),
    P("2026-07-31", "PM", 85.0),
    P("2026-08-01", "AM", 97.8),
    P("2026-08-01", "PM", 151.5),
    P("2026-08-02", "AM", 33.8, 8),
  ],

  handoffs: [
    H("recU2QEZFolNOuYYe", "2026-07-26", "PM", "Bartender", ["Zechariah Nelson"]),
    H("recGKVBlh5cVvDXjk", "2026-07-27", "PM", "Bartender", ["Erik Eng"]),
    H("recaHeD640yrdkRRM", "2026-07-28", "AM", "Barista", [
      "Elizabeth Ayers",
      "An Nguyen",
      "Caldwell Armstrong",
    ]),
    H("recK3rrB0rmx3go0D", "2026-07-28", "PM", "Bartender", ["Erik Eng"]),
    H("recredFEXWUHRBByF", "2026-07-29", "AM", "Barista", [
      "Autumn Britt",
      "Madison Edwards",
      "Elizabeth Ayers",
    ]),
    H("recPl2DGyFkfr3xV2", "2026-07-30", "AM", "Barista", [
      "Elizabeth Ayers",
      "Brooklyn Worman",
    ]),
    H("recMTpX2PLCukUvce", "2026-07-30", "PM", "Bartender", ["Zechariah Nelson"]),
    H("rec8ypOT4ESCCslMJ", "2026-07-31", "AM", "Barista", [
      "An Nguyen",
      "Brielle Critelli",
      "Elizabeth Ayers",
    ]),
    H("reckIsUzIo1CI84tJ", "2026-07-31", "PM", "Bartender", ["Meagan Wagner"]),
    H("rec4hiY40TsL6rEkG", "2026-08-01", "PM", "Bartender", ["Meagan Wagner"]),
  ],

  // PAYROLL ROSTER ORDER. Do not sort this.
  // From 2026_Level5_TIPS_Worksheet.xlsx rows 4-15, stable across four periods.
  // Slot 4 was Mary Kondelik before An Nguyen. Positions 1-8 FOH, 9-12 bar.
  squad: [
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
  ],
};
