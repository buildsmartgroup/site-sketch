import {
  clampScale,
  defaultView,
  panView,
  rectFromPoints,
  screenToWorld,
  snapStepForZoom,
  snapToEndpointOrGrid,
  snapWallEnd,
  snappedDelta,
  zoomView,
} from "./geometry";
import { History } from "./history";
import {
  addRoom,
  addWall,
  applyThickness,
  clonePlan,
  contentBounds,
  deleteSelection,
  endpointsOf,
  hitTest,
  planSummary,
  roomById,
  roomMetrics,
  roomOfWall,
  selectionAnchor,
  setRoomInteriorSize,
  setWallLength,
  translateWalls,
  wallById,
  wallIdsForSelection,
  wallLength,
} from "./plan";
import {
  emptyPlan,
  isThickness,
  type DimTarget,
  type Plan,
  type Point,
  type Selection,
  type Thickness,
  type Tool,
  type View,
} from "./types";

export type PointerInput = {
  pointerId: number;
  pointerType: string;
  button: number;
  x: number;
  y: number;
  altKey?: boolean;
};

type Draft =
  | { kind: "room"; pointerId: number; pointerType: string; a: Point; b: Point }
  | { kind: "wall"; pointerId: number; pointerType: string; a: Point; b: Point };

type MoveSession = {
  pointerId: number;
  startWorld: Point;
  origin: Plan;
  ids: string[];
  anchor: Point;
  moved: boolean;
};

type Gesture =
  | { mode: "pan"; lastX: number; lastY: number; pointerId?: number }
  | { mode: "pinch"; dist: number; midX: number; midY: number };

const PREVIEW_IDS = {
  room: "preview-room",
  bottom: "preview-bottom",
  right: "preview-right",
  top: "preview-top",
  left: "preview-left",
};

export class Editor {
  plan: Plan;
  view: View;
  tool: Tool = "room";
  thickness: Thickness = 90;
  selection: Selection = { kind: "none" };
  spacePan = false;
  canvas = { width: 1000, height: 700 };

  private history: History;
  private pointers = new Map<number, PointerInput>();
  private draft: Draft | null = null;
  private moving: MoveSession | null = null;
  private gesture: Gesture | null = null;
  private onCommit: (plan: Plan) => void;
  private onView: () => void;

  constructor(options: {
    plan?: Plan;
    width?: number;
    height?: number;
    pxPerMm?: number;
    onCommit?: (plan: Plan) => void;
    onView?: () => void;
  } = {}) {
    const width = options.width ?? 1000;
    const height = options.height ?? 700;
    this.canvas = { width, height };
    this.view = defaultView(width, height, options.pxPerMm ?? 1);
    this.history = new History(options.plan ?? emptyPlan());
    this.plan = this.history.current();
    this.onCommit = options.onCommit ?? (() => undefined);
    this.onView = options.onView ?? (() => undefined);
  }

  snapMm(): number {
    return snapStepForZoom(this.view.pxPerMm);
  }

  canUndo(): boolean {
    return this.history.canUndo();
  }

  canRedo(): boolean {
    return this.history.canRedo();
  }

  hudText(): string {
    const draft = this.draftRect();
    if (draft?.kind === "room") {
      const rect = rectFromPoints(draft.a, draft.b);
      if (rect.width >= 10 && rect.depth >= 10) {
        return `Room ${Math.round(rect.width)} × ${Math.round(rect.depth)} mm`;
      }
      return "Room";
    }
    if (draft?.kind === "wall") {
      const length = Math.hypot(draft.b.x - draft.a.x, draft.b.y - draft.a.y);
      if (length >= 10) return `Wall ${Math.round(length)} mm`;
      return "Wall";
    }
    if (this.selection.kind === "room") {
      const room = roomById(this.plan, this.selection.id);
      const metrics = room && roomMetrics(this.plan, room);
      if (metrics) {
        return `Interior ${Math.round(metrics.width)} × ${Math.round(metrics.depth)} mm · ${Math.round(metrics.thickness)} mm wall`;
      }
    }
    if (this.selection.kind === "wall") {
      const wall = wallById(this.plan, this.selection.id);
      if (wall) return `Wall ${Math.round(wallLength(wall))} mm · ${Math.round(wall.thickness)} mm thick`;
    }
    return "";
  }

  summary(): string {
    return planSummary(this.plan);
  }

  hasDraft(): boolean {
    return this.draft !== null;
  }

  displayPlan(): Plan {
    if (!this.draft) return this.plan;
    if (this.draft.kind === "room") {
      return addRoom(this.plan, rectFromPoints(this.draft.a, this.draft.b), this.thickness, PREVIEW_IDS);
    }
    return addWall(this.plan, this.draft.a, this.draft.b, this.thickness, "preview-wall");
  }

  setCanvasSize(width: number, height: number): void {
    if (!(width > 0) || !(height > 0)) return;
    const cx = this.view.originX + this.canvas.width / 2 / this.view.pxPerMm;
    const cy = this.view.originY - this.canvas.height / 2 / this.view.pxPerMm;
    this.canvas = { width, height };
    this.view = {
      ...this.view,
      originX: cx - width / 2 / this.view.pxPerMm,
      originY: cy + height / 2 / this.view.pxPerMm,
    };
  }

  setView(view: View): void {
    if (!(view.pxPerMm > 0) || !Number.isFinite(view.originX) || !Number.isFinite(view.originY)) return;
    this.view = { originX: view.originX, originY: view.originY, pxPerMm: clampScale(view.pxPerMm) };
  }

  load(plan: Plan, view: View | null): void {
    this.cancelTransient(false);
    this.history = new History(plan);
    this.plan = this.history.current();
    this.selection = { kind: "none" };
    this.tool = "room";
    if (view) this.setView(view);
    else if (this.plan.walls.length > 0) this.frameContent();
    else this.view = defaultView(this.canvas.width, this.canvas.height, 1);
    this.onView();
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    this.cancelTransient(true);
    this.onView();
  }

  setThickness(thickness: Thickness): void {
    this.thickness = thickness;
    if (this.selection.kind !== "none") {
      this.commit(applyThickness(this.plan, this.selection, thickness));
      return;
    }
    this.onView();
  }

  zoomBy(factor: number): void {
    this.zoomAt(this.canvas.width / 2, this.canvas.height / 2, factor);
  }

  zoomAt(x: number, y: number, factor: number): void {
    this.view = zoomView(this.view, { x, y }, this.view.pxPerMm * factor);
    this.onView();
  }

  frameContent(): void {
    const bounds = contentBounds(this.plan);
    if (!bounds) {
      this.view = defaultView(this.canvas.width, this.canvas.height, 1);
      this.onView();
      return;
    }
    const pad = 72;
    const availW = Math.max(80, this.canvas.width - pad * 2);
    const availH = Math.max(80, this.canvas.height - pad * 2);
    const px = clampScale(Math.min(availW / bounds.width, availH / bounds.depth));
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.depth / 2;
    this.view = {
      pxPerMm: px,
      originX: cx - this.canvas.width / 2 / px,
      originY: cy + this.canvas.height / 2 / px,
    };
    this.onView();
  }

  undo(): void {
    this.cancelTransient(false);
    this.plan = this.history.undo();
    this.selection = { kind: "none" };
    this.onCommit(this.plan);
    this.onView();
  }

  redo(): void {
    this.cancelTransient(false);
    this.plan = this.history.redo();
    this.selection = { kind: "none" };
    this.onCommit(this.plan);
    this.onView();
  }

  deleteSelection(): void {
    if (this.selection.kind === "none") return;
    const next = deleteSelection(this.plan, this.selection);
    this.selection = { kind: "none" };
    this.commit(next);
  }

  applyDimension(target: DimTarget, mm: number): boolean {
    if (!Number.isFinite(mm) || mm < 10 || mm > 1_000_000) return false;
    const value = Math.round(mm);
    let next = this.plan;
    if (target.kind === "room-width" || target.kind === "room-depth") {
      const room = roomById(this.plan, target.roomId);
      const metrics = room && roomMetrics(this.plan, room);
      if (!metrics) return false;
      next =
        target.kind === "room-width"
          ? setRoomInteriorSize(this.plan, target.roomId, value, metrics.depth)
          : setRoomInteriorSize(this.plan, target.roomId, metrics.width, value);
    } else {
      next = setWallLength(this.plan, target.wallId, value);
    }
    this.commit(next);
    return true;
  }

  wheel(x: number, y: number, deltaY: number): void {
    const factor = Math.exp(-deltaY * 0.0012);
    this.zoomAt(x, y, factor);
  }

  pointerDown(input: PointerInput): void {
    this.pointers.set(input.pointerId, input);
    if (input.pointerType === "touch") {
      if (this.penIsActive() || this.draft?.pointerType === "pen") return;
      const touches = this.touches();
      if (touches.length >= 2) this.beginPinch(touches);
      else this.gesture = { mode: "pan", lastX: input.x, lastY: input.y };
      return;
    }

    if (this.isMousePan(input)) {
      this.gesture = { mode: "pan", lastX: input.x, lastY: input.y, pointerId: input.pointerId };
      return;
    }
    if (input.button !== 0) return;
    if (this.draft) return;

    const world = screenToWorld({ x: input.x, y: input.y }, this.view);
    if (this.tool === "select") {
      this.beginSelect(input.pointerId, world);
      return;
    }
    const start = snapToEndpointOrGrid(world, endpointsOf(this.plan), this.snapMm(), this.view.pxPerMm);
    this.draft = {
      kind: this.tool,
      pointerId: input.pointerId,
      pointerType: input.pointerType,
      a: start,
      b: start,
    };
    this.onView();
  }

  pointerMove(input: PointerInput): void {
    if (!this.pointers.has(input.pointerId)) return;
    this.pointers.set(input.pointerId, input);
    if (input.pointerType === "touch") {
      if (this.penIsActive() || this.draft?.pointerType === "pen") return;
      const touches = this.touches();
      if (touches.length >= 2) {
        this.updatePinch(touches);
        this.onView();
        return;
      }
      if (this.gesture?.mode === "pan") {
        this.view = panView(this.view, input.x - this.gesture.lastX, input.y - this.gesture.lastY);
        this.gesture.lastX = input.x;
        this.gesture.lastY = input.y;
        this.onView();
      }
      return;
    }

    if (this.gesture?.mode === "pan" && this.gesture.pointerId === input.pointerId) {
      this.view = panView(this.view, input.x - this.gesture.lastX, input.y - this.gesture.lastY);
      this.gesture.lastX = input.x;
      this.gesture.lastY = input.y;
      this.onView();
      return;
    }

    if (this.draft?.pointerId === input.pointerId) {
      this.updateDraft(input);
      this.onView();
      return;
    }
    if (this.moving?.pointerId === input.pointerId) {
      this.updateMove(input);
      this.onView();
    }
  }

  pointerUp(input: PointerInput): void {
    this.pointers.delete(input.pointerId);
    if (input.pointerType === "touch") {
      if (this.penIsActive() || this.draft?.pointerType === "pen") return;
      this.resettleTouches();
      this.onView();
      return;
    }
    if (this.gesture?.mode === "pan" && this.gesture.pointerId === input.pointerId) {
      this.gesture = null;
    }
    if (this.draft && this.draft.pointerId === input.pointerId) {
      this.updateDraft(input);
      this.commitDraft();
      return;
    }
    if (this.moving && this.moving.pointerId === input.pointerId) {
      this.updateMove(input);
      const moved = this.moving.moved;
      const next = this.plan;
      this.moving = null;
      if (moved) this.commit(next);
      else this.onView();
    }
  }

  private updateDraft(input: PointerInput): void {
    if (!this.draft) return;
    const world = screenToWorld({ x: input.x, y: input.y }, this.view);
    if (this.draft.kind === "room") {
      this.draft.b = snapToEndpointOrGrid(world, endpointsOf(this.plan), this.snapMm(), this.view.pxPerMm);
    } else {
      this.draft.b = snapWallEnd({
        start: this.draft.a,
        raw: world,
        endpoints: endpointsOf(this.plan),
        grid: this.snapMm(),
        pxPerMm: this.view.pxPerMm,
      });
    }
  }

  private updateMove(input: PointerInput): void {
    if (!this.moving) return;
    const world = screenToWorld({ x: input.x, y: input.y }, this.view);
    const raw = {
      x: world.x - this.moving.startWorld.x,
      y: world.y - this.moving.startWorld.y,
    };
    const delta = snappedDelta(this.moving.anchor, raw, this.snapMm());
    this.plan = translateWalls(this.moving.origin, this.moving.ids, delta.x, delta.y);
    this.moving.moved = delta.x !== 0 || delta.y !== 0;
  }

  highlightedWallIds(): Set<string> {
    const ids = new Set<string>();
    if (this.selection.kind === "room") {
      const room = roomById(this.plan, this.selection.id);
      room?.wallIds.forEach((id) => ids.add(id));
    } else if (this.selection.kind === "wall") {
      ids.add(this.selection.id);
    }
    return ids;
  }

  private draftRect(): Draft | null {
    return this.draft;
  }

  private commitDraft(): void {
    const draft = this.draft;
    this.draft = null;
    if (!draft) return;
    if (draft.kind === "room") {
      const rect = rectFromPoints(draft.a, draft.b);
      const ids = newIds();
      const next = addRoom(this.plan, rect, this.thickness, ids);
      if (next !== this.plan) {
        this.selection = { kind: "room", id: ids.room };
        this.syncThicknessFromSelection();
        this.commit(next);
        return;
      }
    } else {
      const id = uid("wall");
      const next = addWall(this.plan, draft.a, draft.b, this.thickness, id);
      if (next !== this.plan) {
        this.selection = { kind: "wall", id };
        this.commit(next);
        return;
      }
    }
    this.onView();
  }

  private beginSelect(pointerId: number, world: Point): void {
    let selection = hitTest(this.plan, world, this.view.pxPerMm);
    if (selection.kind === "wall" && roomOfWall(this.plan, selection.id)) {
      const room = roomOfWall(this.plan, selection.id)!;
      selection = { kind: "room", id: room.id };
    }
    this.selection = selection;
    this.syncThicknessFromSelection();
    const anchor = selectionAnchor(this.plan, selection);
    const ids = wallIdsForSelection(this.plan, selection);
    if (anchor && ids.length > 0) {
      this.moving = {
        pointerId,
        startWorld: world,
        origin: clonePlan(this.plan),
        ids,
        anchor,
        moved: false,
      };
    }
    this.onView();
  }

  private syncThicknessFromSelection(): void {
    if (this.selection.kind === "room") {
      const room = roomById(this.plan, this.selection.id);
      const metrics = room && roomMetrics(this.plan, room);
      if (metrics && isThickness(metrics.thickness)) this.thickness = metrics.thickness;
    } else if (this.selection.kind === "wall") {
      const wall = wallById(this.plan, this.selection.id);
      if (wall && isThickness(wall.thickness)) this.thickness = wall.thickness;
    }
  }

  private commit(next: Plan): void {
    this.history.commit(next);
    this.plan = this.history.current();
    this.moving = null;
    this.draft = null;
    this.onCommit(this.plan);
    this.onView();
  }

  private cancelTransient(notify: boolean): void {
    this.draft = null;
    this.moving = null;
    this.gesture = null;
    this.plan = this.history.current();
    if (notify) this.onView();
  }

  private isMousePan(input: PointerInput): boolean {
    if (input.pointerType !== "mouse") return false;
    return input.button === 1 || input.button === 2 || !!input.altKey || this.spacePan;
  }

  private penIsActive(): boolean {
    for (const pointer of this.pointers.values()) {
      if (pointer.pointerType === "pen") return true;
    }
    return false;
  }

  private touches(): PointerInput[] {
    return [...this.pointers.values()].filter((pointer) => pointer.pointerType === "touch");
  }

  private beginPinch(touches: PointerInput[]): void {
    const [first, second] = touches;
    const dist = Math.hypot(second.x - first.x, second.y - first.y) || 1;
    this.gesture = {
      mode: "pinch",
      dist,
      midX: (first.x + second.x) / 2,
      midY: (first.y + second.y) / 2,
    };
  }

  private updatePinch(touches: PointerInput[]): void {
    if (this.gesture?.mode !== "pinch") {
      this.beginPinch(touches);
      return;
    }
    const [first, second] = touches;
    const dist = Math.hypot(second.x - first.x, second.y - first.y) || 1;
    const midX = (first.x + second.x) / 2;
    const midY = (first.y + second.y) / 2;
    this.view = panView(this.view, midX - this.gesture.midX, midY - this.gesture.midY);
    const factor = dist / this.gesture.dist;
    this.view = zoomView(this.view, { x: midX, y: midY }, this.view.pxPerMm * factor);
    this.gesture = { mode: "pinch", dist, midX, midY };
  }

  private resettleTouches(): void {
    const touches = this.touches();
    if (touches.length >= 2) this.beginPinch(touches);
    else if (touches.length === 1) this.gesture = { mode: "pan", lastX: touches[0].x, lastY: touches[0].y };
    else this.gesture = null;
  }
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function newIds() {
  return {
    room: uid("room"),
    bottom: uid("wall"),
    right: uid("wall"),
    top: uid("wall"),
    left: uid("wall"),
  };
}
