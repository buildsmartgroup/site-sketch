import { formatMm, worldToScreen } from "./geometry";
import { roomMetrics, roomOfWall, wallLength } from "./plan";
import type { DimTarget, Plan, Point, View, Wall } from "./types";

export type DimLabel = {
  key: string;
  text: string;
  mm: number;
  target: DimTarget;
  /** Screen pixels, canvas-local. */
  x: number;
  y: number;
  rotation: number;
  provisional: boolean;
};

export type DimGraphic = {
  extensions: [Point, Point][];
  line: [Point, Point];
  ticks: [Point, Point][];
};

const TICK = 7;

type Segment = {
  wall: Wall;
  a: Point;
  b: Point;
  mm: number;
  target: DimTarget;
  awayFrom: Point | null;
};

function measurement(plan: Plan, wall: Wall): Segment | null {
  const room = roomOfWall(plan, wall.id);
  if (room) {
    const metrics = roomMetrics(plan, room);
    if (!metrics) return null;
    const center = {
      x: metrics.x + metrics.width / 2,
      y: metrics.y + metrics.depth / 2,
    };
    const index = room.wallIds.indexOf(wall.id);
    if (index === 0 || index === 2) {
      const y = index === 0 ? metrics.y : metrics.y + metrics.depth;
      return {
        wall,
        a: { x: metrics.x, y },
        b: { x: metrics.x + metrics.width, y },
        mm: metrics.width,
        target: { kind: "room-width", roomId: room.id },
        awayFrom: center,
      };
    }
    const x = index === 3 ? metrics.x : metrics.x + metrics.width;
    return {
      wall,
      a: { x, y: metrics.y },
      b: { x, y: metrics.y + metrics.depth },
      mm: metrics.depth,
      target: { kind: "room-depth", roomId: room.id },
      awayFrom: center,
    };
  }
  const mm = wallLength(wall);
  if (mm < 1) return null;
  return {
    wall,
    a: wall.a,
    b: wall.b,
    mm,
    target: { kind: "wall", wallId: wall.id },
    awayFrom: null,
  };
}

export function layoutDimensions(plan: Plan, view: View): { labels: DimLabel[]; graphics: DimGraphic[] } {
  const labels: DimLabel[] = [];
  const graphics: DimGraphic[] = [];
  for (const wall of plan.walls) {
    const segment = measurement(plan, wall);
    if (!segment || !(view.pxPerMm > 0)) continue;
    const laid = laySegment(segment, view);
    if (!laid) continue;
    const provisional = wall.id.startsWith("preview-");
    labels.push({
      key: `${wall.id}:${segment.target.kind}`,
      text: formatMm(segment.mm),
      mm: segment.mm,
      target: segment.target,
      x: laid.label.x,
      y: laid.label.y,
      rotation: laid.rotation,
      provisional,
    });
    graphics.push(laid.graphic);
  }
  return { labels, graphics };
}

function laySegment(segment: Segment, view: View): { label: Point; rotation: number; graphic: DimGraphic } | null {
  const sa = worldToScreen(segment.a, view);
  const sb = worldToScreen(segment.b, view);
  const dx = sb.x - sa.x;
  const dy = sb.y - sa.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return null;
  const ux = dx / len;
  const uy = dy / len;
  let nx = -uy;
  let ny = ux;
  const mid = { x: (sa.x + sb.x) / 2, y: (sa.y + sb.y) / 2 };
  if (segment.awayFrom) {
    const center = worldToScreen(segment.awayFrom, view);
    const vx = mid.x - center.x;
    const vy = mid.y - center.y;
    if (nx * vx + ny * vy < 0) {
      nx = -nx;
      ny = -ny;
    }
  }

  // Room labels are measured on the inner face, so they have to clear the
  // whole thickness. A free wall is measured on its centreline.
  const outerPx = segment.wall.thickness * view.pxPerMm * (segment.awayFrom ? 1 : 0.5);
  const dimOffset = outerPx + 18;
  const extStart = outerPx + 6;
  const extEnd = dimOffset + 10;
  const dimA = add(sa, nx, ny, dimOffset);
  const dimB = add(sb, nx, ny, dimOffset);
  const extA0 = add(sa, nx, ny, extStart);
  const extB0 = add(sb, nx, ny, extStart);
  const extA1 = add(sa, nx, ny, extEnd);
  const extB1 = add(sb, nx, ny, extEnd);
  const tickA = tick(dimA, ux + nx, uy + ny);
  const tickB = tick(dimB, ux + nx, uy + ny);

  let rotation = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (rotation > 90) rotation -= 180;
  if (rotation < -90) rotation += 180;

  return {
    label: add(mid, nx, ny, dimOffset),
    rotation,
    graphic: {
      extensions: [
        [extA0, extA1],
        [extB0, extB1],
      ],
      line: [dimA, dimB],
      ticks: [tickA, tickB],
    },
  };
}

function add(point: Point, nx: number, ny: number, distancePx: number): Point {
  return { x: point.x + nx * distancePx, y: point.y + ny * distancePx };
}

function tick(at: Point, x: number, y: number): [Point, Point] {
  const len = Math.hypot(x, y) || 1;
  const ux = (x / len) * TICK;
  const uy = (y / len) * TICK;
  return [
    { x: at.x - ux, y: at.y - uy },
    { x: at.x + ux, y: at.y + uy },
  ];
}
