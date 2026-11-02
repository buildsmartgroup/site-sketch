import type { Point, View } from "./types";

export const MIN_PX_PER_MM = 0.02;
export const MAX_PX_PER_MM = 8;
export const MIN_MM = 10;
export const MAX_MM = 1_000_000;

const SNAP_STEPS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];

/** Half-away-from-zero rounding so negative coordinates snap symmetrically. */
export function snapScalar(value: number, step: number): number {
  if (!(step > 0) || !Number.isFinite(value)) return value;
  const quarters = value / step;
  const rounded = quarters < 0 ? -Math.round(-quarters) : Math.round(quarters);
  const snapped = rounded * step;
  return snapped === 0 ? 0 : snapped;
}

export function snapPoint(point: Point, step: number): Point {
  return { x: snapScalar(point.x, step), y: snapScalar(point.y, step) };
}

/**
 * Snap step in millimetres. 10 mm while that step is still at least `minPx`
 * on screen, then the next larger step as you zoom out.
 */
export function snapStepForZoom(pxPerMm: number, minPx = 8): number {
  if (!(pxPerMm > 0)) return SNAP_STEPS[SNAP_STEPS.length - 1];
  for (const step of SNAP_STEPS) {
    if (step * pxPerMm >= minPx - 1e-6) return step;
  }
  return SNAP_STEPS[SNAP_STEPS.length - 1];
}

export function gridSteps(pxPerMm: number): { minor: number; major: number } {
  const minor = snapStepForZoom(pxPerMm, 8);
  return { minor, major: minor * 10 };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return distance(point, a);
  let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

export function wallPolygon(
  wall: { a: Point; b: Point; thickness: number },
  extension: { start?: number; end?: number } = {},
): Point[] {
  const dx = wall.b.x - wall.a.x;
  const dy = wall.b.y - wall.a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9 || !(wall.thickness > 0)) return [];
  const ux = dx / len;
  const uy = dy / len;
  const start = extension.start ?? 0;
  const end = extension.end ?? 0;
  const a = { x: wall.a.x - ux * start, y: wall.a.y - uy * start };
  const b = { x: wall.b.x + ux * end, y: wall.b.y + uy * end };
  const nx = -uy * (wall.thickness / 2);
  const ny = ux * (wall.thickness / 2);
  return [
    { x: a.x + nx, y: a.y + ny },
    { x: b.x + nx, y: b.y + ny },
    { x: b.x - nx, y: b.y - ny },
    { x: a.x - nx, y: a.y - ny },
  ];
}

export function polygonArea(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const next = points[(i + 1) % points.length];
    sum += points[i].x * next.y - next.x * points[i].y;
  }
  return Math.abs(sum) / 2;
}

export function rectFromPoints(a: Point, b: Point): { x: number; y: number; width: number; depth: number } {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    depth: Math.abs(b.y - a.y),
  };
}

export function formatMm(value: number): string {
  return String(Math.round(value));
}

/** Accepts "1250", "1 250", "1250mm", "1250.4" (rounds to the nearest mm). */
export function parseMm(raw: string): number | null {
  const cleaned = raw.trim().toLowerCase().replace(/mm\s*$/, "").replace(/[\s,]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value);
}

export function clampScale(pxPerMm: number): number {
  if (!Number.isFinite(pxPerMm)) return 1;
  return Math.min(MAX_PX_PER_MM, Math.max(MIN_PX_PER_MM, pxPerMm));
}

/** World Y is up. `originY` is the world Y at the top of the canvas. */
export function worldToScreen(point: Point, view: View): Point {
  return {
    x: (point.x - view.originX) * view.pxPerMm,
    y: (view.originY - point.y) * view.pxPerMm,
  };
}

export function screenToWorld(point: Point, view: View): Point {
  return {
    x: view.originX + point.x / view.pxPerMm,
    y: view.originY - point.y / view.pxPerMm,
  };
}

export function defaultView(width: number, height: number, pxPerMm = 1): View {
  const scale = clampScale(pxPerMm);
  return {
    pxPerMm: scale,
    originX: -width / 2 / scale,
    originY: height / 2 / scale,
  };
}

/** Zoom while keeping the world point under `screen` fixed. */
export function zoomView(view: View, screen: Point, nextPxPerMm: number): View {
  const pxPerMm = clampScale(nextPxPerMm);
  const world = screenToWorld(screen, view);
  return {
    pxPerMm,
    originX: world.x - screen.x / pxPerMm,
    originY: world.y + screen.y / pxPerMm,
  };
}

export function panView(view: View, dxPx: number, dyPx: number): View {
  return {
    ...view,
    originX: view.originX - dxPx / view.pxPerMm,
    originY: view.originY + dyPx / view.pxPerMm,
  };
}

const ANGLE_STEP = Math.PI / 4;
const DEFAULT_ANGLE_TOL = (10 * Math.PI) / 180;
const DEFAULT_ENDPOINT_TOL_PX = 16;

function angleDelta(a: number, b: number): number {
  let delta = Math.abs(a - b) % (Math.PI * 2);
  if (delta > Math.PI) delta = Math.PI * 2 - delta;
  return delta;
}

/**
 * Snap a wall end to a nearby existing endpoint, otherwise to 0/45/90°
 * when the pointer is close to one of those directions, otherwise to the grid.
 * Endpoint joins win so walls meet exactly.
 */
export function snapWallEnd(options: {
  start: Point;
  raw: Point;
  endpoints: Point[];
  grid: number;
  pxPerMm: number;
  endpointTolPx?: number;
  angleTolRad?: number;
}): Point {
  const tolPx = options.endpointTolPx ?? DEFAULT_ENDPOINT_TOL_PX;
  const tolMm = options.pxPerMm > 0 ? tolPx / options.pxPerMm : tolPx;
  const joined = nearestEndpoint(options.raw, options.endpoints, tolMm, options.start);
  if (joined) return joined;

  const dx = options.raw.x - options.start.x;
  const dy = options.raw.y - options.start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return snapPoint(options.raw, options.grid);

  const angle = Math.atan2(dy, dx);
  const snappedAngle = Math.round(angle / ANGLE_STEP) * ANGLE_STEP;
  const angleTol = options.angleTolRad ?? DEFAULT_ANGLE_TOL;
  if (angleDelta(angle, snappedAngle) <= angleTol + 1e-9) {
    const cosine = Math.cos(snappedAngle);
    const sine = Math.sin(snappedAngle);
    const axisX = Math.abs(cosine) < 1e-9;
    const axisY = Math.abs(sine) < 1e-9;
    if (axisX || axisY) {
      const len = snapScalar(length, options.grid);
      const sx = axisX ? 0 : cosine > 0 ? 1 : -1;
      const sy = axisY ? 0 : sine > 0 ? 1 : -1;
      return { x: options.start.x + sx * len, y: options.start.y + sy * len };
    }
    const component = snapScalar(length / Math.SQRT2, options.grid);
    const sx = cosine >= 0 ? 1 : -1;
    const sy = sine >= 0 ? 1 : -1;
    return {
      x: options.start.x + sx * component,
      y: options.start.y + sy * component,
    };
  }

  return snapPoint(options.raw, options.grid);
}

/** Snap a start point or a room corner to an endpoint, otherwise the grid. */
export function snapToEndpointOrGrid(
  raw: Point,
  endpoints: Point[],
  grid: number,
  pxPerMm: number,
  endpointTolPx = DEFAULT_ENDPOINT_TOL_PX,
): Point {
  const tolMm = pxPerMm > 0 ? endpointTolPx / pxPerMm : endpointTolPx;
  return nearestEndpoint(raw, endpoints, tolMm) ?? snapPoint(raw, grid);
}

function nearestEndpoint(raw: Point, endpoints: Point[], tolMm: number, ignoreNear?: Point): Point | null {
  let best: Point | null = null;
  let bestDistance = tolMm;
  for (const endpoint of endpoints) {
    if (ignoreNear && distance(endpoint, ignoreNear) < 1) continue;
    const d = distance(endpoint, raw);
    if (d <= bestDistance) {
      bestDistance = d;
      best = endpoint;
    }
  }
  return best ? { x: best.x, y: best.y } : null;
}

export function snappedDelta(anchor: Point, rawDelta: Point, grid: number): Point {
  const snapped = snapPoint({ x: anchor.x + rawDelta.x, y: anchor.y + rawDelta.y }, grid);
  return { x: snapped.x - anchor.x, y: snapped.y - anchor.y };
}

/** A round scale-bar length whose on-screen size sits near 120 px. */
export function niceScaleMm(pxPerMm: number): number {
  const candidates = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
  let best = candidates[0];
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const px = candidate * pxPerMm;
    if (px < 40 || px > 240) continue;
    const score = Math.abs(px - 120);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}
