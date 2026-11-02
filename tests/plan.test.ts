import { describe, expect, it } from "vitest";
import { distance } from "../src/geometry";
import { layoutDimensions } from "../src/dimensions";
import { defaultView } from "../src/geometry";
import {
  addRoom,
  addWall,
  applyThickness,
  deleteRoom,
  planSummary,
  roomMetrics,
  sanitizePlan,
  setRoomInteriorSize,
  setWallLength,
  translateWalls,
  wallDrawPolygon,
} from "../src/plan";
import { emptyPlan, type Plan } from "../src/types";

const ids = {
  room: "room-1",
  bottom: "bottom",
  right: "right",
  top: "top",
  left: "left",
};

function roomPlan(): Plan {
  return addRoom(emptyPlan(), { x: 0, y: 0, width: 3000, depth: 2000 }, 90, ids);
}

describe("rooms", () => {
  it("builds four walls outside the clear interior", () => {
    const plan = roomPlan();
    expect(plan.walls).toHaveLength(4);
    const metrics = roomMetrics(plan, plan.rooms[0]);
    expect(metrics).toMatchObject({ x: 0, y: 0, width: 3000, depth: 2000, thickness: 90 });
    const right = plan.walls.find((wall) => wall.id === "right")!;
    const left = plan.walls.find((wall) => wall.id === "left")!;
    expect(right.a.x - left.a.x).toBeCloseTo(3000 + 90);
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
    expect(minX).toBeCloseTo(-90);
    expect(minY).toBeCloseTo(-90);
    expect(maxX).toBeCloseTo(3090);
    expect(maxY).toBeCloseTo(2090);
  });

  it("edits interior width and depth from the bottom-left corner", () => {
    const wider = setRoomInteriorSize(roomPlan(), "room-1", 3100, 2000);
    const metrics = roomMetrics(wider, wider.rooms[0])!;
    expect(metrics.x).toBeCloseTo(0);
    expect(metrics.y).toBeCloseTo(0);
    expect(metrics.width).toBeCloseTo(3100);
    expect(metrics.depth).toBeCloseTo(2000);

    const deeper = setRoomInteriorSize(wider, "room-1", 3100, 1800);
    const next = roomMetrics(deeper, deeper.rooms[0])!;
    expect(next.width).toBeCloseTo(3100);
    expect(next.depth).toBeCloseTo(1800);
  });

  it("treats a room-wall length edit as the interior span", () => {
    const plan = setWallLength(roomPlan(), "bottom", 2500);
    expect(roomMetrics(plan, plan.rooms[0])!.width).toBeCloseTo(2500);
    const side = setWallLength(plan, "left", 1600);
    expect(roomMetrics(side, side.rooms[0])!.depth).toBeCloseTo(1600);
  });

  it("changes thickness without moving or resizing the interior", () => {
    const plan = applyThickness(roomPlan(), { kind: "room", id: "room-1" }, 110);
    const metrics = roomMetrics(plan, plan.rooms[0])!;
    expect(metrics).toMatchObject({ x: 0, y: 0, width: 3000, depth: 2000 });
    expect(plan.walls.every((wall) => wall.thickness === 110)).toBe(true);
  });

  it("moves the whole room and can delete it", () => {
    const moved = translateWalls(roomPlan(), [ids.bottom, ids.right, ids.top, ids.left], 500, -200);
    const metrics = roomMetrics(moved, moved.rooms[0])!;
    expect(metrics.x).toBeCloseTo(500);
    expect(metrics.y).toBeCloseTo(-200);
    expect(metrics.width).toBeCloseTo(3000);
    const gone = deleteRoom(moved, "room-1");
    expect(gone.walls).toHaveLength(0);
    expect(gone.rooms).toHaveLength(0);
  });

  it("labels every wall with the interior millimetres", () => {
    const plan = roomPlan();
    const { labels } = layoutDimensions(plan, defaultView(4000, 4000, 1));
    const widths = labels.filter((label) => label.target.kind === "room-width").map((label) => label.mm);
    const depths = labels.filter((label) => label.target.kind === "room-depth").map((label) => label.mm);
    expect(widths).toEqual([3000, 3000]);
    expect(depths).toEqual([2000, 2000]);
    const top = labels.filter((label) => label.target.kind === "room-width").map((label) => label.y);
    expect(Math.max(...top) - Math.min(...top)).toBeGreaterThan(1500);
  });
});

describe("free walls", () => {
  it("keeps the start and angle when the length is typed", () => {
    const plan = addWall(emptyPlan(), { x: 0, y: 0 }, { x: 300, y: 400 }, 90, "w");
    const next = setWallLength(plan, "w", 1000);
    const wall = next.walls[0];
    expect(wall.a).toEqual({ x: 0, y: 0 });
    expect(distance(wall.a, wall.b)).toBeCloseTo(1000);
    expect(wall.b.x / wall.b.y).toBeCloseTo(300 / 400);
    const thicker = applyThickness(next, { kind: "wall", id: "w" }, 150);
    expect(thicker.walls[0].b).toEqual(wall.b);
    expect(thicker.walls[0].thickness).toBe(150);
  });
});

describe("sanitize and summary", () => {
  it("drops corrupt records and describes the plan in millimetres", () => {
    expect(sanitizePlan({ version: 2, units: "mm", walls: [], rooms: [] }).walls).toEqual([]);
    const plan = roomPlan();
    const clean = sanitizePlan(JSON.parse(JSON.stringify(plan)));
    expect(roomMetrics(clean, clean.rooms[0])!.width).toBe(3000);
    expect(planSummary(plan)).toContain("Room 1 interior 3000 by 2000 millimetres");
    expect(planSummary(emptyPlan())).toContain("Empty sketch");
    const junk = sanitizePlan({
      version: 1,
      units: "mm",
      walls: [{ id: "ok", a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, thickness: 90 }, { id: "bad" }],
      rooms: [{ id: "r", wallIds: ["missing", "ok", "ok", "ok"] }],
    });
    expect(junk.walls).toHaveLength(1);
    expect(junk.rooms).toHaveLength(0);
  });
});
