import { describe, expect, it } from "vitest";
import { CATALOG, fixturePolygon, makeFixture, snapFixture } from "../src/fixtures";
import { addRoom, roomCenter, wallById } from "../src/plan";
import { emptyPlan, type Fixture, type Point, type Wall } from "../src/types";

const ids = { room: "room", bottom: "bottom", right: "right", top: "top", left: "left" };

function placed(kind: Fixture["kind"], at: Point, walls: Wall[], rooms: { wallId: string; center: Point }[] = []) {
  return snapFixture(makeFixture(kind, { id: kind, x: 0, y: 0, origin: "new" }), at, walls, rooms, 10, 120);
}

function roomPlan() {
  const plan = addRoom(emptyPlan(), { x: 0, y: 0, width: 2400, depth: 2100 }, 90, ids, "new");
  const center = roomCenter(plan, plan.rooms[0])!;
  const rooms = plan.rooms[0].wallIds.map((wallId) => ({ wallId, center }));
  return { plan, rooms, center };
}

describe("grab rail", () => {
  it("defaults to a 600 mm toilet-side rail and keeps that size while it is moved", () => {
    expect(CATALOG.grab).toMatchObject({ width: 600, depth: 82, affl: 800 });
    const made = makeFixture("grab", { id: "g", x: 0, y: 0, origin: "new" });
    const wall: Wall = {
      id: "side",
      a: { x: 2400, y: 0 },
      b: { x: 2400, y: 2100 },
      thickness: 90,
      origin: "new",
      removal: "keep",
    };
    const first = snapFixture(made, { x: 2360, y: 700 }, [wall], [], 10, 120);
    const dragged = snapFixture(first, { x: 2350, y: 1100 }, [wall], [], 10, 120);
    expect(first.width).toBe(600);
    expect(dragged.width).toBe(600);
    expect(dragged.depth).toBe(82);
    expect(dragged.affl).toBe(800);
    expect(dragged.wallId).toBe("side");
    const along = fixturePolygon(dragged).map((point) => point.y);
    expect(Math.max(...along) - Math.min(...along)).toBeCloseTo(600);
  });
});

describe("niche", () => {
  it("sits inside the cavity and opens toward the room on every wall", () => {
    const { plan, rooms } = roomPlan();
    const walls = plan.walls;
    const clicks = [
      { id: "bottom", at: { x: 800, y: 40 }, room: 0, far: -90, axis: "y" as const },
      { id: "top", at: { x: 900, y: 2060 }, room: 2100, far: 2190, axis: "y" as const },
      { id: "left", at: { x: 40, y: 1000 }, room: 0, far: -90, axis: "x" as const },
      { id: "right", at: { x: 2360, y: 1200 }, room: 2400, far: 2490, axis: "x" as const },
    ];
    for (const click of clicks) {
      const niche = placed("niche", click.at, walls, rooms);
      expect(niche.wallId, click.id).toBe(click.id);
      expect(niche.depth, click.id).toBe(90);
      const span = fixturePolygon(niche).map((point) => point[click.axis]);
      expect(Math.min(...span), click.id).toBeCloseTo(Math.min(click.room, click.far));
      expect(Math.max(...span), click.id).toBeCloseTo(Math.max(click.room, click.far));
      const opening = niche[click.axis];
      expect(opening, click.id).toBeCloseTo(click.room);
    }
  });

  it("keeps the niche in the cavity of a proposed wall that is not part of a room", () => {
    const wall: Wall = {
      id: "free",
      a: { x: 1000, y: 0 },
      b: { x: 1000, y: 2000 },
      thickness: 110,
      origin: "new",
      removal: "keep",
    };
    const niche = placed("niche", { x: 960, y: 800 }, [wall]);
    expect(niche.depth).toBe(90);
    expect(niche.x).toBeCloseTo(1000 - 55);
    const xs = fixturePolygon(niche).map((point) => point.x);
    expect(Math.min(...xs)).toBeCloseTo(1000 - 55);
    expect(Math.max(...xs)).toBeCloseTo(1000 - 55 + 90);
  });

  it("does not let a deep niche come out of the far face", () => {
    const { plan, rooms } = roomPlan();
    const deep = makeFixture("niche", { id: "n", x: 0, y: 0, origin: "new", depth: 150 });
    const niche = snapFixture(deep, { x: 800, y: 40 }, plan.walls, rooms, 10, 120);
    expect(niche.depth).toBe(90);
    const ys = fixturePolygon(niche).map((point) => point.y);
    expect(Math.min(...ys)).toBeCloseTo(-90);
    expect(Math.max(...ys)).toBeCloseTo(0);
  });

  it("still projects a toilet, basin and grab into the room", () => {
    const { plan, rooms, center } = roomPlan();
    for (const kind of ["toilet", "basin", "grab", "mirror", "gpo"] as const) {
      const fixture = placed(kind, { x: 800, y: 40 }, plan.walls, rooms);
      const polygon = fixturePolygon(fixture);
      const mid = {
        x: polygon.reduce((sum, point) => sum + point.x, 0) / polygon.length,
        y: polygon.reduce((sum, point) => sum + point.y, 0) / polygon.length,
      };
      expect(mid.y, kind).toBeGreaterThan(0);
      expect(mid.y, kind).toBeLessThan(center.y + 400);
      expect(wallById(plan, fixture.wallId!)!.id).toBe("bottom");
    }
  });
});
