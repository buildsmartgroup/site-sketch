import { manualDimGeometry } from "./annotations";
import { CATALOG, clearancePolygon, fixturePolygon } from "./fixtures";
import { gridSteps, worldToScreen } from "./geometry";
import { calloutCircles, screenLabels } from "./labels";
import { layoutDimensions, type DimGraphic } from "./dimensions";
import {
  cavityChevron,
  doorSlab,
  gapPolygon,
  openingFrame,
  pocketPolygon,
  swingArc,
  windowPanes,
} from "./openings";
import { drawStyle, isVisible } from "./phase";
import { roomMetrics, wallById, wallDrawPolygon } from "./plan";
import { drawFixtureSymbol } from "./symbols";
import type { Opening, Plan, Point, Sheet, View, Wall } from "./types";

const PAPER = "#f3f0e8";
const MINOR = "#e3ddd0";
const MAJOR = "#d2cbbd";
const AXIS = "rgba(30, 53, 84, 0.45)";
const INK = "#1a1a1a";
const REMOVE = "#C0192B";
const NEW_STROKE = "#3E8EDE";
const NEW_FILL = "#e7f3fc";
const INTERIOR = "rgba(255, 253, 248, 0.72)";
const SELECT = "#3e7a45";
const DIM = "#1a1a1a";

export type PaintOptions = {
  sheet?: Sheet;
  grid?: boolean;
  background?: boolean;
  labels?: boolean;
  paper?: string;
  highlightedWalls?: ReadonlySet<string>;
  selectedId?: string | null;
};

export function paint(
  ctx: CanvasRenderingContext2D,
  plan: Plan,
  view: View,
  width: number,
  height: number,
  options: PaintOptions = {},
): void {
  const sheet = options.sheet ?? "existing";
  const paper = options.paper ?? PAPER;
  const highlighted = options.highlightedWalls ?? new Set<string>();
  if (options.background !== false) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, width, height);
    if (options.grid !== false) drawGrid(ctx, view, width, height);
  }
  drawRooms(ctx, plan, view, sheet);
  drawWalls(ctx, plan, view, sheet, highlighted);
  punchOpenings(ctx, plan, view, sheet, paper);
  drawOpenings(ctx, plan, view, sheet, options.selectedId ?? null);
  drawFixtures(ctx, plan, view, sheet, options.selectedId ?? null);
  drawDimensions(ctx, layoutDimensions(plan, view, sheet).graphics);
  drawManualDimensions(ctx, plan, view, sheet);
  drawCallouts(ctx, plan, view, sheet);
  if (options.labels) drawLabelText(ctx, plan, view, sheet);
}

function drawGrid(ctx: CanvasRenderingContext2D, view: View, width: number, height: number): void {
  const { minor, major } = gridSteps(view.pxPerMm);
  const worldLeft = view.originX;
  const worldRight = view.originX + width / view.pxPerMm;
  const worldTop = view.originY;
  const worldBottom = view.originY - height / view.pxPerMm;
  strokeWorldLines(ctx, view, worldLeft, worldRight, worldTop, worldBottom, minor, MINOR, width, height);
  strokeWorldLines(ctx, view, worldLeft, worldRight, worldTop, worldBottom, major, MAJOR, width, height);
  ctx.beginPath();
  ctx.strokeStyle = AXIS;
  ctx.lineWidth = 1;
  if (worldLeft <= 0 && worldRight >= 0) vline(ctx, worldToScreen({ x: 0, y: 0 }, view).x, height);
  if (worldBottom <= 0 && worldTop >= 0) hline(ctx, worldToScreen({ x: 0, y: 0 }, view).y, width);
  ctx.stroke();
}

function strokeWorldLines(
  ctx: CanvasRenderingContext2D,
  view: View,
  worldLeft: number,
  worldRight: number,
  worldTop: number,
  worldBottom: number,
  step: number,
  color: string,
  width: number,
  height: number,
): void {
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  eachStep(worldLeft, worldRight, step, (x) => vline(ctx, worldToScreen({ x, y: 0 }, view).x, height));
  eachStep(worldBottom, worldTop, step, (y) => hline(ctx, worldToScreen({ x: 0, y }, view).y, width));
  ctx.stroke();
}

function eachStep(min: number, max: number, step: number, draw: (value: number) => void): void {
  if (!(step > 0) || !(max >= min)) return;
  const start = Math.ceil((min - 1e-6) / step) * step;
  let guard = 0;
  for (let value = start; value <= max + 1e-6; value += step) {
    draw(value);
    if (++guard > 800) break;
  }
}

function vline(ctx: CanvasRenderingContext2D, x: number, height: number): void {
  const sx = Math.round(x) + 0.5;
  ctx.moveTo(sx, 0);
  ctx.lineTo(sx, height);
}

function hline(ctx: CanvasRenderingContext2D, y: number, width: number): void {
  const sy = Math.round(y) + 0.5;
  ctx.moveTo(0, sy);
  ctx.lineTo(width, sy);
}

function drawRooms(ctx: CanvasRenderingContext2D, plan: Plan, view: View, sheet: Sheet): void {
  ctx.fillStyle = INTERIOR;
  for (const room of plan.rooms) {
    if (!room.wallIds.some((id) => {
      const wall = wallById(plan, id);
      return !!wall && isVisible(wall, sheet);
    })) continue;
    const metrics = roomMetrics(plan, room);
    if (!metrics) continue;
    const topLeft = worldToScreen({ x: metrics.x, y: metrics.y + metrics.depth }, view);
    const bottomRight = worldToScreen({ x: metrics.x + metrics.width, y: metrics.y }, view);
    ctx.fillRect(
      Math.min(topLeft.x, bottomRight.x),
      Math.min(topLeft.y, bottomRight.y),
      Math.abs(bottomRight.x - topLeft.x),
      Math.abs(bottomRight.y - topLeft.y),
    );
  }
}

function drawWalls(
  ctx: CanvasRenderingContext2D,
  plan: Plan,
  view: View,
  sheet: Sheet,
  highlighted: ReadonlySet<string>,
): void {
  for (const wall of plan.walls) {
    const style = drawStyle(wall, sheet);
    if (!style) continue;
    const polygon = wallDrawPolygon(plan, wall);
    if (polygon.length < 3) continue;
    trace(ctx, polygon, view, true);
    ctx.fillStyle = style === "remove" ? REMOVE : style === "new" ? NEW_FILL : INK;
    ctx.fill();
    if (style === "new") hatch(ctx, polygon, view);
    if (style === "new") {
      trace(ctx, polygon, view, true);
      ctx.strokeStyle = NEW_STROKE;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
  }
  ctx.strokeStyle = SELECT;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  for (const wall of plan.walls) {
    if (!highlighted.has(wall.id) || !isVisible(wall, sheet)) continue;
    const polygon = wallDrawPolygon(plan, wall);
    if (polygon.length < 3) continue;
    trace(ctx, polygon, view, true);
    ctx.stroke();
  }
}

function hatch(ctx: CanvasRenderingContext2D, polygon: Point[], view: View): void {
  const screen = polygon.map((point) => worldToScreen(point, view));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of screen) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  ctx.save();
  trace(ctx, polygon, view, true);
  ctx.clip();
  ctx.beginPath();
  ctx.strokeStyle = NEW_STROKE;
  ctx.lineWidth = 1;
  const gap = 7;
  const rise = maxY - minY;
  for (let x = minX - rise; x < maxX + rise; x += gap) {
    ctx.moveTo(x, minY);
    ctx.lineTo(x + rise, maxY);
  }
  ctx.stroke();
  ctx.restore();
}

function punchOpenings(ctx: CanvasRenderingContext2D, plan: Plan, view: View, sheet: Sheet, paper: string): void {
  ctx.fillStyle = paper;
  for (const opening of plan.openings) {
    const wall = hostWall(plan, opening, sheet);
    if (!wall) continue;
    const gap = gapPolygon(wall, opening);
    if (gap.length < 3) continue;
    trace(ctx, gap, view, true);
    ctx.fill();
  }
}

function drawOpenings(
  ctx: CanvasRenderingContext2D,
  plan: Plan,
  view: View,
  sheet: Sheet,
  selectedId: string | null,
): void {
  for (const opening of plan.openings) {
    const wall = hostWall(plan, opening, sheet);
    if (!wall) continue;
    const style = drawStyle(opening, sheet);
    if (!style) continue;
    const color = style === "remove" ? REMOVE : style === "new" ? NEW_STROKE : INK;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(1.2, view.pxPerMm * 5);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const frame = openingFrame(wall, opening);
    if (!frame) continue;
    strokeSegment(ctx, view, frame.jambA, frame.nx, frame.ny, wall.thickness / 2);
    strokeSegment(ctx, view, frame.jambB, frame.nx, frame.ny, wall.thickness / 2);
    if (opening.kind === "hinged") {
      trace(ctx, [frame.hinge, frame.leafEnd], view, false);
      ctx.stroke();
      trace(ctx, swingArc(wall, opening), view, false);
      ctx.stroke();
    } else if (opening.kind === "cavity") {
      const pocket = pocketPolygon(wall, opening);
      if (pocket.length >= 3) {
        trace(ctx, pocket, view, true);
        ctx.fillStyle = color;
        ctx.fill();
        const slab = doorSlab(wall, opening);
        if (slab.length >= 3) {
          trace(ctx, slab, view, true);
          ctx.fillStyle = "#ffffff";
          ctx.fill();
        }
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.4, view.pxPerMm * 8);
      trace(ctx, cavityChevron(wall, opening), view, false);
      ctx.stroke();
    } else {
      ctx.lineWidth = Math.max(1, view.pxPerMm * 4);
      for (const [a, b] of windowPanes(wall, opening)) {
        trace(ctx, [a, b], view, false);
        ctx.stroke();
      }
    }
    if (opening.id === selectedId) {
      ctx.strokeStyle = SELECT;
      ctx.lineWidth = 2.5;
      trace(ctx, gapPolygon(wall, opening), view, true);
      ctx.stroke();
    }
  }
}

function drawFixtures(
  ctx: CanvasRenderingContext2D,
  plan: Plan,
  view: View,
  sheet: Sheet,
  selectedId: string | null,
): void {
  for (const fixture of plan.fixtures) {
    const style = drawStyle(fixture, sheet);
    if (!style) continue;
    if (fixture.kind === "toilet" && fixture.clearance) {
      ctx.save();
      ctx.strokeStyle = style === "remove" ? REMOVE : style === "new" ? NEW_STROKE : "#5c6d79";
      ctx.lineWidth = 1.2;
      ctx.setLineDash([6, 5]);
      trace(ctx, clearancePolygon(fixture), view, true);
      ctx.stroke();
      ctx.restore();
    }
    const color = style === "remove" ? REMOVE : CATALOG[fixture.kind].electrical
      ? style === "new" ? NEW_STROKE : "#00426B"
      : style === "new" ? NEW_STROKE : INK;
    drawFixtureSymbol(ctx, fixture, view, color, style);
    if (fixture.id === selectedId) {
      ctx.save();
      ctx.strokeStyle = SELECT;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([]);
      trace(ctx, fixturePolygon(fixture), view, true);
      ctx.stroke();
      ctx.restore();
    }
  }
}

function drawDimensions(ctx: CanvasRenderingContext2D, graphics: DimGraphic[]): void {
  ctx.strokeStyle = DIM;
  ctx.lineWidth = 1;
  ctx.lineCap = "butt";
  ctx.setLineDash([]);
  ctx.beginPath();
  for (const graphic of graphics) {
    for (const [a, b] of graphic.extensions) line(ctx, a, b);
    line(ctx, graphic.line[0], graphic.line[1]);
  }
  ctx.stroke();
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (const graphic of graphics) {
    for (const [a, b] of graphic.ticks) line(ctx, a, b);
  }
  ctx.stroke();
}

function drawManualDimensions(ctx: CanvasRenderingContext2D, plan: Plan, view: View, sheet: Sheet): void {
  ctx.strokeStyle = DIM;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  for (const dim of plan.dims) {
    if (dim.sheet !== sheet) continue;
    const geometry = manualDimGeometry(dim);
    if (!geometry) continue;
    const a0 = worldToScreen(dim.a, view);
    const b0 = worldToScreen(dim.b, view);
    const a1 = worldToScreen(geometry.a, view);
    const b1 = worldToScreen(geometry.b, view);
    line(ctx, a0, a1);
    line(ctx, b0, b1);
    line(ctx, a1, b1);
  }
  ctx.stroke();
}

function drawCallouts(ctx: CanvasRenderingContext2D, plan: Plan, view: View, sheet: Sheet): void {
  ctx.strokeStyle = INK;
  ctx.fillStyle = "#faf9f5";
  ctx.lineWidth = 1.4;
  ctx.font = "700 12px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const callout of calloutCircles(plan, view, sheet)) {
    ctx.beginPath();
    ctx.moveTo(callout.anchor.x, callout.anchor.y);
    ctx.lineTo(callout.circle.x, callout.circle.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(callout.circle.x, callout.circle.y, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.fillText(String(callout.number), callout.circle.x, callout.circle.y + 0.5);
    ctx.fillStyle = "#faf9f5";
  }
}

function drawLabelText(ctx: CanvasRenderingContext2D, plan: Plan, view: View, sheet: Sheet): void {
  ctx.fillStyle = INK;
  ctx.textBaseline = "middle";
  for (const label of screenLabels(plan, view, sheet)) {
    ctx.save();
    ctx.translate(label.x, label.y);
    ctx.rotate((label.rotation * Math.PI) / 180);
    ctx.font = label.kind === "room" ? "700 14px system-ui, sans-serif" : "700 12px system-ui, sans-serif";
    ctx.textAlign = label.align === "left" ? "left" : "center";
    const lines = label.align === "left" ? wrapCanvasText(ctx, label.text, 260) : label.text.split("\n");
    const lineHeight = label.kind === "room" ? 16 : 14;
    const top = -((lines.length - 1) * lineHeight) / 2;
    lines.forEach((lineText, index) => {
      const width = ctx.measureText(lineText).width;
      const x = label.align === "left" ? 0 : -width / 2;
      ctx.fillStyle = "rgba(250, 249, 245, 0.88)";
      ctx.fillRect(x - 2, top + index * lineHeight - 7, width + 4, 14);
      ctx.fillStyle = INK;
      ctx.fillText(lineText, label.align === "left" ? 0 : 0, top + index * lineHeight);
    });
    ctx.restore();
  }
}

function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const source = text.split("\n");
  const lines: string[] = [];
  for (const paragraph of source) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    let line = words[0];
    for (const word of words.slice(1)) {
      const next = `${line} ${word}`;
      if (ctx.measureText(next).width <= maxWidth) line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines.length > 0 ? lines : [""];
}

function hostWall(plan: Plan, opening: Opening, sheet: Sheet): Wall | null {
  if (!isVisible(opening, sheet)) return null;
  const wall = wallById(plan, opening.wallId);
  if (!wall || !isVisible(wall, sheet)) return null;
  return wall;
}

function strokeSegment(
  ctx: CanvasRenderingContext2D,
  view: View,
  at: Point,
  nx: number,
  ny: number,
  half: number,
): void {
  trace(ctx, [
    { x: at.x + nx * half, y: at.y + ny * half },
    { x: at.x - nx * half, y: at.y - ny * half },
  ], view, false);
  ctx.stroke();
}

function trace(ctx: CanvasRenderingContext2D, points: Point[], view: View, close: boolean): void {
  if (points.length === 0) return;
  ctx.beginPath();
  points.forEach((point, index) => {
    const screen = worldToScreen(point, view);
    if (index === 0) ctx.moveTo(screen.x, screen.y);
    else ctx.lineTo(screen.x, screen.y);
  });
  if (close) ctx.closePath();
}

function line(ctx: CanvasRenderingContext2D, a: Point, b: Point): void {
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
}
