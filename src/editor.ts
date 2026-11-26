import { nextCalloutNumber } from "./annotations";
import { makeFixture } from "./fixtures";
import {
  clampScale,
  defaultView,
  distance,
  panView,
  projectOnWall,
  rectFromPoints,
  screenToWorld,
  snapPoint,
  snapStepForZoom,
  snapToEndpointOrGrid,
  snapWallEnd,
  snappedDelta,
  zoomView,
} from "./geometry";
import { History } from "./history";
import { defaultOpeningSize, interiorSide, snapOpening, wallUnderPoint } from "./openings";
import { isVisible } from "./phase";
import {
  addCallout,
  addDim,
  addFixture,
  addNote,
  addOpening,
  addRoom,
  addWall,
  applyThickness,
  clonePlan,
  contentBounds,
  deleteSelection,
  endpointsOf,
  fixtureById,
  hitTestScene,
  markRemoval,
  moveFixtureTo,
  moveOpeningTo,
  nudgeItem,
  openingById,
  removalState,
  roomById,
  roomCenter,
  roomMetrics,
  planSummary,
  roomOfWall,
  rotateFixture,
  selectionAnchor,
  setMeta,
  setRoomInfo,
  setRoomInteriorSize,
  setWallLength,
  snapNewFixture,
  translateWalls,
  updateCallout,
  updateFixture,
  updateNote,
  updateOpening,
  wallById,
  wallIdsForSelection,
  wallLength,
} from "./plan";
import {
  emptyPlan,
  isThickness,
  type DimTarget,
  type FixtureKind,
  type OpeningKind,
  type Plan,
  type PlanMeta,
  type Point,
  type Selection,
  type Sheet,
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

export type Pending =
  | { kind: "callout"; anchor: Point; label: Point }
  | { kind: "text"; at: Point };

type Draft =
  | { kind: "room"; pointerId: number; pointerType: string; a: Point; b: Point }
  | { kind: "wall"; pointerId: number; pointerType: string; a: Point; b: Point }
  | { kind: "opening"; pointerId: number; pointerType: string; openingKind: OpeningKind; wallId: string; offset: number }
  | { kind: "fixture"; pointerId: number; pointerType: string; at: Point }
  | { kind: "dim"; pointerId: number; pointerType: string; a: Point; b: Point }
  | { kind: "callout"; pointerId: number; pointerType: string; anchor: Point; label: Point }
  | { kind: "text"; pointerId: number; pointerType: string; at: Point };

type MoveSession = {
  pointerId: number;
  startWorld: Point;
  origin: Plan;
  selection: Selection;
  ids: string[];
  anchor: Point;
  grabX: number;
  grabY: number;
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
  sheet: Sheet = "existing";
  fixtureKind: FixtureKind = "toilet";
  turningDiameter: 1540 | 2070 = 1540;
  spacePan = false;
  canvas = { width: 1000, height: 700 };
  pending: Pending | null = null;

  private history: History;
  private pointers = new Map<number, PointerInput>();
  private draft: Draft | null = null;
  private moving: MoveSession | null = null;
  private gesture: Gesture | null = null;
  private onCommit: (plan: Plan) => void;
  private onView: () => void;
  private onPending: (pending: Pending | null) => void;

  constructor(options: {
    plan?: Plan;
    width?: number;
    height?: number;
    pxPerMm?: number;
    onCommit?: (plan: Plan) => void;
    onView?: () => void;
    onPending?: (pending: Pending | null) => void;
  } = {}) {
    const width = options.width ?? 1000;
    const height = options.height ?? 700;
    this.canvas = { width, height };
    this.view = defaultView(width, height, options.pxPerMm ?? 1);
    this.history = new History(options.plan ?? emptyPlan());
    this.plan = this.history.current();
    this.onCommit = options.onCommit ?? (() => undefined);
    this.onView = options.onView ?? (() => undefined);
    this.onPending = options.onPending ?? (() => undefined);
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
    const draft = this.draft;
    if (draft?.kind === "room") {
      const rect = rectFromPoints(draft.a, draft.b);
      if (rect.width >= 10 && rect.depth >= 10) return `Room ${Math.round(rect.width)} × ${Math.round(rect.depth)} mm`;
      return "Room";
    }
    if (draft?.kind === "wall") {
      const length = Math.hypot(draft.b.x - draft.a.x, draft.b.y - draft.a.y);
      if (length >= 10) return `Wall ${Math.round(length)} mm`;
      return "Wall";
    }
    if (draft?.kind === "opening") return openingName(draft.openingKind);
    if (draft?.kind === "fixture") return fixtureLabel(this.fixtureKind);
    if (this.selection.kind === "room") {
      const room = roomById(this.plan, this.selection.id);
      const metrics = room && roomMetrics(this.plan, room);
      if (metrics && room) {
        const name = room.name || "Room";
        return `${name} ${Math.round(metrics.width)} × ${Math.round(metrics.depth)} mm · CH ${Math.round(room.ceiling)}`;
      }
    }
    if (this.selection.kind === "wall") {
      const wall = wallById(this.plan, this.selection.id);
      if (wall) {
        const state = wall.removal === "remove" ? " · remove" : wall.origin === "new" ? " · new" : "";
        return `Wall ${Math.round(wallLength(wall))} mm · ${Math.round(wall.thickness)} mm thick${state}`;
      }
    }
    if (this.selection.kind === "opening") {
      const opening = openingById(this.plan, this.selection.id);
      if (opening) return `${openingName(opening.kind)} ${Math.round(opening.width)} mm · head ${Math.round(opening.head)}`;
    }
    if (this.selection.kind === "fixture") {
      const fixture = fixtureById(this.plan, this.selection.id);
      if (fixture) return `${fixtureLabel(fixture.kind)} ${Math.round(fixture.width)} × ${Math.round(fixture.depth)} · ${Math.round(fixture.affl)} AFFL`;
    }
    if (this.selection.kind === "callout") return "Callout";
    if (this.selection.kind === "text") return "Text";
    if (this.selection.kind === "dim") return "Dimension";
    return "";
  }

  summary(): string {
    return planSummary(this.plan);
  }

  hasDraft(): boolean {
    return this.draft !== null && this.draft.kind !== "text";
  }

  displayPlan(): Plan {
    let plan = this.plan;
    const draft = this.draft;
    if (draft?.kind === "room") plan = addRoom(plan, rectFromPoints(draft.a, draft.b), this.thickness, PREVIEW_IDS, this.drawnOrigin());
    else if (draft?.kind === "wall") plan = addWall(plan, draft.a, draft.b, this.thickness, "preview-wall", this.drawnOrigin());
    else if (draft?.kind === "opening") plan = this.withPreviewOpening(plan, draft.wallId, draft.offset, draft.openingKind);
    else if (draft?.kind === "fixture") plan = this.withPreviewFixture(plan, draft.at);
    else if (draft?.kind === "dim" && distance(draft.a, draft.b) >= 10) {
      plan = clonePlan(plan);
      plan.dims.push({ id: "preview-dim", a: draft.a, b: draft.b, offset: 220, sheet: this.sheet });
    } else if (draft?.kind === "callout") {
      plan = clonePlan(plan);
      plan.callouts.push({ id: "preview-callout", number: this.nextNumber(), text: "", anchor: draft.anchor, label: this.leaderEnd(draft.anchor, draft.label), sheet: this.sheet });
    }
    if (this.pending?.kind === "callout") {
      plan = clonePlan(plan);
      plan.callouts.push({
        id: "preview-callout",
        number: this.nextNumber(),
        text: "",
        anchor: this.pending.anchor,
        label: this.pending.label,
        sheet: this.sheet,
      });
    }
    return plan;
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

  load(plan: Plan, view: View | null, sheet?: Sheet): void {
    this.cancelTransient(false);
    this.pending = null;
    this.history = new History(plan);
    this.plan = this.history.current();
    this.selection = { kind: "none" };
    this.tool = "room";
    this.sheet = sheet ?? "existing";
    if (view) this.setView(view);
    else if (contentBounds(this.plan)) this.frameContent();
    else this.view = defaultView(this.canvas.width, this.canvas.height, 1);
    this.onPending(null);
    this.onView();
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    this.cancelTransient(true);
    this.onView();
  }

  setSheet(sheet: Sheet): void {
    this.sheet = sheet;
    this.cancelTransient(false);
    if (!this.selectionVisible()) this.selection = { kind: "none" };
    this.onView();
  }

  choose(selection: Selection): void {
    this.selection = selection;
    this.syncThicknessFromSelection();
    this.onView();
  }

  setFixtureKind(kind: FixtureKind, diameter?: 1540 | 2070): void {
    this.fixtureKind = kind;
    if (diameter) this.turningDiameter = diameter;
    this.tool = "fixture";
    this.cancelTransient(true);
    this.onView();
  }

  setThickness(thickness: Thickness): void {
    this.thickness = thickness;
    if (this.selection.kind === "wall" || this.selection.kind === "room") {
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
    const bounds = contentBounds(this.plan, this.sheet) ?? contentBounds(this.plan);
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

  toggleRemoval(): void {
    const state = removalState(this.plan, this.selection);
    if (!state) return;
    this.commit(markRemoval(this.plan, this.selection, state === "remove" ? "keep" : "remove"));
  }

  patchOpening(id: string, patch: Parameters<typeof updateOpening>[2]): void {
    this.commit(updateOpening(this.plan, id, patch));
  }

  setCalloutText(id: string, text: string): void {
    this.commit(updateCallout(this.plan, id, text));
  }

  setNoteText(id: string, text: string): void {
    this.commit(updateNote(this.plan, id, text));
  }

  flipOpening(part: "hand" | "side"): void {
    if (this.selection.kind !== "opening") return;
    const opening = openingById(this.plan, this.selection.id);
    if (!opening || opening.kind === "window") return;
    if (part === "hand") this.commit(updateOpening(this.plan, opening.id, { hand: opening.hand === "start" ? "end" : "start" }));
    else this.commit(updateOpening(this.plan, opening.id, { side: opening.side === 1 ? -1 : 1 }));
  }

  rotateSelection(): void {
    if (this.selection.kind !== "fixture") return;
    this.commit(rotateFixture(this.plan, this.selection.id));
  }

  setRoomFields(roomId: string, info: { name?: string; ceiling?: number }): void {
    this.commit(setRoomInfo(this.plan, roomId, info));
  }

  setPlanMeta(meta: PlanMeta): void {
    this.commit(setMeta(this.plan, meta));
  }

  setFixtureFields(id: string, patch: Parameters<typeof updateFixture>[2]): void {
    this.commit(updateFixture(this.plan, id, patch));
  }

  applyDimension(target: DimTarget, mm: number): boolean {
    if (!Number.isFinite(mm)) return false;
    const value = Math.round(mm);
    if (target.kind === "opening") {
      if (value < 100 || value > 10000) return false;
      this.commit(updateOpening(this.plan, target.openingId, { width: value }));
      return true;
    }
    if (value < 10 || value > 1_000_000) return false;
    let next = this.plan;
    if (target.kind === "room-width" || target.kind === "room-depth") {
      const room = roomById(this.plan, target.roomId);
      const metrics = room && roomMetrics(this.plan, room);
      if (!metrics) return false;
      next = target.kind === "room-width"
        ? setRoomInteriorSize(this.plan, target.roomId, value, metrics.depth)
        : setRoomInteriorSize(this.plan, target.roomId, metrics.width, value);
    } else {
      next = setWallLength(this.plan, target.wallId, value);
    }
    this.commit(next);
    return true;
  }

  commitPending(text: string): void {
    const pending = this.pending;
    this.pending = null;
    this.onPending(null);
    if (!pending) return;
    if (pending.kind === "callout") {
      this.commit(addCallout(this.plan, {
        id: uid("callout"),
        number: this.nextNumber(),
        text,
        anchor: pending.anchor,
        label: pending.label,
        sheet: this.sheet,
      }));
      return;
    }
    this.commit(addNote(this.plan, { id: uid("text"), text, at: pending.at, sheet: this.sheet }));
  }

  cancelPending(): void {
    if (!this.pending) return;
    this.pending = null;
    this.onPending(null);
    this.onView();
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
    if (this.tool === "door" || this.tool === "cavity" || this.tool === "window") {
      const hit = wallUnderPoint(this.plan.walls.filter((wall) => isVisible(wall, this.sheet)), world, this.view.pxPerMm);
      if (!hit) return;
      this.draft = {
        kind: "opening",
        pointerId: input.pointerId,
        pointerType: input.pointerType,
        openingKind: this.tool === "door" ? "hinged" : this.tool === "cavity" ? "cavity" : "window",
        wallId: hit.wall.id,
        offset: hit.offset,
      };
      this.onView();
      return;
    }
    if (this.tool === "fixture") {
      this.draft = { kind: "fixture", pointerId: input.pointerId, pointerType: input.pointerType, at: world };
      this.onView();
      return;
    }
    if (this.tool === "dim" || this.tool === "callout" || this.tool === "text") {
      const point = snapPoint(world, this.snapMm());
      if (this.tool === "dim") this.draft = { kind: "dim", pointerId: input.pointerId, pointerType: input.pointerType, a: point, b: point };
      else if (this.tool === "callout") this.draft = { kind: "callout", pointerId: input.pointerId, pointerType: input.pointerType, anchor: point, label: point };
      else this.draft = { kind: "text", pointerId: input.pointerId, pointerType: input.pointerType, at: point };
      this.onView();
      return;
    }
    if (this.tool !== "room" && this.tool !== "wall") return;
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
    if (this.gesture?.mode === "pan" && this.gesture.pointerId === input.pointerId) this.gesture = null;
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

  highlightedWallIds(): Set<string> {
    const ids = new Set<string>();
    if (this.selection.kind === "room") {
      const room = roomById(this.plan, this.selection.id);
      room?.wallIds.forEach((id) => ids.add(id));
    } else if (this.selection.kind === "wall") ids.add(this.selection.id);
    return ids;
  }

  private updateDraft(input: PointerInput): void {
    const draft = this.draft;
    if (!draft) return;
    const world = screenToWorld({ x: input.x, y: input.y }, this.view);
    if (draft.kind === "room") {
      draft.b = snapToEndpointOrGrid(world, endpointsOf(this.plan), this.snapMm(), this.view.pxPerMm);
    } else if (draft.kind === "wall") {
      draft.b = snapWallEnd({
        start: draft.a,
        raw: world,
        endpoints: endpointsOf(this.plan),
        grid: this.snapMm(),
        pxPerMm: this.view.pxPerMm,
      });
    } else if (draft.kind === "opening") {
      const wall = wallById(this.plan, draft.wallId);
      if (wall) draft.offset = projectOnWall(wall, world);
    } else if (draft.kind === "fixture" || draft.kind === "text") {
      draft.at = world;
    } else if (draft.kind === "dim") {
      draft.b = snapPoint(world, this.snapMm());
    } else if (draft.kind === "callout") {
      draft.label = snapPoint(world, this.snapMm());
    }
  }

  private updateMove(input: PointerInput): void {
    if (!this.moving) return;
    const world = screenToWorld({ x: input.x, y: input.y }, this.view);
    const selection = this.moving.selection;
    if (selection.kind === "wall" || selection.kind === "room") {
      const delta = snappedDelta(this.moving.anchor, { x: world.x - this.moving.startWorld.x, y: world.y - this.moving.startWorld.y }, this.snapMm());
      this.plan = translateWalls(this.moving.origin, this.moving.ids, delta.x, delta.y);
      this.moving.moved = delta.x !== 0 || delta.y !== 0;
      return;
    }
    if (selection.kind === "opening") {
      const opening = openingById(this.moving.origin, selection.id);
      const wall = opening && wallById(this.moving.origin, opening.wallId);
      if (!opening || !wall) return;
      this.plan = moveOpeningTo(this.moving.origin, selection.id, projectOnWall(wall, world), this.snapMm());
      this.moving.moved = true;
      return;
    }
    if (selection.kind === "fixture") {
      const target = { x: world.x - this.moving.grabX, y: world.y - this.moving.grabY };
      const tol = Math.max(40, this.view.pxPerMm > 0 ? 28 / this.view.pxPerMm : 40);
      this.plan = moveFixtureTo(this.moving.origin, selection.id, target, this.snapMm(), tol, this.sheet);
      this.moving.moved = true;
      return;
    }
    if (selection.kind === "callout" || selection.kind === "text" || selection.kind === "dim") {
      const delta = snappedDelta(this.moving.anchor, { x: world.x - this.moving.startWorld.x, y: world.y - this.moving.startWorld.y }, this.snapMm());
      this.plan = nudgeItem(this.moving.origin, selection, delta.x, delta.y);
      this.moving.moved = delta.x !== 0 || delta.y !== 0;
    }
  }

  private commitDraft(): void {
    const draft = this.draft;
    this.draft = null;
    if (!draft) return;
    if (draft.kind === "room") {
      const rect = rectFromPoints(draft.a, draft.b);
      const ids = newIds();
      const next = addRoom(this.plan, rect, this.thickness, ids, this.drawnOrigin());
      if (next !== this.plan) {
        this.selection = { kind: "room", id: ids.room };
        this.syncThicknessFromSelection();
        this.commit(next);
        return;
      }
    } else if (draft.kind === "wall") {
      const id = uid("wall");
      const next = addWall(this.plan, draft.a, draft.b, this.thickness, id, this.drawnOrigin());
      if (next !== this.plan) {
        this.selection = { kind: "wall", id };
        this.commit(next);
        return;
      }
    } else if (draft.kind === "opening") {
      const wall = wallById(this.plan, draft.wallId);
      if (!wall) {
        this.onView();
        return;
      }
      const spec = defaultOpeningSize(draft.openingKind);
      const room = roomOfWall(this.plan, wall.id);
      const side = interiorSide(wall, room ? roomCenter(this.plan, room) : null);
      const id = uid("opening");
      const opening = snapOpening(wall, {
        id,
        wallId: wall.id,
        kind: draft.openingKind,
        offset: draft.offset,
        width: spec.width,
        pocket: spec.pocket,
        hand: "start",
        side,
        sill: spec.sill,
        head: spec.head,
        origin: this.drawnOrigin(),
        removal: "keep",
      }, this.snapMm());
      this.selection = { kind: "opening", id };
      this.commit(addOpening(this.plan, opening));
      return;
    } else if (draft.kind === "fixture") {
      const id = uid("fx");
      const seed = makeFixture(this.fixtureKind, {
        id,
        x: draft.at.x,
        y: draft.at.y,
        origin: this.drawnOrigin(),
        diameter: this.fixtureKind === "turning" ? this.turningDiameter : 0,
      });
      const tol = Math.max(40, this.view.pxPerMm > 0 ? 28 / this.view.pxPerMm : 40);
      const fixture = snapNewFixture(this.plan, seed, draft.at, this.snapMm(), tol, this.sheet);
      fixture.id = id;
      fixture.origin = this.drawnOrigin();
      this.selection = { kind: "fixture", id };
      this.commit(addFixture(this.plan, fixture));
      return;
    } else if (draft.kind === "dim") {
      const id = uid("dim");
      const next = addDim(this.plan, { id, a: draft.a, b: draft.b, offset: 220, sheet: this.sheet });
      if (next !== this.plan) {
        this.selection = { kind: "dim", id };
        this.commit(next);
        return;
      }
    } else if (draft.kind === "callout") {
      this.pending = { kind: "callout", anchor: draft.anchor, label: this.leaderEnd(draft.anchor, draft.label) };
      this.onPending(this.pending);
      this.onView();
      return;
    } else if (draft.kind === "text") {
      this.pending = { kind: "text", at: snapPoint(draft.at, this.snapMm()) };
      this.onPending(this.pending);
      this.onView();
      return;
    }
    this.onView();
  }

  private beginSelect(pointerId: number, world: Point): void {
    const selection = hitTestScene(this.plan, world, this.view.pxPerMm, this.sheet);
    this.selection = selection;
    this.syncThicknessFromSelection();
    const anchor = selectionAnchor(this.plan, selection);
    const ids = wallIdsForSelection(this.plan, selection);
    if (anchor && (ids.length > 0 || selection.kind === "opening" || selection.kind === "fixture" || selection.kind === "callout" || selection.kind === "text" || selection.kind === "dim")) {
      this.moving = {
        pointerId,
        startWorld: world,
        origin: clonePlan(this.plan),
        selection,
        ids,
        anchor,
        grabX: world.x - anchor.x,
        grabY: world.y - anchor.y,
        moved: false,
      };
    }
    this.onView();
  }

  private withPreviewOpening(plan: Plan, wallId: string, offset: number, kind: OpeningKind): Plan {
    const wall = wallById(plan, wallId);
    if (!wall) return plan;
    const spec = defaultOpeningSize(kind);
    const room = roomOfWall(plan, wallId);
    const opening = snapOpening(wall, {
      id: "preview-opening",
      wallId,
      kind,
      offset,
      width: spec.width,
      pocket: spec.pocket,
      hand: "start",
      side: interiorSide(wall, room ? roomCenter(plan, room) : null),
      sill: spec.sill,
      head: spec.head,
      origin: this.drawnOrigin(),
      removal: "keep",
    }, this.snapMm());
    const next = clonePlan(plan);
    next.openings.push(opening);
    return next;
  }

  private withPreviewFixture(plan: Plan, at: Point): Plan {
    const seed = makeFixture(this.fixtureKind, {
      id: "preview-fixture",
      x: at.x,
      y: at.y,
      origin: this.drawnOrigin(),
      diameter: this.fixtureKind === "turning" ? this.turningDiameter : 0,
    });
    const tol = Math.max(40, this.view.pxPerMm > 0 ? 28 / this.view.pxPerMm : 40);
    const fixture = snapNewFixture(plan, seed, at, this.snapMm(), tol, this.sheet);
    fixture.id = "preview-fixture";
    const next = clonePlan(plan);
    next.fixtures.push(fixture);
    return next;
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

  private selectionVisible(): boolean {
    const selection = this.selection;
    if (selection.kind === "none") return true;
    if (selection.kind === "wall") {
      const wall = wallById(this.plan, selection.id);
      return !!wall && isVisible(wall, this.sheet);
    }
    if (selection.kind === "room") {
      const room = roomById(this.plan, selection.id);
      return !!room && room.wallIds.some((id) => {
        const wall = wallById(this.plan, id);
        return !!wall && isVisible(wall, this.sheet);
      });
    }
    if (selection.kind === "opening") {
      const opening = openingById(this.plan, selection.id);
      const wall = opening && wallById(this.plan, opening.wallId);
      return !!opening && !!wall && isVisible(opening, this.sheet) && isVisible(wall, this.sheet);
    }
    if (selection.kind === "fixture") {
      const fixture = fixtureById(this.plan, selection.id);
      return !!fixture && isVisible(fixture, this.sheet);
    }
    if (selection.kind === "callout") return this.plan.callouts.some((callout) => callout.id === selection.id && callout.sheet === this.sheet);
    if (selection.kind === "text") return this.plan.notes.some((note) => note.id === selection.id && note.sheet === this.sheet);
    if (selection.kind === "dim") return this.plan.dims.some((dim) => dim.id === selection.id && dim.sheet === this.sheet);
    return true;
  }

  private commit(next: Plan): void {
    this.history.commit(next);
    this.plan = this.history.current();
    this.moving = null;
    this.draft = null;
    if (!this.selectionVisible()) this.selection = { kind: "none" };
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

  private drawnOrigin() {
    return this.sheet === "proposed" ? "new" as const : "existing" as const;
  }

  private nextNumber(): number {
    return nextCalloutNumber(this.plan.callouts.filter((callout) => callout.sheet === this.sheet).map((callout) => callout.number));
  }

  private leaderEnd(anchor: Point, label: Point): Point {
    if (distance(anchor, label) >= 40) return label;
    return { x: anchor.x + 480, y: anchor.y + 280 };
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
    this.gesture = { mode: "pinch", dist, midX: (first.x + second.x) / 2, midY: (first.y + second.y) / 2 };
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

function openingName(kind: OpeningKind): string {
  if (kind === "cavity") return "Cavity slider";
  if (kind === "window") return "Window";
  return "Door";
}

function fixtureLabel(kind: FixtureKind): string {
  if (kind === "grab-l") return "L grab";
  return kind.charAt(0).toUpperCase() + kind.slice(1);
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
