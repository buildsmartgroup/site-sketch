import { describe, expect, it } from "vitest";
import { formatArea } from "../src/annotations";
import { Editor, type PointerInput } from "../src/editor";
import { fixturePolygon, snapFixture } from "../src/fixtures";
import { openingFrame } from "../src/openings";
import { drawStyle, isVisible } from "../src/phase";
import {
  addOpening,
  addRoom,
  addWall,
  markRemoval,
  sanitizePlan,
  updateOpening,
  wallById,
} from "../src/plan";
import { chooseScale, scaleLabel } from "../src/scale";
import { emptyPlan, type Opening, type Wall } from "../src/types";

const roomIds = { room: "room-1", bottom: "bottom", right: "right", top: "top", left: "left" };

function pointer(partial: Partial<PointerInput> & Pick<PointerInput, "pointerId" | "pointerType" | "x" | "y">): PointerInput {
  return { button: 0, ...partial };
}

function stroke(editor: Editor, input: PointerInput, x2: number, y2: number): void {
  editor.pointerDown(input);
  editor.pointerMove({ ...input, x: x2, y: y2 });
  editor.pointerUp({ ...input, x: x2, y: y2, button: 0 });
}

function longWall(): Wall {
  return { id: "w", a: { x: 0, y: 0 }, b: { x: 3000, y: 0 }, thickness: 90, origin: "existing", removal: "keep" };
}

describe("phases", () => {
  it("shows removals in red on existing and hides them on proposed", () => {
    const kept = { origin: "existing" as const, removal: "keep" as const };
    const gone = { origin: "existing" as const, removal: "remove" as const };
    const fresh = { origin: "new" as const, removal: "keep" as const };
    expect(isVisible(kept, "existing")).toBe(true);
    expect(isVisible(kept, "proposed")).toBe(true);
    expect(isVisible(gone, "existing")).toBe(true);
    expect(isVisible(gone, "proposed")).toBe(false);
    expect(isVisible(fresh, "existing")).toBe(false);
    expect(isVisible(fresh, "proposed")).toBe(true);
    expect(drawStyle(gone, "existing")).toBe("remove");
    expect(drawStyle(fresh, "proposed")).toBe("new");
    expect(drawStyle(kept, "proposed")).toBe("existing");
  });

  it("marks a wall and its openings for removal", () => {
    const plan = addOpening(
      addRoom(emptyPlan(), { x: 0, y: 0, width: 2400, depth: 1800 }, 90, roomIds),
      {
        id: "door",
        wallId: "bottom",
        kind: "hinged",
        offset: 1200,
        width: 820,
        pocket: 0,
        hand: "start",
        side: 1,
        sill: 0,
        head: 2040,
        origin: "existing",
        removal: "keep",
      },
    );
    const removed = markRemoval(plan, { kind: "wall", id: "bottom" }, "remove");
    const wall = wallById(removed, "bottom")!;
    expect(wall.removal).toBe("remove");
    expect(removed.openings[0].removal).toBe("remove");
    expect(isVisible(wall, "proposed")).toBe(false);
    expect(isVisible(removed.openings[0], "existing")).toBe(true);
    const restored = markRemoval(removed, { kind: "wall", id: "bottom" }, "keep");
    expect(wallById(restored, "bottom")!.removal).toBe("keep");
    expect(restored.openings[0].removal).toBe("keep");
  });

  it("upgrades a version-1 plan without dropping geometry", () => {
    const plan = sanitizePlan({
      version: 1,
      units: "mm",
      walls: [{ id: "w", a: { x: 0, y: 0 }, b: { x: 1000, y: 0 }, thickness: 90 }],
      rooms: [],
    });
    expect(plan.version).toBe(2);
    expect(plan.walls[0]).toMatchObject({ origin: "existing", removal: "keep", thickness: 90 });
    expect(plan.openings).toEqual([]);
    expect(plan.fixtures).toEqual([]);
    expect(plan.meta.notes).toContain("RED = TO BE REMOVED");
    expect(sanitizePlan({ version: 9, units: "mm", walls: [], rooms: [] }).walls).toEqual([]);
  });
});

describe("openings", () => {
  it("swings a hinged door into the chosen side and sizes a cavity pocket", () => {
    const wall = longWall();
    const door: Opening = {
      id: "d",
      wallId: "w",
      kind: "hinged",
      offset: 1500,
      width: 820,
      pocket: 0,
      hand: "start",
      side: 1,
      sill: 0,
      head: 2040,
      origin: "existing",
      removal: "keep",
    };
    const frame = openingFrame(wall, door)!;
    expect(frame.hinge.x).toBeCloseTo(1500 - 410);
    expect(frame.hinge.y).toBeCloseTo(0);
    expect(frame.leafEnd.x).toBeCloseTo(frame.hinge.x);
    expect(frame.leafEnd.y).toBeCloseTo(820);

    const plan = updateOpening(addOpening(addWall(emptyPlan(), wall.a, wall.b, 90, "w"), { ...door, kind: "cavity", pocket: 760, wallId: "w" }), "d", { width: 920 });
    expect(plan.openings[0].width).toBe(920);
    expect(plan.openings[0].pocket).toBe(860);
    expect(plan.openings[0].head).toBe(2040);
  });
});

describe("fixtures", () => {
  it("snaps a toilet onto the room face of a wall at true size", () => {
    const wall = longWall();
    const snapped = snapFixture(
      {
        id: "wc",
        kind: "toilet",
        x: 0,
        y: 0,
        rotation: 0,
        width: 360,
        depth: 700,
        affl: 460,
        height: 0,
        diameter: 0,
        clearance: false,
        origin: "existing",
        removal: "keep",
        wallId: null,
        along: null,
        side: 1,
      },
      { x: 1500, y: 80 },
      [wall],
      [],
      10,
      80,
    );
    expect(snapped.wallId).toBe("w");
    expect(snapped.x).toBeCloseTo(1500);
    expect(snapped.y).toBeCloseTo(45);
    expect(snapped.rotation).toBe(0);
    expect(snapped.affl).toBe(460);
    const corners = fixturePolygon({ ...snapped, x: 0, y: 0, rotation: 0, wallId: null });
    expect(corners).toEqual([
      { x: -180, y: 0 },
      { x: 180, y: 0 },
      { x: 180, y: 700 },
      { x: -180, y: 700 },
    ]);
  });

  it("formats room area in square metres", () => {
    expect(formatArea(3000, 2000)).toBe("6.00 m²");
    expect(formatArea(2123, 2290)).toBe("4.86 m²");
  });
});

describe("sheet scale", () => {
  it("uses 1:30 until the plan no longer fits", () => {
    expect(chooseScale(3000, 2000, 300, 250)).toEqual({ ratio: 30, fit: false });
    expect(scaleLabel(chooseScale(10000, 8000, 300, 200))).toBe("1:50 FIT");
    expect(chooseScale(0, 0, 300, 200)).toEqual({ ratio: 30, fit: false });
  });
});

describe("editor phases", () => {
  it("places a door with the pencil, then new work only on the proposed sheet", () => {
    const editor = new Editor({ width: 1000, height: 800, pxPerMm: 1 });
    editor.setTool("room");
    stroke(editor, pointer({ pointerId: 1, pointerType: "pen", x: 200, y: 650 }), 900, 150);
    const roomId = editor.plan.rooms[0].id;
    editor.applyDimension({ kind: "room-width", roomId }, 2400);
    editor.applyDimension({ kind: "room-depth", roomId }, 1800);
    const bottom = editor.plan.walls.find((wall) => wall.id === editor.plan.rooms[0].wallIds[0])!;
    const mid = { x: (bottom.a.x + bottom.b.x) / 2, y: (bottom.a.y + bottom.b.y) / 2 };
    const screen = {
      x: (mid.x - editor.view.originX) * editor.view.pxPerMm,
      y: (editor.view.originY - mid.y) * editor.view.pxPerMm,
    };
    editor.setTool("door");
    stroke(editor, pointer({ pointerId: 2, pointerType: "pen", x: screen.x, y: screen.y }), screen.x + 4, screen.y);
    expect(editor.plan.openings).toHaveLength(1);
    expect(editor.plan.openings[0]).toMatchObject({ kind: "hinged", width: 820, origin: "existing", head: 2040 });

    editor.pointerDown(pointer({ pointerId: 9, pointerType: "touch", x: screen.x, y: screen.y }));
    editor.pointerUp(pointer({ pointerId: 9, pointerType: "touch", x: screen.x + 30, y: screen.y }));
    expect(editor.plan.openings).toHaveLength(1);

    editor.setTool("select");
    editor.pointerDown(pointer({ pointerId: 3, pointerType: "pen", x: screen.x, y: screen.y }));
    editor.pointerUp(pointer({ pointerId: 3, pointerType: "pen", x: screen.x, y: screen.y }));
    expect(editor.selection.kind).toBe("opening");
    editor.toggleRemoval();
    expect(editor.plan.openings[0].removal).toBe("remove");
    expect(isVisible(editor.plan.openings[0], "proposed")).toBe(false);

    editor.setSheet("proposed");
    editor.setFixtureKind("shower");
    stroke(editor, pointer({ pointerId: 4, pointerType: "pen", x: 500, y: 400 }), 540, 430);
    expect(editor.plan.fixtures).toHaveLength(1);
    expect(editor.plan.fixtures[0]).toMatchObject({ kind: "shower", origin: "new", width: 1200, depth: 1200, affl: 0 });
    expect(isVisible(editor.plan.fixtures[0], "existing")).toBe(false);
    expect(isVisible(editor.plan.fixtures[0], "proposed")).toBe(true);
  });
});
