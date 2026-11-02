/**
 * Site Sketch stores a plan as plain data in real-world millimetres.
 * X increases to the right (east). Y increases upward (north), matching a
 * future 3D export. The canvas flips Y when it draws; it does not own the model.
 *
 * Milestone 1 is walls and rooms. Later milestones can add fixtures,
 * annotations, and photo pins beside these collections and bump `version`.
 */

export type Point = { x: number; y: number };

export type Wall = {
  id: string;
  /** Centerline start, millimetres. */
  a: Point;
  /** Centerline end, millimetres. */
  b: Point;
  /** Finished wall thickness, millimetres. Internal stud default is 90. */
  thickness: number;
};

export type Room = {
  id: string;
  /**
   * Four centerline walls, in order: bottom (min Y), right (max X),
   * top (max Y), left (min X). Corners meet. Interior size is derived.
   */
  wallIds: [string, string, string, string];
};

export type Plan = {
  version: 1;
  units: "mm";
  walls: Wall[];
  rooms: Room[];
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
  | { kind: "room"; id: string };

export type Tool = "select" | "room" | "wall";

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
  | { kind: "wall"; wallId: string };

export type Project = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  plan: Plan;
  view?: View;
};

export function emptyPlan(): Plan {
  return { version: 1, units: "mm", walls: [], rooms: [] };
}

export function isThickness(value: number): value is Thickness {
  return value === 90 || value === 110 || value === 150;
}
