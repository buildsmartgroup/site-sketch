import { distance, distanceToSegment, wallPolygon } from "./geometry";
import {
  emptyPlan,
  type Plan,
  type Point,
  type Room,
  type RoomMetrics,
  type Selection,
  type Wall,
} from "./types";

export function clonePlan(plan: Plan): Plan {
  return structuredClone(plan);
}

export function samePlan(a: Plan, b: Plan): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isPoint(value: unknown): value is Point {
  if (!value || typeof value !== "object") return false;
  const point = value as Point;
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

/** Drop anything that is not a version-1 millimetre plan. */
export function sanitizePlan(input: unknown): Plan {
  if (!input || typeof input !== "object") return emptyPlan();
  const raw = input as Partial<Plan>;
  if (raw.version !== 1 || raw.units !== "mm") return emptyPlan();

  const walls: Wall[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw.walls)) {
    for (const item of raw.walls) {
      if (!item || typeof item !== "object") continue;
      const wall = item as Wall;
      if (typeof wall.id !== "string" || seen.has(wall.id)) continue;
      if (!isPoint(wall.a) || !isPoint(wall.b)) continue;
      if (typeof wall.thickness !== "number" || !(wall.thickness > 0)) continue;
      seen.add(wall.id);
      walls.push({
        id: wall.id,
        a: { x: wall.a.x, y: wall.a.y },
        b: { x: wall.b.x, y: wall.b.y },
        thickness: wall.thickness,
      });
    }
  }

  const rooms: Room[] = [];
  const seenRooms = new Set<string>();
  if (Array.isArray(raw.rooms)) {
    for (const item of raw.rooms) {
      if (!item || typeof item !== "object") continue;
      const room = item as Room;
      if (typeof room.id !== "string" || seenRooms.has(room.id)) continue;
      if (!Array.isArray(room.wallIds) || room.wallIds.length !== 4) continue;
      const ids = room.wallIds;
      if (!ids.every((id) => typeof id === "string" && seen.has(id))) continue;
      seenRooms.add(room.id);
      rooms.push({ id: room.id, wallIds: [ids[0], ids[1], ids[2], ids[3]] });
    }
  }

  return { version: 1, units: "mm", walls, rooms };
}

export function wallById(plan: Plan, id: string): Wall | undefined {
  return plan.walls.find((wall) => wall.id === id);
}

export function roomById(plan: Plan, id: string): Room | undefined {
  return plan.rooms.find((room) => room.id === id);
}

export function roomOfWall(plan: Plan, wallId: string): Room | undefined {
  return plan.rooms.find((room) => room.wallIds.includes(wallId));
}

export function wallLength(wall: Wall): number {
  return distance(wall.a, wall.b);
}

/** Draw a joined end long enough to fill the corner. A free end stays at the centerline. */
export function wallDrawPolygon(plan: Plan, wall: Wall): Point[] {
  const joined = (point: Point) =>
    plan.walls.some(
      (other) => other.id !== wall.id && (distance(other.a, point) < 1 || distance(other.b, point) < 1),
    );
  return wallPolygon(wall, {
    start: joined(wall.a) ? wall.thickness / 2 : 0,
    end: joined(wall.b) ? wall.thickness / 2 : 0,
  });
}

export function endpointsOf(plan: Plan): Point[] {
  const points: Point[] = [];
  for (const wall of plan.walls) points.push(wall.a, wall.b);
  return points;
}

/**
 * Clear interior of an axis-aligned room. Walls sit outside this rectangle;
 * their centerlines are half a thickness beyond each inner face.
 */
export function roomMetrics(plan: Plan, room: Room): RoomMetrics | null {
  const walls = room.wallIds.map((id) => wallById(plan, id));
  if (walls.some((wall) => !wall)) return null;
  const [bottom, right, top, left] = walls as [Wall, Wall, Wall, Wall];
  if (Math.abs(left.a.x - left.b.x) > 0.05) return null;
  if (Math.abs(right.a.x - right.b.x) > 0.05) return null;
  if (Math.abs(top.a.y - top.b.y) > 0.05) return null;
  if (Math.abs(bottom.a.y - bottom.b.y) > 0.05) return null;

  const leftX = left.a.x;
  const rightX = right.a.x;
  const bottomY = bottom.a.y;
  const topY = top.a.y;
  if (!(rightX > leftX) || !(topY > bottomY)) return null;

  const width = rightX - leftX - (left.thickness + right.thickness) / 2;
  const depth = topY - bottomY - (top.thickness + bottom.thickness) / 2;
  if (!(width > 0) || !(depth > 0)) return null;

  return {
    x: leftX + left.thickness / 2,
    y: bottomY + bottom.thickness / 2,
    width,
    depth,
    thickness: left.thickness,
  };
}

export type RoomIds = {
  room: string;
  bottom: string;
  right: string;
  top: string;
  left: string;
};

export function addRoom(plan: Plan, interior: { x: number; y: number; width: number; depth: number }, thickness: number, ids: RoomIds): Plan {
  if (!(interior.width >= 10) || !(interior.depth >= 10) || !(thickness > 0)) return plan;
  const next = clonePlan(plan);
  const leftX = interior.x - thickness / 2;
  const rightX = interior.x + interior.width + thickness / 2;
  const bottomY = interior.y - thickness / 2;
  const topY = interior.y + interior.depth + thickness / 2;
  const wall = (id: string, a: Point, b: Point): Wall => ({ id, a, b, thickness });
  next.walls.push(
    wall(ids.bottom, { x: leftX, y: bottomY }, { x: rightX, y: bottomY }),
    wall(ids.right, { x: rightX, y: bottomY }, { x: rightX, y: topY }),
    wall(ids.top, { x: leftX, y: topY }, { x: rightX, y: topY }),
    wall(ids.left, { x: leftX, y: bottomY }, { x: leftX, y: topY }),
  );
  next.rooms.push({
    id: ids.room,
    wallIds: [ids.bottom, ids.right, ids.top, ids.left],
  });
  return next;
}

export function addWall(plan: Plan, a: Point, b: Point, thickness: number, id: string): Plan {
  if (!(thickness > 0) || distance(a, b) < 10) return plan;
  const next = clonePlan(plan);
  next.walls.push({ id, a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, thickness });
  return next;
}

/** Keep the interior bottom-left corner fixed and rebuild the four centerlines. */
export function setRoomInteriorSize(plan: Plan, roomId: string, width: number, depth: number): Plan {
  const room = roomById(plan, roomId);
  if (!room) return plan;
  const metrics = roomMetrics(plan, room);
  if (!metrics) return plan;
  if (!(width >= 10) || !(depth >= 10) || width > 1_000_000 || depth > 1_000_000) return plan;

  const next = clonePlan(plan);
  const [bottom, right, top, left] = room.wallIds.map((id) => wallById(next, id)!) as [Wall, Wall, Wall, Wall];
  const leftX = metrics.x - left.thickness / 2;
  const rightX = metrics.x + width + right.thickness / 2;
  const bottomY = metrics.y - bottom.thickness / 2;
  const topY = metrics.y + depth + top.thickness / 2;

  left.a = { x: leftX, y: bottomY };
  left.b = { x: leftX, y: topY };
  right.a = { x: rightX, y: bottomY };
  right.b = { x: rightX, y: topY };
  top.a = { x: leftX, y: topY };
  top.b = { x: rightX, y: topY };
  bottom.a = { x: leftX, y: bottomY };
  bottom.b = { x: rightX, y: bottomY };
  return next;
}

/**
 * Set the length a dimension label is showing.
 * Room walls change the interior width or depth and stay joined.
 * A free wall keeps its start and angle and moves its end.
 */
export function setWallLength(plan: Plan, wallId: string, length: number): Plan {
  if (!(length >= 10) || length > 1_000_000) return plan;
  const room = roomOfWall(plan, wallId);
  if (room) {
    const metrics = roomMetrics(plan, room);
    if (!metrics) return plan;
    const index = room.wallIds.indexOf(wallId);
    if (index === 0 || index === 2) return setRoomInteriorSize(plan, room.id, length, metrics.depth);
    return setRoomInteriorSize(plan, room.id, metrics.width, length);
  }
  const wall = wallById(plan, wallId);
  if (!wall) return plan;
  const lengthNow = wallLength(wall);
  if (lengthNow < 1e-6) return plan;
  const next = clonePlan(plan);
  const target = wallById(next, wallId)!;
  const scale = length / lengthNow;
  target.b = {
    x: target.a.x + (target.b.x - target.a.x) * scale,
    y: target.a.y + (target.b.y - target.a.y) * scale,
  };
  return next;
}

export function deleteWall(plan: Plan, wallId: string): Plan {
  if (!wallById(plan, wallId)) return plan;
  const next = clonePlan(plan);
  next.walls = next.walls.filter((wall) => wall.id !== wallId);
  next.rooms = next.rooms.filter((room) => !room.wallIds.includes(wallId));
  return next;
}

export function deleteRoom(plan: Plan, roomId: string): Plan {
  const room = roomById(plan, roomId);
  if (!room) return plan;
  const drop = new Set<string>(room.wallIds);
  const next = clonePlan(plan);
  next.walls = next.walls.filter((wall) => !drop.has(wall.id));
  next.rooms = next.rooms.filter((item) => item.id !== roomId);
  return next;
}

export function deleteSelection(plan: Plan, selection: Selection): Plan {
  if (selection.kind === "room") return deleteRoom(plan, selection.id);
  if (selection.kind === "wall") return deleteWall(plan, selection.id);
  return plan;
}

export function translateWalls(plan: Plan, ids: readonly string[], dx: number, dy: number): Plan {
  if (dx === 0 && dy === 0) return plan;
  const moving = new Set(ids);
  const next = clonePlan(plan);
  for (const wall of next.walls) {
    if (!moving.has(wall.id)) continue;
    wall.a = { x: wall.a.x + dx, y: wall.a.y + dy };
    wall.b = { x: wall.b.x + dx, y: wall.b.y + dy };
  }
  return next;
}

/**
 * Change thickness. A room keeps its clear interior and its bottom-left corner;
 * centerlines move outward as the wall gets thicker.
 */
export function applyThickness(plan: Plan, selection: Selection, thickness: number): Plan {
  if (!(thickness > 0) || selection.kind === "none") return plan;
  if (selection.kind === "wall" && !roomOfWall(plan, selection.id)) {
    const next = clonePlan(plan);
    const wall = wallById(next, selection.id);
    if (!wall) return plan;
    wall.thickness = thickness;
    return next;
  }
  const room = selection.kind === "room" ? roomById(plan, selection.id) : roomOfWall(plan, selection.id);
  if (!room) return plan;
  const metrics = roomMetrics(plan, room);
  if (!metrics) return plan;
  const next = clonePlan(plan);
  const [bottom, right, top, left] = room.wallIds.map((id) => wallById(next, id)!) as [Wall, Wall, Wall, Wall];
  const leftX = metrics.x - thickness / 2;
  const rightX = metrics.x + metrics.width + thickness / 2;
  const bottomY = metrics.y - thickness / 2;
  const topY = metrics.y + metrics.depth + thickness / 2;
  for (const wall of [bottom, right, top, left]) wall.thickness = thickness;
  left.a = { x: leftX, y: bottomY };
  left.b = { x: leftX, y: topY };
  right.a = { x: rightX, y: bottomY };
  right.b = { x: rightX, y: topY };
  top.a = { x: leftX, y: topY };
  top.b = { x: rightX, y: topY };
  bottom.a = { x: leftX, y: bottomY };
  bottom.b = { x: rightX, y: bottomY };
  return next;
}

export function wallIdsForSelection(plan: Plan, selection: Selection): string[] {
  if (selection.kind === "room") return [...(roomById(plan, selection.id)?.wallIds ?? [])];
  if (selection.kind === "wall") {
    const room = roomOfWall(plan, selection.id);
    return room ? [...room.wallIds] : [selection.id];
  }
  return [];
}

export function selectionAnchor(plan: Plan, selection: Selection): Point | null {
  if (selection.kind === "room") {
    const room = roomById(plan, selection.id);
    const metrics = room && roomMetrics(plan, room);
    return metrics ? { x: metrics.x, y: metrics.y } : null;
  }
  if (selection.kind === "wall") {
    const wall = wallById(plan, selection.id);
    return wall ? { x: wall.a.x, y: wall.a.y } : null;
  }
  return null;
}

export function contentBounds(plan: Plan): { x: number; y: number; width: number; depth: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const wall of plan.walls) {
    for (const point of wallDrawPolygon(plan, wall)) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  if (!Number.isFinite(minX) || maxX - minX < 1 || maxY - minY < 1) return null;
  return { x: minX, y: minY, width: maxX - minX, depth: maxY - minY };
}

export function planSummary(plan: Plan): string {
  if (plan.walls.length === 0) return "Empty sketch. No walls.";
  const parts: string[] = [];
  plan.rooms.forEach((room, index) => {
    const metrics = roomMetrics(plan, room);
    if (!metrics) return;
    parts.push(
      `Room ${index + 1} interior ${Math.round(metrics.width)} by ${Math.round(metrics.depth)} millimetres, wall thickness ${Math.round(metrics.thickness)}.`,
    );
  });
  const free = plan.walls.filter((wall) => !roomOfWall(plan, wall.id));
  free.forEach((wall, index) => {
    parts.push(
      `Wall ${index + 1} length ${Math.round(wallLength(wall))} millimetres, thickness ${Math.round(wall.thickness)}.`,
    );
  });
  return parts.join(" ");
}

export function hitTest(plan: Plan, world: Point, pxPerMm: number): Selection {
  const slop = pxPerMm > 0 ? 12 / pxPerMm : 12;
  let best: { id: string; distance: number } | null = null;
  for (const wall of plan.walls) {
    const d = distanceToSegment(world, wall.a, wall.b);
    const limit = wall.thickness / 2 + slop;
    if (d <= limit && (!best || d < best.distance)) best = { id: wall.id, distance: d };
  }
  if (best) return { kind: "wall", id: best.id };

  for (const room of plan.rooms) {
    const metrics = roomMetrics(plan, room);
    if (!metrics) continue;
    if (
      world.x >= metrics.x &&
      world.x <= metrics.x + metrics.width &&
      world.y >= metrics.y &&
      world.y <= metrics.y + metrics.depth
    ) {
      return { kind: "room", id: room.id };
    }
  }
  return { kind: "none" };
}
