import { distanceToSegment, pointAlong, projectOnWall, wallFrame, type WallFrame } from "./geometry";
import type { Opening, OpeningKind, Point, Wall } from "./types";

export const DOOR_WIDTHS = [720, 770, 820, 920] as const;
export const WINDOW_WIDTHS = [600, 900, 1200, 1800] as const;
const MARGIN = 30;

export function defaultOpeningSize(kind: OpeningKind): { width: number; sill: number; head: number; pocket: number } {
  if (kind === "window") return { width: 900, sill: 1000, head: 2100, pocket: 0 };
  const width = 820;
  if (kind === "cavity") return { width, sill: 0, head: 2040, pocket: width - 60 };
  return { width, sill: 0, head: 2040, pocket: 0 };
}

export function pocketForWidth(width: number): number {
  return Math.max(300, Math.round(width - 60));
}

export type OpeningFrame = WallFrame & {
  center: Point;
  jambA: Point;
  jambB: Point;
  hinge: Point;
  latch: Point;
  leafEnd: Point;
  pocketEnd: Point;
  pocketLength: number;
};

export function clampOpening(wall: Wall, opening: Opening): Opening {
  const frame = wallFrame(wall);
  if (!frame) return opening;
  const margin = Math.min(MARGIN, frame.length * 0.2);
  let width = Math.min(Math.max(100, opening.width), Math.max(100, frame.length - margin * 2));
  if (!(frame.length > width + 1)) width = Math.max(100, frame.length * 0.5);
  const min = width / 2 + margin;
  const max = frame.length - width / 2 - margin;
  let offset = opening.offset;
  if (max >= min) offset = Math.min(max, Math.max(min, offset));
  else offset = frame.length / 2;
  const pocket = opening.kind === "cavity" ? Math.min(opening.pocket, Math.max(0, frame.length)) : 0;
  return { ...opening, width, offset, pocket };
}

export function snapOpening(wall: Wall, opening: Opening, grid: number): Opening {
  const frame = wallFrame(wall);
  if (!frame) return opening;
  let offset = grid > 0 ? Math.round(opening.offset / grid) * grid : opening.offset;
  if (Math.abs(offset - frame.length / 2) <= Math.max(grid, 20)) offset = frame.length / 2;
  return clampOpening(wall, { ...opening, offset });
}

export function openingFrame(wall: Wall, opening: Opening): OpeningFrame | null {
  const frame = wallFrame(wall);
  if (!frame) return null;
  const placed = clampOpening(wall, opening);
  const half = placed.width / 2;
  const center = pointAlong(wall, frame, placed.offset);
  const jambA = pointAlong(wall, frame, placed.offset - half);
  const jambB = pointAlong(wall, frame, placed.offset + half);
  const hinge = placed.hand === "start" ? jambA : jambB;
  const latch = placed.hand === "start" ? jambB : jambA;
  const leafEnd = {
    x: hinge.x + frame.nx * placed.side * placed.width,
    y: hinge.y + frame.ny * placed.side * placed.width,
  };
  const dir = placed.hand === "start" ? -1 : 1;
  const available = placed.hand === "start" ? placed.offset - half : frame.length - (placed.offset + half);
  const pocketLength = placed.kind === "cavity" ? Math.max(0, Math.min(placed.pocket, Math.max(0, available - 10))) : 0;
  const pocketEnd = {
    x: hinge.x + frame.ux * dir * pocketLength,
    y: hinge.y + frame.uy * dir * pocketLength,
  };
  return { ...frame, center, jambA, jambB, hinge, latch, leafEnd, pocketEnd, pocketLength };
}

export function gapPolygon(wall: Wall, opening: Opening): Point[] {
  const placed = openingFrame(wall, opening);
  if (!placed) return [];
  const extra = wall.thickness / 2 + 3;
  return thickSegment(placed.jambA, placed.jambB, placed.nx, placed.ny, extra);
}

export function pocketPolygon(wall: Wall, opening: Opening): Point[] {
  const placed = openingFrame(wall, opening);
  if (!placed || placed.pocketLength < 20) return [];
  const inset = Math.min(wall.thickness * 0.22, wall.thickness / 2 - 4);
  const half = Math.max(4, wall.thickness / 2 - inset);
  return thickSegment(placed.hinge, placed.pocketEnd, placed.nx, placed.ny, half);
}

export function doorSlab(wall: Wall, opening: Opening): Point[] {
  const placed = openingFrame(wall, opening);
  if (!placed || placed.pocketLength < 20) return [];
  const half = Math.max(3, wall.thickness * 0.12);
  const dx = placed.pocketEnd.x - placed.hinge.x;
  const dy = placed.pocketEnd.y - placed.hinge.y;
  const len = Math.hypot(dx, dy) || 1;
  const start = {
    x: placed.hinge.x + (dx / len) * 16,
    y: placed.hinge.y + (dy / len) * 16,
  };
  const end = {
    x: placed.pocketEnd.x - (dx / len) * 16,
    y: placed.pocketEnd.y - (dy / len) * 16,
  };
  return thickSegment(start, end, placed.nx, placed.ny, half);
}

/** Chevron in the clear opening, pointing away from the pocket. */
export function cavityChevron(wall: Wall, opening: Opening): Point[] {
  const placed = openingFrame(wall, opening);
  if (!placed) return [];
  const dx = placed.latch.x - placed.hinge.x;
  const dy = placed.latch.y - placed.hinge.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const reach = Math.min(180, opening.width * 0.22);
  const wing = Math.min(wall.thickness * 0.85, 80);
  const base = { x: placed.center.x - ux * reach, y: placed.center.y - uy * reach };
  const point = { x: placed.center.x + ux * reach * 0.35, y: placed.center.y + uy * reach * 0.35 };
  return [
    { x: base.x + placed.nx * wing, y: base.y + placed.ny * wing },
    point,
    { x: base.x - placed.nx * wing, y: base.y - placed.ny * wing },
  ];
}

export function swingArc(wall: Wall, opening: Opening, steps = 18): Point[] {
  if (opening.kind !== "hinged") return [];
  const placed = openingFrame(wall, opening);
  if (!placed) return [];
  const start = Math.atan2(placed.latch.y - placed.hinge.y, placed.latch.x - placed.hinge.x);
  const end = Math.atan2(placed.leafEnd.y - placed.hinge.y, placed.leafEnd.x - placed.hinge.x);
  let delta = end - start;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const points: Point[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const angle = start + (delta * i) / steps;
    points.push({
      x: placed.hinge.x + Math.cos(angle) * opening.width,
      y: placed.hinge.y + Math.sin(angle) * opening.width,
    });
  }
  return points;
}

export function windowPanes(wall: Wall, opening: Opening): [Point, Point][] {
  const placed = openingFrame(wall, opening);
  if (!placed) return [];
  return [-0.18, 0, 0.18].map((t) => {
    const ox = placed.nx * wall.thickness * t;
    const oy = placed.ny * wall.thickness * t;
    return [
      { x: placed.jambA.x + ox, y: placed.jambA.y + oy },
      { x: placed.jambB.x + ox, y: placed.jambB.y + oy },
    ];
  });
}

export function interiorSide(wall: Wall, roomCenter: Point | null): 1 | -1 {
  const frame = wallFrame(wall);
  if (!frame || !roomCenter) return 1;
  const midX = (wall.a.x + wall.b.x) / 2;
  const midY = (wall.a.y + wall.b.y) / 2;
  const dot = (roomCenter.x - midX) * frame.nx + (roomCenter.y - midY) * frame.ny;
  return dot >= 0 ? 1 : -1;
}

export function hitOpening(wall: Wall, opening: Opening, point: Point, slopMm: number): boolean {
  const placed = openingFrame(wall, opening);
  if (!placed) return false;
  const along = projectOnWall(wall, point);
  if (
    Math.abs(along - opening.offset) <= opening.width / 2 + slopMm &&
    distanceToSegment(point, wall.a, wall.b) <= wall.thickness / 2 + slopMm
  ) {
    return true;
  }
  if (opening.kind === "hinged") {
    if (distanceToSegment(point, placed.hinge, placed.leafEnd) <= slopMm) return true;
    if (pointInTriangle(point, placed.hinge, placed.latch, placed.leafEnd)) return true;
  }
  if (opening.kind === "cavity" && placed.pocketLength > 0) {
    if (distanceToSegment(point, placed.hinge, placed.pocketEnd) <= wall.thickness / 2 + slopMm) return true;
  }
  return false;
}

export function wallUnderPoint(
  walls: readonly Wall[],
  point: Point,
  pxPerMm: number,
): { wall: Wall; offset: number } | null {
  const slop = pxPerMm > 0 ? 18 / pxPerMm : 18;
  let best: { wall: Wall; offset: number; distance: number } | null = null;
  for (const wall of walls) {
    if (wall.id.startsWith("preview-")) continue;
    const frame = wallFrame(wall);
    if (!frame || frame.length < 40) continue;
    const distance = distanceToSegment(point, wall.a, wall.b);
    if (distance > wall.thickness / 2 + slop) continue;
    if (!best || distance < best.distance) best = { wall, offset: projectOnWall(wall, point), distance };
  }
  return best ? { wall: best.wall, offset: best.offset } : null;
}

function thickSegment(a: Point, b: Point, nx: number, ny: number, half: number): Point[] {
  return [
    { x: a.x + nx * half, y: a.y + ny * half },
    { x: b.x + nx * half, y: b.y + ny * half },
    { x: b.x - nx * half, y: b.y - ny * half },
    { x: a.x - nx * half, y: a.y - ny * half },
  ];
}

function pointInTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
  const sign = (p1: Point, p2: Point, p3: Point) => (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
  const d1 = sign(p, a, b);
  const d2 = sign(p, b, c);
  const d3 = sign(p, c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}
