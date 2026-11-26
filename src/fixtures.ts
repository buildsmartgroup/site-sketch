import { distanceToSegment, pointAlong, pointInPolygon, projectOnWall, snapPoint, snapScalar, wallFrame } from "./geometry";
import type { Fixture, FixtureKind, Point, QuarterTurn, Side, Wall } from "./types";

export type Anchor = "back" | "corner" | "center";

export type FixtureSpec = {
  label: string;
  width: number;
  depth: number;
  affl: number;
  height: number;
  diameter: number;
  anchor: Anchor;
  /** Depth runs into the wall instead of into the room. */
  recess: boolean;
  /** Drawn dashed: ceiling symbol or clearance circle. */
  overhead: boolean;
  electrical: boolean;
  heightLabel: string | null;
};

export const FIXTURE_ORDER: FixtureKind[] = [
  "toilet",
  "basin",
  "vanity",
  "shower",
  "bath",
  "grab",
  "grab-l",
  "curtain",
  "niche",
  "mirror",
  "gpo",
  "switch",
  "exhaust",
  "light",
  "turning",
];

export const CATALOG: Record<FixtureKind, FixtureSpec> = {
  toilet: { label: "Toilet", width: 360, depth: 700, affl: 460, height: 0, diameter: 0, anchor: "back", recess: false, overhead: false, electrical: false, heightLabel: null },
  basin: { label: "Basin", width: 720, depth: 450, affl: 850, height: 0, diameter: 0, anchor: "back", recess: false, overhead: false, electrical: false, heightLabel: null },
  vanity: { label: "Vanity", width: 900, depth: 460, affl: 850, height: 0, diameter: 0, anchor: "back", recess: false, overhead: false, electrical: false, heightLabel: null },
  shower: { label: "Shower", width: 1200, depth: 1200, affl: 0, height: 0, diameter: 0, anchor: "center", recess: false, overhead: false, electrical: false, heightLabel: null },
  bath: { label: "Bath", width: 1675, depth: 760, affl: 0, height: 0, diameter: 0, anchor: "center", recess: false, overhead: false, electrical: false, heightLabel: null },
  grab: { label: "Grab rail", width: 900, depth: 80, affl: 800, height: 0, diameter: 0, anchor: "back", recess: false, overhead: false, electrical: false, heightLabel: null },
  "grab-l": { label: "L grab", width: 800, depth: 800, affl: 800, height: 700, diameter: 0, anchor: "corner", recess: false, overhead: false, electrical: false, heightLabel: "Vertical leg" },
  curtain: { label: "Curtain", width: 1200, depth: 40, affl: 2400, height: 0, diameter: 0, anchor: "back", recess: false, overhead: true, electrical: false, heightLabel: null },
  niche: { label: "Niche", width: 600, depth: 90, affl: 1000, height: 400, diameter: 0, anchor: "back", recess: true, overhead: false, electrical: false, heightLabel: "Opening height" },
  mirror: { label: "Mirror", width: 750, depth: 150, affl: 1050, height: 1100, diameter: 0, anchor: "back", recess: false, overhead: false, electrical: false, heightLabel: "Cabinet height" },
  gpo: { label: "GPO", width: 117, depth: 74, affl: 300, height: 0, diameter: 0, anchor: "back", recess: false, overhead: false, electrical: true, heightLabel: null },
  switch: { label: "Switch", width: 75, depth: 40, affl: 1100, height: 0, diameter: 0, anchor: "back", recess: false, overhead: false, electrical: true, heightLabel: null },
  exhaust: { label: "Exhaust", width: 332, depth: 332, affl: 2400, height: 0, diameter: 0, anchor: "center", recess: false, overhead: true, electrical: true, heightLabel: null },
  light: { label: "Light", width: 220, depth: 220, affl: 2400, height: 0, diameter: 0, anchor: "center", recess: false, overhead: true, electrical: true, heightLabel: null },
  turning: { label: "Turning", width: 1540, depth: 1540, affl: 0, height: 0, diameter: 1540, anchor: "center", recess: false, overhead: false, electrical: false, heightLabel: null },
};

export function makeFixture(
  kind: FixtureKind,
  patch: Partial<Fixture> & Pick<Fixture, "id" | "x" | "y" | "origin">,
): Fixture {
  const spec = CATALOG[kind];
  const diameter = kind === "turning" ? (patch.diameter && patch.diameter > 0 ? patch.diameter : spec.diameter) : 0;
  const width = kind === "turning" ? diameter : (patch.width ?? spec.width);
  const depth = kind === "turning" ? diameter : (patch.depth ?? spec.depth);
  return {
    rotation: 0,
    affl: spec.affl,
    height: spec.height,
    clearance: false,
    removal: "keep",
    wallId: null,
    along: null,
    side: 1,
    ...patch,
    kind,
    width,
    depth,
    diameter,
  };
}

/** Local point to world. Local +Y is the fixture depth axis. */
export function localToWorld(fixture: Fixture, local: Point): Point {
  const rad = (fixture.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: fixture.x + local.x * cos - local.y * sin,
    y: fixture.y + local.x * sin + local.y * cos,
  };
}

export function fixturePolygon(fixture: Fixture): Point[] {
  const spec = CATALOG[fixture.kind];
  const depth = spec.recess ? -fixture.depth : fixture.depth;
  if (spec.anchor === "center") {
    const w = fixture.width / 2;
    const d = fixture.depth / 2;
    return [
      localToWorld(fixture, { x: -w, y: -d }),
      localToWorld(fixture, { x: w, y: -d }),
      localToWorld(fixture, { x: w, y: d }),
      localToWorld(fixture, { x: -w, y: d }),
    ];
  }
  if (spec.anchor === "corner") {
    return [
      localToWorld(fixture, { x: 0, y: 0 }),
      localToWorld(fixture, { x: fixture.width, y: 0 }),
      localToWorld(fixture, { x: fixture.width, y: depth }),
      localToWorld(fixture, { x: 0, y: depth }),
    ];
  }
  const w = fixture.width / 2;
  return [
    localToWorld(fixture, { x: -w, y: 0 }),
    localToWorld(fixture, { x: w, y: 0 }),
    localToWorld(fixture, { x: w, y: depth }),
    localToWorld(fixture, { x: -w, y: 0 + depth }),
  ];
}

export function hitsFixture(fixture: Fixture, point: Point, slopMm: number): boolean {
  const polygon = fixturePolygon(fixture);
  if (pointInPolygon(point, polygon)) return true;
  for (let i = 0; i < polygon.length; i += 1) {
    if (distanceToSegment(point, polygon[i], polygon[(i + 1) % polygon.length]) <= slopMm) return true;
  }
  if (fixture.kind === "turning") {
    const radius = fixture.diameter / 2 || fixture.width / 2;
    const d = Math.hypot(point.x - fixture.x, point.y - fixture.y);
    if (Math.abs(d - radius) <= slopMm || d <= radius) return true;
  }
  return false;
}

export function attachToWall(wall: Wall, fixture: Fixture, along: number, side: Side): Fixture {
  const frame = wallFrame(wall);
  const spec = CATALOG[fixture.kind];
  if (!frame || spec.anchor === "center") return { ...fixture, wallId: null, along: null };
  const rotation = rotationFor(frame.nx * side, frame.ny * side, spec.recess);
  const clamped = clampAlong(frame.length, along, fixture.width, spec.anchor, rotation, frame.ux, frame.uy);
  const center = pointAlong(wall, frame, clamped);
  const face = wall.thickness / 2;
  return {
    ...fixture,
    x: center.x + frame.nx * side * face,
    y: center.y + frame.ny * side * face,
    rotation,
    wallId: wall.id,
    along: clamped,
    side,
  };
}

export function reseatFixture(wall: Wall, fixture: Fixture): Fixture {
  if (fixture.along == null || CATALOG[fixture.kind].anchor === "center") {
    return { ...fixture, wallId: null, along: null };
  }
  return attachToWall(wall, fixture, fixture.along, fixture.side);
}

export function snapFixture(
  fixture: Fixture,
  target: Point,
  walls: readonly Wall[],
  roomCenters: readonly { wallId: string; center: Point }[],
  grid: number,
  tolMm: number,
): Fixture {
  const spec = CATALOG[fixture.kind];
  if (spec.anchor === "center") {
    const point = snapPoint(target, grid);
    return { ...fixture, x: point.x, y: point.y, wallId: null, along: null };
  }
  let best: { wall: Wall; offset: number; side: Side; distance: number } | null = null;
  for (const wall of walls) {
    if (wall.id.startsWith("preview-")) continue;
    const frame = wallFrame(wall);
    if (!frame) continue;
    const angle = Math.atan2(frame.uy, frame.ux);
    const nearest = Math.round(angle / (Math.PI / 2)) * (Math.PI / 2);
    let delta = Math.abs(angle - nearest);
    if (delta > Math.PI) delta = Math.PI * 2 - delta;
    if (delta > (12 * Math.PI) / 180) continue;
    const distance = distanceToSegment(target, wall.a, wall.b);
    if (distance > wall.thickness / 2 + tolMm) continue;
    if (best && distance >= best.distance) continue;
    const offset = projectOnWall(wall, target);
    const relX = target.x - (wall.a.x + frame.ux * offset);
    const relY = target.y - (wall.a.y + frame.uy * offset);
    const dot = relX * frame.nx + relY * frame.ny;
    let side: Side = dot >= 0 ? 1 : -1;
    if (Math.abs(dot) < wall.thickness / 2 + 5) {
      const room = roomCenters.find((item) => item.wallId === wall.id);
      if (room) {
        const midX = (wall.a.x + wall.b.x) / 2;
        const midY = (wall.a.y + wall.b.y) / 2;
        const roomDot = (room.center.x - midX) * frame.nx + (room.center.y - midY) * frame.ny;
        side = roomDot >= 0 ? 1 : -1;
      }
    }
    best = { wall, offset, side, distance };
  }
  if (!best) {
    const point = snapPoint(target, grid);
    return { ...fixture, x: point.x, y: point.y, wallId: null, along: null };
  }
  const along = snapScalar(best.offset, grid);
  return attachToWall(best.wall, fixture, along, best.side);
}

function rotationFor(roomX: number, roomY: number, recess: boolean): QuarterTurn {
  const intoX = recess ? -roomX : roomX;
  const intoY = recess ? -roomY : roomY;
  const deg = (Math.atan2(-intoX, intoY) * 180) / Math.PI;
  const norm = ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
  return norm as QuarterTurn;
}

function clampAlong(
  wallLength: number,
  along: number,
  width: number,
  anchor: Anchor,
  rotation: QuarterTurn,
  ux: number,
  uy: number,
): number {
  if (!(wallLength > 0)) return 0;
  if (anchor === "corner") {
    const rad = (rotation * Math.PI) / 180;
    const dot = Math.cos(rad) * ux + Math.sin(rad) * uy;
    if (width >= wallLength) return dot >= 0 ? 0 : wallLength;
    if (dot >= 0) return Math.min(wallLength - width, Math.max(0, along));
    return Math.min(wallLength, Math.max(width, along));
  }
  const half = Math.min(width / 2, wallLength / 2);
  return Math.min(wallLength - half, Math.max(half, along));
}

/** Toilet clearance in local millimetres: 1200 wide, past the front of the pan. */
export function clearancePolygon(fixture: Fixture): Point[] {
  const width = Math.max(1200, fixture.width + 450);
  const depth = fixture.depth + 800;
  const w = width / 2;
  return [
    localToWorld(fixture, { x: -w, y: 0 }),
    localToWorld(fixture, { x: w, y: 0 }),
    localToWorld(fixture, { x: w, y: depth }),
    localToWorld(fixture, { x: -w, y: depth }),
  ];
}
