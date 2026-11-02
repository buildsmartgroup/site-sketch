import { describe, expect, it } from "vitest";
import { Editor, type PointerInput } from "../src/editor";
import { roomMetrics, wallLength } from "../src/plan";

function pointer(partial: Partial<PointerInput> & Pick<PointerInput, "pointerId" | "pointerType" | "x" | "y">): PointerInput {
  return { button: 0, ...partial };
}

function stroke(editor: Editor, input: PointerInput, x2: number, y2: number): void {
  editor.pointerDown(input);
  editor.pointerMove({ ...input, x: x2, y: y2 });
  editor.pointerUp({ ...input, x: x2, y: y2, button: 0 });
}

describe("editor input", () => {
  it("lets a pencil draw a room in millimetres and a finger only pan", () => {
    const editor = new Editor({ width: 1000, height: 800, pxPerMm: 1 });
    expect(editor.snapMm()).toBe(10);
    editor.setTool("room");
    // World (0,0) is the canvas centre. Drag to (800, 500).
    stroke(editor, pointer({ pointerId: 1, pointerType: "pen", x: 500, y: 400 }), 1300, -100);
    expect(editor.plan.rooms).toHaveLength(1);
    expect(roomMetrics(editor.plan, editor.plan.rooms[0])).toMatchObject({ width: 800, depth: 500, thickness: 90 });
    expect(editor.hudText()).toContain("800");

    const originX = editor.view.originX;
    const originY = editor.view.originY;
    const walls = editor.plan.walls.length;
    editor.pointerDown(pointer({ pointerId: 2, pointerType: "touch", x: 100, y: 100 }));
    editor.pointerMove(pointer({ pointerId: 2, pointerType: "touch", x: 160, y: 140 }));
    editor.pointerUp(pointer({ pointerId: 2, pointerType: "touch", x: 160, y: 140 }));
    expect(editor.plan.walls).toHaveLength(walls);
    expect(editor.view.originX).toBeCloseTo(originX - 60);
    expect(editor.view.originY).toBeCloseTo(originY + 40);
  });

  it("pans with one finger and zooms with two", () => {
    const editor = new Editor({ width: 1000, height: 800, pxPerMm: 1 });
    const originY = editor.view.originY;
    editor.pointerDown(pointer({ pointerId: 1, pointerType: "touch", x: 100, y: 100 }));
    editor.pointerMove(pointer({ pointerId: 1, pointerType: "touch", x: 100, y: 140 }));
    expect(editor.view.originY).toBeCloseTo(originY + 40);
    expect(editor.plan.walls).toHaveLength(0);

    editor.pointerDown(pointer({ pointerId: 2, pointerType: "touch", x: 100, y: 340 }));
    editor.pointerMove(pointer({ pointerId: 2, pointerType: "touch", x: 100, y: 540 }));
    expect(editor.view.pxPerMm).toBeGreaterThan(1.5);
    editor.pointerUp(pointer({ pointerId: 2, pointerType: "touch", x: 100, y: 540 }));
    editor.pointerUp(pointer({ pointerId: 1, pointerType: "touch", x: 100, y: 140 }));
  });

  it("ignores a finger while the pencil is down", () => {
    const editor = new Editor({ width: 1000, height: 800, pxPerMm: 1 });
    editor.setTool("wall");
    const start = pointer({ pointerId: 7, pointerType: "pen", x: 500, y: 400 });
    editor.pointerDown(start);
    const origin = editor.view.originX;
    editor.pointerDown(pointer({ pointerId: 8, pointerType: "touch", x: 20, y: 20 }));
    editor.pointerMove(pointer({ pointerId: 8, pointerType: "touch", x: 200, y: 20 }));
    expect(editor.view.originX).toBeCloseTo(origin);
    expect(editor.plan.walls).toHaveLength(0);
    editor.pointerUp(pointer({ pointerId: 8, pointerType: "touch", x: 200, y: 20 }));
    editor.pointerUp({ ...start, x: 900, y: 400 });
    expect(editor.plan.walls).toHaveLength(1);
    expect(wallLength(editor.plan.walls[0])).toBeCloseTo(400);
  });

  it("draws with the mouse, snaps a near-horizontal wall, and undoes it", () => {
    const editor = new Editor({ width: 1000, height: 800, pxPerMm: 1 });
    editor.setTool("wall");
    stroke(editor, pointer({ pointerId: 3, pointerType: "mouse", x: 500, y: 400 }), 900, 420);
    expect(wallLength(editor.plan.walls[0])).toBeCloseTo(400);
    expect(editor.plan.walls[0].a.y).toBeCloseTo(editor.plan.walls[0].b.y);
    editor.undo();
    expect(editor.plan.walls).toHaveLength(0);
    editor.redo();
    expect(editor.plan.walls).toHaveLength(1);
  });

  it("edits a typed dimension, moves on the grid, and restores with undo", () => {
    const editor = new Editor({ width: 1000, height: 800, pxPerMm: 1 });
    editor.setTool("room");
    stroke(editor, pointer({ pointerId: 1, pointerType: "pen", x: 500, y: 400 }), 1300, -100);
    const roomId = editor.plan.rooms[0].id;
    expect(editor.applyDimension({ kind: "room-width", roomId }, 1250)).toBe(true);
    expect(roomMetrics(editor.plan, editor.plan.rooms[0])!.width).toBe(1250);
    expect(editor.applyDimension({ kind: "room-depth", roomId }, 4)).toBe(false);

    editor.setTool("select");
    // Interior centre is (400, 250) → screen (900, 150). Drag by world (24, 6).
    const down = pointer({ pointerId: 4, pointerType: "pen", x: 900, y: 150 });
    editor.pointerDown(down);
    editor.pointerMove({ ...down, x: 924, y: 144 });
    editor.pointerUp({ ...down, x: 924, y: 144 });
    const moved = roomMetrics(editor.plan, editor.plan.rooms[0])!;
    expect(moved.x).toBeCloseTo(20);
    expect(moved.y).toBeCloseTo(10);
    expect(moved.width).toBeCloseTo(1250);

    editor.setThickness(110);
    const thick = roomMetrics(editor.plan, editor.plan.rooms[0])!;
    expect(thick.thickness).toBe(110);
    expect(thick.width).toBeCloseTo(1250);
    expect(thick.x).toBeCloseTo(20);

    editor.undo();
    expect(roomMetrics(editor.plan, editor.plan.rooms[0])!.thickness).toBe(90);
    editor.undo();
    expect(roomMetrics(editor.plan, editor.plan.rooms[0])!.x).toBeCloseTo(0);
  });

  it("does not draw when the middle mouse button pans", () => {
    const editor = new Editor({ width: 1000, height: 800, pxPerMm: 1 });
    editor.setTool("room");
    const origin = editor.view.originX;
    editor.pointerDown(pointer({ pointerId: 5, pointerType: "mouse", button: 1, x: 100, y: 100 }));
    editor.pointerMove(pointer({ pointerId: 5, pointerType: "mouse", button: 1, x: 180, y: 100 }));
    editor.pointerUp(pointer({ pointerId: 5, pointerType: "mouse", button: 1, x: 180, y: 100 }));
    expect(editor.plan.rooms).toHaveLength(0);
    expect(editor.view.originX).toBeCloseTo(origin - 80);
  });
});
