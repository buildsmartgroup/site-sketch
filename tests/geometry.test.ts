import { describe, expect, it } from "vitest";
import {
  defaultView,
  distance,
  niceScaleMm,
  parseMm,
  polygonArea,
  screenToWorld,
  snapPoint,
  snapScalar,
  snapStepForZoom,
  snapToEndpointOrGrid,
  snapWallEnd,
  snappedDelta,
  wallPolygon,
  worldToScreen,
  zoomView,
} from "../src/geometry";

describe("snap", () => {
  it("rounds half away from zero, including negatives", () => {
    expect(snapScalar(14, 10)).toBe(10);
    expect(snapScalar(15, 10)).toBe(20);
    expect(snapScalar(-14, 10)).toBe(-10);
    expect(snapScalar(-15, 10)).toBe(-20);
    expect(snapScalar(0, 10)).toBe(0);
    expect(snapPoint({ x: 14, y: -15 }, 10)).toEqual({ x: 10, y: -20 });
  });

  it("keeps a 10 mm snap while that step is still readable", () => {
    expect(snapStepForZoom(1)).toBe(10);
    expect(snapStepForZoom(0.8)).toBe(10);
    expect(snapStepForZoom(0.2)).toBeGreaterThan(10);
    expect(snapStepForZoom(0.2)).toBe(50);
  });
});

describe("millimetre parsing", () => {
  it("accepts grouped digits and a unit suffix", () => {
    expect(parseMm("1250")).toBe(1250);
    expect(parseMm("1 250 mm")).toBe(1250);
    expect(parseMm("1250.4")).toBe(1250);
    expect(parseMm("1250.5")).toBe(1251);
    expect(parseMm("")).toBeNull();
    expect(parseMm("-20")).toBeNull();
    expect(parseMm("2m")).toBeNull();
  });
});

describe("view", () => {
  it("puts world Y up on the screen", () => {
    const view = defaultView(1000, 800, 1);
    expect(worldToScreen({ x: 0, y: 0 }, view)).toEqual({ x: 500, y: 400 });
    const up = worldToScreen({ x: 0, y: 100 }, view);
    expect(up.y).toBeLessThan(400);
    expect(screenToWorld(up, view).y).toBeCloseTo(100);
  });

  it("zooms around a screen point without moving that world point", () => {
    const view = defaultView(1000, 800, 1);
    const screen = { x: 200, y: 100 };
    const before = screenToWorld(screen, view);
    const zoomed = zoomView(view, screen, 2);
    expect(zoomed.pxPerMm).toBe(2);
    const after = screenToWorld(screen, zoomed);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });
});

describe("wall snapping", () => {
  it("joins an existing endpoint ahead of angle or grid snap", () => {
    const end = snapWallEnd({
      start: { x: 0, y: 0 },
      raw: { x: 508, y: 6 },
      endpoints: [{ x: 500, y: 0 }, { x: 0, y: 0 }],
      grid: 10,
      pxPerMm: 1,
    });
    expect(end).toEqual({ x: 500, y: 0 });
  });

  it("locks near-axis and near-45° walls onto the grid", () => {
    const flat = snapWallEnd({
      start: { x: 0, y: 0 },
      raw: { x: 1000, y: 30 },
      endpoints: [],
      grid: 10,
      pxPerMm: 1,
    });
    expect(flat).toEqual({ x: 1000, y: 0 });

    const diagonal = snapWallEnd({
      start: { x: 0, y: 0 },
      raw: { x: 100, y: 80 },
      endpoints: [],
      grid: 10,
      pxPerMm: 1,
    });
    expect(diagonal).toEqual({ x: 90, y: 90 });
  });

  it("grid-snaps when the angle is not close to 0, 45, or 90", () => {
    const end = snapWallEnd({
      start: { x: 0, y: 0 },
      raw: { x: 1004, y: 406 },
      endpoints: [],
      grid: 10,
      pxPerMm: 1,
    });
    expect(end).toEqual({ x: 1000, y: 410 });
  });

  it("snaps a start point to an endpoint, otherwise the grid", () => {
    expect(snapToEndpointOrGrid({ x: 12, y: -4 }, [{ x: 0, y: 0 }], 10, 1)).toEqual({ x: 0, y: 0 });
    expect(snapToEndpointOrGrid({ x: 40, y: -4 }, [{ x: 0, y: 0 }], 10, 1)).toEqual({ x: 40, y: 0 });
    expect(snapToEndpointOrGrid({ x: 18, y: 6 }, [{ x: 0, y: 0 }], 10, 1, 8)).toEqual({ x: 20, y: 10 });
  });

  it("snaps a move so the anchor lands on the grid", () => {
    expect(snappedDelta({ x: 0, y: 0 }, { x: 24, y: 6 }, 10)).toEqual({ x: 20, y: 10 });
  });
});

describe("wall polygon", () => {
  it("has the requested thickness and length", () => {
    const polygon = wallPolygon({ a: { x: 0, y: 0 }, b: { x: 1000, y: 0 }, thickness: 90 });
    expect(polygonArea(polygon)).toBeCloseTo(1000 * 90);
    expect(distance(polygon[0], polygon[1])).toBeCloseTo(1000);
  });
});

describe("scale bar", () => {
  it("picks a round length near 120 px", () => {
    expect(niceScaleMm(1)).toBe(100);
    expect(niceScaleMm(0.2)).toBe(500);
  });
});
