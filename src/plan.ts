import { calloutNear, manualDimGeometry } from "./annotations";
import { CATALOG, clearancePolygon, fixturePolygon, hitsFixture, reseatFixture, snapFixture } from "./fixtures";
import { distance, distanceToSegment, wallPolygon } from "./geometry";
import { clampOpening, hitOpening, openingFrame, pocketForWidth, snapOpening } from "./openings";
import { isVisible } from "./phase";
import {
  emptyMeta,
  emptyPlan,
  type Callout,
  type Fixture,
  type FixtureKind,
  type ManualDim,
  type Note,
  type Opening,
  type Origin,
  type Plan,
  type PlanMeta,
  type Point,
  type QuarterTurn,
  type Removal,
  type Room,
  type RoomMetrics,
  type Selection,
  type Sheet,
  type Side,
  type Wall,
} from "./types";

const FIXTURE_KINDS = new Set<string>(Object.keys(CATALOG));
const OPENING_KINDS = new Set(["hinged", "cavity", "window"]);

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

function num(value: unknown, fallback: number, min = -1e8, max = 1e8): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function text(value: unknown, fallback: string, max = 2000): string {
  return typeof value === "string" ? value.slice(0, max) : fallback;
}

function originOf(value: unknown): Origin {
  return value === "new" ? "new" : "existing";
}

function removalOf(value: unknown): Removal {
  return value === "remove" ? "remove" : "keep";
}

function sideOf(value: unknown): Side {
  return value === -1 ? -1 : 1;
}

function sheetOf(value: unknown, fallback: Sheet): Sheet {
  return value === "existing" || value === "proposed" ? value : fallback;
}

function quarterOf(value: unknown): QuarterTurn {
  return value === 90 || value === 180 || value === 270 ? value : 0;
}

/** Accept a version-1 or version-2 millimetre plan. Anything else becomes empty. */
export function sanitizePlan(input: unknown): Plan {
  if (!input || typeof input !== "object") return emptyPlan();
  const record = input as Record<string, unknown>;
  if ((record.version !== 1 && record.version !== 2) || record.units !== "mm") return emptyPlan();
  const raw = input as Partial<Plan>;

  const walls: Wall[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw.walls)) {
    for (const item of raw.walls) {
      if (!item || typeof item !== "object") continue;
      const wall = item as Wall;
      if (typeof wall.id !== "string" || !wall.id || wall.id.startsWith("preview-") || seen.has(wall.id)) continue;
      if (!isPoint(wall.a) || !isPoint(wall.b)) continue;
      if (typeof wall.thickness !== "number" || !(wall.thickness > 0) || wall.thickness > 2000) continue;
      seen.add(wall.id);
      walls.push({
        id: wall.id.slice(0, 80),
        a: { x: wall.a.x, y: wall.a.y },
        b: { x: wall.b.x, y: wall.b.y },
        thickness: wall.thickness,
        origin: originOf(wall.origin),
        removal: removalOf(wall.removal),
      });
    }
  }

  const rooms: Room[] = [];
  const seenRooms = new Set<string>();
  if (Array.isArray(raw.rooms)) {
    for (const item of raw.rooms) {
      if (!item || typeof item !== "object") continue;
      const room = item as Room;
      if (typeof room.id !== "string" || !room.id || seenRooms.has(room.id)) continue;
      if (!Array.isArray(room.wallIds) || room.wallIds.length !== 4) continue;
      const ids = room.wallIds;
      if (!ids.every((id) => typeof id === "string" && seen.has(id))) continue;
      seenRooms.add(room.id);
      rooms.push({
        id: room.id.slice(0, 80),
        wallIds: [ids[0], ids[1], ids[2], ids[3]],
        name: text(room.name, "", 40),
        ceiling: num(room.ceiling, 2400, 0, 8000),
      });
    }
  }

  const openings: Opening[] = [];
  const seenOpenings = new Set<string>();
  if (Array.isArray(raw.openings)) {
    for (const item of raw.openings) {
      if (!item || typeof item !== "object") continue;
      const opening = item as Opening;
      if (typeof opening.id !== "string" || !opening.id || opening.id.startsWith("preview-") || seenOpenings.has(opening.id)) continue;
      if (typeof opening.wallId !== "string" || !seen.has(opening.wallId)) continue;
      if (!OPENING_KINDS.has(opening.kind)) continue;
      seenOpenings.add(opening.id);
      const kind = opening.kind;
      openings.push({
        id: opening.id.slice(0, 80),
        wallId: opening.wallId,
        kind,
        offset: num(opening.offset, 0, 0, 1e7),
        width: num(opening.width, kind === "window" ? 900 : 820, 100, 10000),
        pocket: kind === "cavity" ? num(opening.pocket, 0, 0, 10000) : 0,
        hand: opening.hand === "end" ? "end" : "start",
        side: sideOf(opening.side),
        sill: num(opening.sill, kind === "window" ? 1000 : 0, 0, 8000),
        head: num(opening.head, kind === "window" ? 2100 : 2040, 0, 8000),
        origin: originOf(opening.origin),
        removal: removalOf(opening.removal),
      });
    }
  }

  const fixtures: Fixture[] = [];
  const seenFixtures = new Set<string>();
  if (Array.isArray(raw.fixtures)) {
    for (const item of raw.fixtures) {
      if (!item || typeof item !== "object") continue;
      const fixture = item as Fixture;
      if (typeof fixture.id !== "string" || !fixture.id || fixture.id.startsWith("preview-") || seenFixtures.has(fixture.id)) continue;
      if (!FIXTURE_KINDS.has(fixture.kind)) continue;
      if (!Number.isFinite(fixture.x) || !Number.isFinite(fixture.y)) continue;
      seenFixtures.add(fixture.id);
      const kind = fixture.kind as FixtureKind;
      const wallId = typeof fixture.wallId === "string" && seen.has(fixture.wallId) ? fixture.wallId : null;
      fixtures.push({
        id: fixture.id.slice(0, 80),
        kind,
        x: fixture.x,
        y: fixture.y,
        rotation: quarterOf(fixture.rotation),
        width: num(fixture.width, CATALOG[kind].width, 20, 8000),
        depth: num(fixture.depth, CATALOG[kind].depth, 10, 8000),
        affl: num(fixture.affl, CATALOG[kind].affl, 0, 8000),
        height: num(fixture.height, CATALOG[kind].height, 0, 8000),
        diameter: kind === "turning" ? num(fixture.diameter, fixture.width, 100, 8000) : 0,
        clearance: fixture.clearance === true,
        origin: originOf(fixture.origin),
        removal: removalOf(fixture.removal),
        wallId,
        along: wallId && typeof fixture.along === "number" && Number.isFinite(fixture.along) ? fixture.along : null,
        side: sideOf(fixture.side),
      });
    }
  }

  const metaRaw = raw.meta && typeof raw.meta === "object" ? raw.meta : emptyMeta();
  const meta: PlanMeta = {
    client: text(metaRaw.client, "", 200),
    address: text(metaRaw.address, "", 400),
    drawnBy: text(metaRaw.drawnBy, "", 80),
    date: text(metaRaw.date, "", 40),
    revision: typeof metaRaw.revision === "string" ? metaRaw.revision.slice(0, 20) : "A",
    project: text(metaRaw.project, "", 120),
    notes: typeof metaRaw.notes === "string" ? metaRaw.notes.slice(0, 4000) : emptyMeta().notes,
  };

  return normalize({
    version: 2,
    units: "mm",
    walls,
    rooms,
    openings,
    fixtures,
    callouts: sanitizeCallouts(raw.callouts),
    notes: sanitizeNotes(raw.notes),
    dims: sanitizeDims(raw.dims),
    meta,
  });
}

function sanitizeCallouts(input: unknown): Callout[] {
  if (!Array.isArray(input)) return [];
  const callouts: Callout[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const callout = item as Callout;
    if (typeof callout.id !== "string" || !callout.id || seen.has(callout.id)) continue;
    if (!isPoint(callout.anchor) || !isPoint(callout.label)) continue;
    seen.add(callout.id);
    callouts.push({
      id: callout.id.slice(0, 80),
      number: Math.round(num(callout.number, callouts.length + 1, 1, 999)),
      text: text(callout.text, "", 400),
      anchor: { ...callout.anchor },
      label: { ...callout.label },
      sheet: sheetOf(callout.sheet, "proposed"),
    });
  }
  return callouts;
}

function sanitizeNotes(input: unknown): Note[] {
  if (!Array.isArray(input)) return [];
  const notes: Note[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const note = item as Note;
    if (typeof note.id !== "string" || !note.id || seen.has(note.id) || !isPoint(note.at)) continue;
    seen.add(note.id);
    notes.push({
      id: note.id.slice(0, 80),
      text: text(note.text, "", 400),
      at: { ...note.at },
      sheet: sheetOf(note.sheet, "proposed"),
    });
  }
  return notes;
}

function sanitizeDims(input: unknown): ManualDim[] {
  if (!Array.isArray(input)) return [];
  const dims: ManualDim[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const dim = item as ManualDim;
    if (typeof dim.id !== "string" || !dim.id || seen.has(dim.id)) continue;
    if (!isPoint(dim.a) || !isPoint(dim.b)) continue;
    seen.add(dim.id);
    dims.push({
      id: dim.id.slice(0, 80),
      a: { ...dim.a },
      b: { ...dim.b },
      offset: num(dim.offset, 220, -5000, 5000),
      sheet: sheetOf(dim.sheet, "existing"),
    });
  }
  return dims;
}

export function wallById(plan: Plan, id: string): Wall | undefined {
  return plan.walls.find((wall) => wall.id === id);
}

export function roomById(plan: Plan, id: string): Room | undefined {
  return plan.rooms.find((room) => room.id === id);
}

export function openingById(plan: Plan, id: string): Opening | undefined {
  return plan.openings.find((opening) => opening.id === id);
}

export function fixtureById(plan: Plan, id: string): Fixture | undefined {
  return plan.fixtures.find((fixture) => fixture.id === id);
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

export function roomCenter(plan: Plan, room: Room): Point | null {
  const metrics = roomMetrics(plan, room);
  if (!metrics) return null;
  return { x: metrics.x + metrics.width / 2, y: metrics.y + metrics.depth / 2 };
}

export type RoomIds = {
  room: string;
  bottom: string;
  right: string;
  top: string;
  left: string;
};

export function addRoom(
  plan: Plan,
  interior: { x: number; y: number; width: number; depth: number },
  thickness: number,
  ids: RoomIds,
  origin: Origin = "existing",
): Plan {
  if (!(interior.width >= 10) || !(interior.depth >= 10) || !(thickness > 0)) return plan;
  const next = clonePlan(plan);
  const leftX = interior.x - thickness / 2;
  const rightX = interior.x + interior.width + thickness / 2;
  const bottomY = interior.y - thickness / 2;
  const topY = interior.y + interior.depth + thickness / 2;
  const wall = (id: string, a: Point, b: Point): Wall => ({ id, a, b, thickness, origin, removal: "keep" });
  next.walls.push(
    wall(ids.bottom, { x: leftX, y: bottomY }, { x: rightX, y: bottomY }),
    wall(ids.right, { x: rightX, y: bottomY }, { x: rightX, y: topY }),
    wall(ids.top, { x: leftX, y: topY }, { x: rightX, y: topY }),
    wall(ids.left, { x: leftX, y: bottomY }, { x: leftX, y: topY }),
  );
  next.rooms.push({
    id: ids.room,
    wallIds: [ids.bottom, ids.right, ids.top, ids.left],
    name: "",
    ceiling: 2400,
  });
  return next;
}

export function addWall(plan: Plan, a: Point, b: Point, thickness: number, id: string, origin: Origin = "existing"): Plan {
  if (!(thickness > 0) || distance(a, b) < 10) return plan;
  const next = clonePlan(plan);
  next.walls.push({ id, a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, thickness, origin, removal: "keep" });
  return next;
}

export function addOpening(plan: Plan, opening: Opening): Plan {
  const wall = wallById(plan, opening.wallId);
  if (!wall) return plan;
  const next = clonePlan(plan);
  next.openings.push(clampOpening(wall, opening));
  return next;
}

export function addFixture(plan: Plan, fixture: Fixture): Plan {
  const next = clonePlan(plan);
  next.fixtures.push(fixture);
  return normalize(next);
}

export function addCallout(plan: Plan, callout: Callout): Plan {
  if (!callout.text.trim()) return plan;
  const next = clonePlan(plan);
  next.callouts.push({ ...callout, text: callout.text.trim().toUpperCase() });
  return next;
}

export function addNote(plan: Plan, note: Note): Plan {
  if (!note.text.trim()) return plan;
  const next = clonePlan(plan);
  next.notes.push({ ...note, text: note.text.trim() });
  return next;
}

export function addDim(plan: Plan, dim: ManualDim): Plan {
  if (distance(dim.a, dim.b) < 10) return plan;
  const next = clonePlan(plan);
  next.dims.push(dim);
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
  return normalize(next);
}

export function setRoomInfo(plan: Plan, roomId: string, info: { name?: string; ceiling?: number }): Plan {
  if (!roomById(plan, roomId)) return plan;
  const next = clonePlan(plan);
  const room = roomById(next, roomId)!;
  if (info.name != null) room.name = info.name.trim().slice(0, 40).toUpperCase();
  if (info.ceiling != null && Number.isFinite(info.ceiling)) room.ceiling = Math.min(8000, Math.max(0, Math.round(info.ceiling)));
  return next;
}

export function setMeta(plan: Plan, meta: PlanMeta): Plan {
  const next = clonePlan(plan);
  next.meta = {
    client: meta.client.slice(0, 200),
    address: meta.address.slice(0, 400),
    drawnBy: meta.drawnBy.slice(0, 80),
    date: meta.date.slice(0, 40),
    revision: meta.revision.slice(0, 20),
    project: meta.project.slice(0, 120),
    notes: meta.notes.slice(0, 4000),
  };
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
  return normalize(next);
}

export function updateOpening(
  plan: Plan,
  id: string,
  patch: Partial<Pick<Opening, "width" | "hand" | "side" | "sill" | "head">>,
): Plan {
  const opening = openingById(plan, id);
  const wall = opening && wallById(plan, opening.wallId);
  if (!opening || !wall) return plan;
  const next = clonePlan(plan);
  const target = openingById(next, id)!;
  if (patch.hand) target.hand = patch.hand;
  if (patch.side) target.side = patch.side;
  if (patch.sill != null && Number.isFinite(patch.sill)) target.sill = Math.min(8000, Math.max(0, Math.round(patch.sill)));
  if (patch.head != null && Number.isFinite(patch.head)) target.head = Math.min(8000, Math.max(0, Math.round(patch.head)));
  if (target.head < target.sill + 50) target.head = target.sill + 50;
  if (patch.width != null && patch.width >= 100 && patch.width <= 10000) {
    target.width = patch.width;
    if (target.kind === "cavity") target.pocket = pocketForWidth(patch.width);
  }
  const host = wallById(next, target.wallId)!;
  const clamped = clampOpening(host, target);
  target.width = clamped.width;
  target.offset = clamped.offset;
  target.pocket = clamped.pocket;
  return next;
}

export function moveOpeningTo(plan: Plan, id: string, offset: number, grid: number): Plan {
  const opening = openingById(plan, id);
  const wall = opening && wallById(plan, opening.wallId);
  if (!opening || !wall) return plan;
  const next = clonePlan(plan);
  const target = openingById(next, id)!;
  const snapped = snapOpening(wall, { ...target, offset }, grid);
  target.offset = snapped.offset;
  target.width = snapped.width;
  return next;
}

export function updateFixture(
  plan: Plan,
  id: string,
  patch: Partial<Pick<Fixture, "width" | "depth" | "affl" | "height" | "clearance" | "diameter">>,
): Plan {
  const fixture = fixtureById(plan, id);
  if (!fixture) return plan;
  const next = clonePlan(plan);
  const target = fixtureById(next, id)!;
  if (patch.width != null) target.width = Math.min(8000, Math.max(40, Math.round(patch.width)));
  if (patch.depth != null) target.depth = Math.min(8000, Math.max(10, Math.round(patch.depth)));
  if (patch.affl != null) target.affl = Math.min(8000, Math.max(0, Math.round(patch.affl)));
  if (patch.height != null) target.height = Math.min(8000, Math.max(0, Math.round(patch.height)));
  if (patch.clearance != null) target.clearance = patch.clearance;
  if (target.kind === "turning") {
    const requested = patch.diameter ?? target.diameter ?? target.width;
    const size = requested >= 1800 ? 2070 : 1540;
    target.diameter = size;
    target.width = size;
    target.depth = size;
  }
  return normalize(next);
}

export function moveFixtureTo(plan: Plan, id: string, target: Point, grid: number, tolMm: number, sheet: Sheet): Plan {
  const fixture = fixtureById(plan, id);
  if (!fixture) return plan;
  const next = clonePlan(plan);
  const index = next.fixtures.findIndex((item) => item.id === id);
  next.fixtures[index] = snapNewFixture(plan, fixture, target, grid, tolMm, sheet);
  return next;
}

export function snapNewFixture(plan: Plan, fixture: Fixture, target: Point, grid: number, tolMm: number, sheet: Sheet): Fixture {
  return snapFixture({ ...fixture }, target, visibleWalls(plan, sheet), roomCenters(plan), grid, tolMm);
}

export function nudgeItem(plan: Plan, selection: Selection, dx: number, dy: number): Plan {
  if (dx === 0 && dy === 0) return plan;
  const next = clonePlan(plan);
  if (selection.kind === "callout") {
    const item = next.callouts.find((callout) => callout.id === selection.id);
    if (!item) return plan;
    item.anchor = shift(item.anchor, dx, dy);
    item.label = shift(item.label, dx, dy);
    return next;
  }
  if (selection.kind === "text") {
    const item = next.notes.find((note) => note.id === selection.id);
    if (!item) return plan;
    item.at = shift(item.at, dx, dy);
    return next;
  }
  if (selection.kind === "dim") {
    const item = next.dims.find((dim) => dim.id === selection.id);
    if (!item) return plan;
    item.a = shift(item.a, dx, dy);
    item.b = shift(item.b, dx, dy);
    return next;
  }
  return plan;
}

export function rotateFixture(plan: Plan, id: string): Plan {
  const fixture = fixtureById(plan, id);
  if (!fixture) return plan;
  const next = clonePlan(plan);
  const target = fixtureById(next, id)!;
  target.rotation = (((target.rotation + 90) % 360) || 0) as QuarterTurn;
  target.wallId = null;
  target.along = null;
  return next;
}

export function deleteWall(plan: Plan, wallId: string): Plan {
  if (!wallById(plan, wallId)) return plan;
  const next = clonePlan(plan);
  next.walls = next.walls.filter((wall) => wall.id !== wallId);
  next.rooms = next.rooms.filter((room) => !room.wallIds.includes(wallId));
  next.openings = next.openings.filter((opening) => opening.wallId !== wallId);
  for (const fixture of next.fixtures) {
    if (fixture.wallId === wallId) {
      fixture.wallId = null;
      fixture.along = null;
    }
  }
  return next;
}

export function deleteRoom(plan: Plan, roomId: string): Plan {
  const room = roomById(plan, roomId);
  if (!room) return plan;
  const metrics = roomMetrics(plan, room);
  const drop = new Set<string>(room.wallIds);
  const next = clonePlan(plan);
  next.walls = next.walls.filter((wall) => !drop.has(wall.id));
  next.rooms = next.rooms.filter((item) => item.id !== roomId);
  next.openings = next.openings.filter((opening) => !drop.has(opening.wallId));
  next.fixtures = next.fixtures.filter((fixture) => {
    if (fixture.wallId && drop.has(fixture.wallId)) return false;
    if (!metrics) return true;
    return !(
      fixture.x >= metrics.x &&
      fixture.x <= metrics.x + metrics.width &&
      fixture.y >= metrics.y &&
      fixture.y <= metrics.y + metrics.depth
    );
  });
  return next;
}

export function deleteOpening(plan: Plan, id: string): Plan {
  if (!openingById(plan, id)) return plan;
  const next = clonePlan(plan);
  next.openings = next.openings.filter((opening) => opening.id !== id);
  return next;
}

export function deleteFixture(plan: Plan, id: string): Plan {
  if (!fixtureById(plan, id)) return plan;
  const next = clonePlan(plan);
  next.fixtures = next.fixtures.filter((fixture) => fixture.id !== id);
  return next;
}

export function deleteCallout(plan: Plan, id: string): Plan {
  const next = clonePlan(plan);
  next.callouts = next.callouts.filter((callout) => callout.id !== id);
  return next;
}

export function deleteNote(plan: Plan, id: string): Plan {
  const next = clonePlan(plan);
  next.notes = next.notes.filter((note) => note.id !== id);
  return next;
}

export function deleteDim(plan: Plan, id: string): Plan {
  const next = clonePlan(plan);
  next.dims = next.dims.filter((dim) => dim.id !== id);
  return next;
}

export function updateCallout(plan: Plan, id: string, textValue: string): Plan {
  if (!plan.callouts.some((callout) => callout.id === id)) return plan;
  const trimmed = textValue.trim().toUpperCase();
  if (!trimmed) return deleteCallout(plan, id);
  const next = clonePlan(plan);
  const callout = next.callouts.find((item) => item.id === id)!;
  callout.text = trimmed.slice(0, 400);
  return next;
}

export function updateNote(plan: Plan, id: string, textValue: string): Plan {
  if (!plan.notes.some((note) => note.id === id)) return plan;
  const trimmed = textValue.trim();
  if (!trimmed) return deleteNote(plan, id);
  const next = clonePlan(plan);
  const note = next.notes.find((item) => item.id === id)!;
  note.text = trimmed.slice(0, 400);
  return next;
}

export function deleteSelection(plan: Plan, selection: Selection): Plan {
  if (selection.kind === "room") return deleteRoom(plan, selection.id);
  if (selection.kind === "wall") return deleteWall(plan, selection.id);
  if (selection.kind === "opening") return deleteOpening(plan, selection.id);
  if (selection.kind === "fixture") return deleteFixture(plan, selection.id);
  if (selection.kind === "callout") return deleteCallout(plan, selection.id);
  if (selection.kind === "text") return deleteNote(plan, selection.id);
  if (selection.kind === "dim") return deleteDim(plan, selection.id);
  return plan;
}

/** Existing elements the Remove button can change. Null when the selection is new work or empty. */
export function removalState(plan: Plan, selection: Selection): Removal | null {
  const items = existingSelection(plan, selection);
  if (items.length === 0) return null;
  return items.every((item) => item.removal === "remove") ? "remove" : "keep";
}

export function markRemoval(plan: Plan, selection: Selection, removal: Removal): Plan {
  if (removalState(plan, selection) == null) return plan;
  const next = clonePlan(plan);
  if (selection.kind === "wall" || selection.kind === "room") {
    const ids = selection.kind === "wall" ? [selection.id] : [...(roomById(next, selection.id)?.wallIds ?? [])];
    const idSet = new Set(ids);
    for (const id of ids) {
      const wall = wallById(next, id);
      if (wall && wall.origin === "existing") wall.removal = removal;
    }
    for (const opening of next.openings) {
      if (idSet.has(opening.wallId) && opening.origin === "existing") opening.removal = removal;
    }
    return next;
  }
  if (selection.kind === "opening") {
    const opening = openingById(next, selection.id);
    if (opening && opening.origin === "existing") opening.removal = removal;
  }
  if (selection.kind === "fixture") {
    const fixture = fixtureById(next, selection.id);
    if (fixture && fixture.origin === "existing") fixture.removal = removal;
  }
  return next;
}

function existingSelection(plan: Plan, selection: Selection): { removal: Removal }[] {
  if (selection.kind === "wall") {
    const wall = wallById(plan, selection.id);
    return wall && wall.origin === "existing" ? [wall] : [];
  }
  if (selection.kind === "room") {
    const room = roomById(plan, selection.id);
    if (!room) return [];
    return room.wallIds
      .map((id) => wallById(plan, id))
      .filter((wall): wall is Wall => !!wall && wall.origin === "existing");
  }
  if (selection.kind === "opening") {
    const opening = openingById(plan, selection.id);
    return opening && opening.origin === "existing" ? [opening] : [];
  }
  if (selection.kind === "fixture") {
    const fixture = fixtureById(plan, selection.id);
    return fixture && fixture.origin === "existing" ? [fixture] : [];
  }
  return [];
}

export function translateWalls(plan: Plan, ids: readonly string[], dx: number, dy: number): Plan {
  if (dx === 0 && dy === 0) return plan;
  const moving = new Set(ids);
  const box = boundsOf(plan, moving);
  const next = clonePlan(plan);
  for (const wall of next.walls) {
    if (!moving.has(wall.id)) continue;
    wall.a = shift(wall.a, dx, dy);
    wall.b = shift(wall.b, dx, dy);
  }
  for (const fixture of next.fixtures) {
    const attached = fixture.wallId != null && moving.has(fixture.wallId);
    const inside = box != null && contains(box, fixture.x, fixture.y, 120);
    if (!attached && !inside) continue;
    fixture.x += dx;
    fixture.y += dy;
  }
  for (const callout of next.callouts) {
    if (!box || !contains(box, callout.anchor.x, callout.anchor.y, 400)) continue;
    callout.anchor = shift(callout.anchor, dx, dy);
    callout.label = shift(callout.label, dx, dy);
  }
  for (const note of next.notes) {
    if (!box || !contains(box, note.at.x, note.at.y, 400)) continue;
    note.at = shift(note.at, dx, dy);
  }
  for (const dim of next.dims) {
    const midX = (dim.a.x + dim.b.x) / 2;
    const midY = (dim.a.y + dim.b.y) / 2;
    if (!box || !contains(box, midX, midY, 400)) continue;
    dim.a = shift(dim.a, dx, dy);
    dim.b = shift(dim.b, dx, dy);
  }
  return normalize(next);
}

/**
 * Change thickness. A room keeps its clear interior and its bottom-left corner;
 * centerlines move outward as the wall gets thicker.
 */
export function applyThickness(plan: Plan, selection: Selection, thickness: number): Plan {
  if (!(thickness > 0) || (selection.kind !== "wall" && selection.kind !== "room")) return plan;
  if (selection.kind === "wall" && !roomOfWall(plan, selection.id)) {
    const next = clonePlan(plan);
    const wall = wallById(next, selection.id);
    if (!wall) return plan;
    wall.thickness = thickness;
    return normalize(next);
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
  return normalize(next);
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
  if (selection.kind === "fixture") {
    const fixture = fixtureById(plan, selection.id);
    return fixture ? { x: fixture.x, y: fixture.y } : null;
  }
  if (selection.kind === "opening") {
    const opening = openingById(plan, selection.id);
    const wall = opening && wallById(plan, opening.wallId);
    const frame = wall && opening && openingFrame(wall, opening);
    return frame ? frame.center : null;
  }
  if (selection.kind === "callout") {
    const callout = plan.callouts.find((item) => item.id === selection.id);
    return callout ? { ...callout.label } : null;
  }
  if (selection.kind === "text") {
    const note = plan.notes.find((item) => item.id === selection.id);
    return note ? { ...note.at } : null;
  }
  if (selection.kind === "dim") {
    const dim = plan.dims.find((item) => item.id === selection.id);
    return dim ? { x: (dim.a.x + dim.b.x) / 2, y: (dim.a.y + dim.b.y) / 2 } : null;
  }
  return null;
}

export function contentBounds(plan: Plan, sheet?: Sheet): { x: number; y: number; width: number; depth: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (point: Point) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  };
  for (const wall of plan.walls) {
    if (wall.id.startsWith("preview-")) continue;
    if (sheet && !isVisible(wall, sheet)) continue;
    for (const point of wallDrawPolygon(plan, wall)) add(point);
  }
  for (const opening of plan.openings) {
    if (opening.id.startsWith("preview-")) continue;
    const wall = wallById(plan, opening.wallId);
    if (!wall || (sheet && (!isVisible(wall, sheet) || !isVisible(opening, sheet)))) continue;
    const frame = openingFrame(wall, opening);
    if (!frame) continue;
    add(frame.jambA);
    add(frame.jambB);
    add(frame.leafEnd);
    add(frame.pocketEnd);
  }
  for (const fixture of plan.fixtures) {
    if (fixture.id.startsWith("preview-")) continue;
    if (sheet && !isVisible(fixture, sheet)) continue;
    for (const point of fixturePolygon(fixture)) add(point);
    if (fixture.kind === "toilet" && fixture.clearance) {
      for (const point of clearancePolygon(fixture)) add(point);
    }
  }
  for (const callout of plan.callouts) {
    if (sheet && callout.sheet !== sheet) continue;
    add(callout.anchor);
    add(callout.label);
  }
  for (const note of plan.notes) {
    if (sheet && note.sheet !== sheet) continue;
    add(note.at);
  }
  for (const dim of plan.dims) {
    if (sheet && dim.sheet !== sheet) continue;
    add(dim.a);
    add(dim.b);
    const line = manualDimGeometry(dim);
    if (line) {
      add(line.a);
      add(line.b);
    }
  }
  if (!Number.isFinite(minX) || maxX - minX < 1 || maxY - minY < 1) return null;
  return { x: minX, y: minY, width: maxX - minX, depth: maxY - minY };
}

export function planSummary(plan: Plan): string {
  if (plan.walls.length === 0 && plan.fixtures.length === 0 && plan.openings.length === 0) return "Empty sketch. No walls.";
  const parts: string[] = [];
  plan.rooms.forEach((room, index) => {
    const metrics = roomMetrics(plan, room);
    if (!metrics) return;
    const name = room.name ? `${room.name} ` : `Room ${index + 1} `;
    parts.push(
      `${name}interior ${Math.round(metrics.width)} by ${Math.round(metrics.depth)} millimetres, wall thickness ${Math.round(metrics.thickness)}.`,
    );
  });
  const free = plan.walls.filter((wall) => !roomOfWall(plan, wall.id));
  free.forEach((wall, index) => {
    parts.push(
      `Wall ${index + 1} length ${Math.round(wallLength(wall))} millimetres, thickness ${Math.round(wall.thickness)}.`,
    );
  });
  if (plan.openings.length > 0) parts.push(`${plan.openings.length} ${plan.openings.length === 1 ? "opening" : "openings"}.`);
  if (plan.fixtures.length > 0) parts.push(`${plan.fixtures.length} ${plan.fixtures.length === 1 ? "fixture" : "fixtures"}.`);
  return parts.join(" ");
}

export function hitTest(plan: Plan, world: Point, pxPerMm: number, sheet?: Sheet): Selection {
  const slop = pxPerMm > 0 ? 12 / pxPerMm : 12;
  let best: { id: string; distance: number } | null = null;
  for (const wall of plan.walls) {
    if (wall.id.startsWith("preview-")) continue;
    if (sheet && !isVisible(wall, sheet)) continue;
    const d = distanceToSegment(world, wall.a, wall.b);
    const limit = wall.thickness / 2 + slop;
    if (d <= limit && (!best || d < best.distance)) best = { id: wall.id, distance: d };
  }
  if (best) return { kind: "wall", id: best.id };

  for (const room of plan.rooms) {
    if (sheet && !room.wallIds.some((id) => {
      const wall = wallById(plan, id);
      return !!wall && isVisible(wall, sheet);
    })) continue;
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

export function hitTestScene(plan: Plan, world: Point, pxPerMm: number, sheet: Sheet): Selection {
  const slop = pxPerMm > 0 ? 16 / pxPerMm : 16;
  for (let index = plan.fixtures.length - 1; index >= 0; index -= 1) {
    const fixture = plan.fixtures[index];
    if (fixture.id.startsWith("preview-") || !isVisible(fixture, sheet)) continue;
    if (hitsFixture(fixture, world, slop)) return { kind: "fixture", id: fixture.id };
  }
  for (const opening of plan.openings) {
    if (opening.id.startsWith("preview-") || !isVisible(opening, sheet)) continue;
    const wall = wallById(plan, opening.wallId);
    if (!wall || !isVisible(wall, sheet)) continue;
    if (hitOpening(wall, opening, world, slop)) return { kind: "opening", id: opening.id };
  }
  for (const callout of plan.callouts) {
    if (callout.id.startsWith("preview-") || callout.sheet !== sheet) continue;
    if (calloutNear(world, callout.anchor, callout.label, slop)) return { kind: "callout", id: callout.id };
  }
  for (const note of plan.notes) {
    if (note.id.startsWith("preview-") || note.sheet !== sheet) continue;
    if (distance(world, note.at) <= slop * 2) return { kind: "text", id: note.id };
  }
  for (const dim of plan.dims) {
    if (dim.id.startsWith("preview-") || dim.sheet !== sheet) continue;
    const line = manualDimGeometry(dim);
    if (line && distanceToSegment(world, line.a, line.b) <= slop) return { kind: "dim", id: dim.id };
  }
  return hitTest(plan, world, pxPerMm, sheet);
}

export function visibleWalls(plan: Plan, sheet: Sheet): Wall[] {
  return plan.walls.filter((wall) => isVisible(wall, sheet) && !wall.id.startsWith("preview-"));
}

function roomCenters(plan: Plan): { wallId: string; center: Point }[] {
  const centers: { wallId: string; center: Point }[] = [];
  for (const room of plan.rooms) {
    const center = roomCenter(plan, room);
    if (!center) continue;
    for (const wallId of room.wallIds) centers.push({ wallId, center });
  }
  return centers;
}

function normalize(plan: Plan): Plan {
  plan.openings = plan.openings.filter((opening) => {
    const wall = wallById(plan, opening.wallId);
    if (!wall) return false;
    const clamped = clampOpening(wall, opening);
    opening.offset = clamped.offset;
    opening.width = clamped.width;
    opening.pocket = clamped.pocket;
    return true;
  });
  for (let index = 0; index < plan.fixtures.length; index += 1) {
    const fixture = plan.fixtures[index];
    if (!fixture.wallId) continue;
    const wall = wallById(plan, fixture.wallId);
    if (!wall) {
      plan.fixtures[index] = { ...fixture, wallId: null, along: null };
      continue;
    }
    plan.fixtures[index] = reseatFixture(wall, fixture);
  }
  return plan;
}

function boundsOf(plan: Plan, ids: ReadonlySet<string>): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const wall of plan.walls) {
    if (!ids.has(wall.id)) continue;
    for (const point of [wall.a, wall.b]) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

function contains(box: { minX: number; minY: number; maxX: number; maxY: number }, x: number, y: number, pad: number): boolean {
  return x >= box.minX - pad && x <= box.maxX + pad && y >= box.minY - pad && y <= box.maxY + pad;
}

function shift(point: Point, dx: number, dy: number): Point {
  return { x: point.x + dx, y: point.y + dy };
}
