/**
 * Site Sketch stores a plan as plain data in real-world millimetres.
 * X increases to the right (east). Y increases upward (north).
 * The canvas flips Y when it draws.
 *
 * Version 2 is one sketch with two sheets. Elements drawn on Existing are
 * `origin: "existing"` and can be marked `removal: "remove"`. Elements drawn
 * on Proposed are `origin: "new"`. See docs/plan-format.md.
 */

export type Point = { x: number; y: number };

export type Origin = "existing" | "new";
export type Removal = "keep" | "remove";
export type Sheet = "existing" | "proposed";
export type QuarterTurn = 0 | 90 | 180 | 270;
export type Side = 1 | -1;

export type Wall = {
  id: string;
  /** Centerline start, millimetres. */
  a: Point;
  /** Centerline end, millimetres. */
  b: Point;
  /** Finished wall thickness, millimetres. Internal stud default is 90. */
  thickness: number;
  origin: Origin;
  removal: Removal;
};

export type Room = {
  id: string;
  /**
   * Four centerline walls, in order: bottom (min Y), right (max X),
   * top (max Y), left (min X). Corners meet. Interior size is derived.
   */
  wallIds: [string, string, string, string];
  /** Displayed in uppercase. Empty shows as ROOM. */
  name: string;
  /** Ceiling height above finished floor, millimetres. */
  ceiling: number;
};

export type OpeningKind = "hinged" | "cavity" | "window";
export type OpeningHand = "start" | "end";

export type Opening = {
  id: string;
  wallId: string;
  kind: OpeningKind;
  /** Distance from wall.a to the centre of the clear opening, millimetres. */
  offset: number;
  /** Clear opening width, millimetres. */
  width: number;
  /** Cavity pocket length. 0 unless kind is cavity. */
  pocket: number;
  /** Hinge, or the pocket, toward wall.a when "start". */
  hand: OpeningHand;
  /** +1 is left of the direction a → b. Swing goes this way. */
  side: Side;
  /** Sill above finished floor. 0 for doors. */
  sill: number;
  /** Head above finished floor. */
  head: number;
  origin: Origin;
  removal: Removal;
};

export type FixtureKind =
  | "toilet"
  | "basin"
  | "vanity"
  | "shower"
  | "bath"
  | "grab"
  | "grab-l"
  | "curtain"
  | "niche"
  | "mirror"
  | "gpo"
  | "switch"
  | "exhaust"
  | "light"
  | "turning";

export type Fixture = {
  id: string;
  kind: FixtureKind;
  /**
   * Anchor, millimetres. Back-centre or corner for wall-mounted items,
   * centre for showers, baths, ceiling symbols, and turning circles.
   */
  x: number;
  y: number;
  /** Counter-clockwise from east. */
  rotation: QuarterTurn;
  width: number;
  depth: number;
  /** Mounting height above finished floor. Meaning depends on kind. */
  affl: number;
  /** Vertical extent where the plan symbol is not the whole item. 0 if unused. */
  height: number;
  /** Turning circle diameter. 0 unless kind is turning. */
  diameter: number;
  /** Dashed clearance rectangle around a toilet. */
  clearance: boolean;
  origin: Origin;
  removal: Removal;
  wallId: string | null;
  /** Anchor position along the wall, from wall.a. Null when not snapped. */
  along: number | null;
  side: Side;
};

export type Callout = {
  id: string;
  number: number;
  text: string;
  anchor: Point;
  /** Where the numbered circle sits. */
  label: Point;
  sheet: Sheet;
};

export type Note = {
  id: string;
  text: string;
  at: Point;
  sheet: Sheet;
};

export type ManualDim = {
  id: string;
  a: Point;
  b: Point;
  /** Signed offset of the dimension line, millimetres, left of a → b. */
  offset: number;
  sheet: Sheet;
};

export type PlanMeta = {
  client: string;
  address: string;
  drawnBy: string;
  date: string;
  revision: string;
  project: string;
  /** NOTES block. One note per line. */
  notes: string;
};

export type Plan = {
  version: 2;
  units: "mm";
  walls: Wall[];
  rooms: Room[];
  openings: Opening[];
  fixtures: Fixture[];
  callouts: Callout[];
  notes: Note[];
  dims: ManualDim[];
  meta: PlanMeta;
};

export type View = {
  /** World X at the left edge of the canvas. */
  originX: number;
  /** World Y at the top edge of the canvas. */
  originY: number;
  /** Screen pixels per millimetre. */
  pxPerMm: number;
};

export type Selection =
  | { kind: "none" }
  | { kind: "wall"; id: string }
  | { kind: "room"; id: string }
  | { kind: "opening"; id: string }
  | { kind: "fixture"; id: string }
  | { kind: "callout"; id: string }
  | { kind: "text"; id: string }
  | { kind: "dim"; id: string };

export type Tool =
  | "select"
  | "room"
  | "wall"
  | "door"
  | "cavity"
  | "window"
  | "fixture"
  | "dim"
  | "callout"
  | "text";

export const THICKNESSES = [90, 110, 150] as const;
export type Thickness = (typeof THICKNESSES)[number];

export type InteriorRect = {
  /** Left edge of the clear interior, mm. */
  x: number;
  /** Bottom edge of the clear interior, mm. Y increases upward. */
  y: number;
  width: number;
  depth: number;
};

export type RoomMetrics = InteriorRect & {
  thickness: number;
};

export type DimTarget =
  | { kind: "room-width"; roomId: string }
  | { kind: "room-depth"; roomId: string }
  | { kind: "wall"; wallId: string }
  | { kind: "opening"; openingId: string };

export type Project = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  plan: Plan;
  view?: View;
  sheet?: Sheet;
};

export const DEFAULT_NOTES = [
  "BUILDER TO CONFIRM ALL EXISTING SITE CONDITIONS AND DIMENSIONS ON SITE BEFORE ANY NEW WORKS START.",
  "RED = TO BE REMOVED. BLUE HATCH = NEW WORK.",
  "HEIGHTS ARE ABOVE FINISHED FLOOR LEVEL UNLESS NOTED.",
  "THIS SKETCH IS A SITE RECORD, NOT A COMPLIANCE CERTIFICATE.",
].join("\n");

export function emptyMeta(): PlanMeta {
  return {
    client: "",
    address: "",
    drawnBy: "",
    date: "",
    revision: "A",
    project: "",
    notes: DEFAULT_NOTES,
  };
}

export function emptyPlan(): Plan {
  return {
    version: 2,
    units: "mm",
    walls: [],
    rooms: [],
    openings: [],
    fixtures: [],
    callouts: [],
    notes: [],
    dims: [],
    meta: emptyMeta(),
  };
}

export function isThickness(value: number): value is Thickness {
  return value === 90 || value === 110 || value === 150;
}

export function isQuarterTurn(value: number): value is QuarterTurn {
  return value === 0 || value === 90 || value === 180 || value === 270;
}
