import { layoutDimensions, type DimGraphic } from "./dimensions";
import { gridSteps, worldToScreen } from "./geometry";
import { roomMetrics, wallDrawPolygon } from "./plan";
import type { Plan, Point, View } from "./types";

const PAPER = "#f3f0e8";
const MINOR = "#e3ddd0";
const MAJOR = "#d2cbbd";
const AXIS = "rgba(30, 53, 84, 0.45)";
const WALL = "#1a1d21";
const INTERIOR = "rgba(255, 253, 248, 0.72)";
const SELECT = "#3e7a45";
const DIM = "#1e3554";

export function paint(
  ctx: CanvasRenderingContext2D,
  plan: Plan,
  view: View,
  width: number,
  height: number,
  highlighted: ReadonlySet<string>,
): void {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, height);
  drawGrid(ctx, view, width, height);
  drawRooms(ctx, plan, view);
  drawWalls(ctx, plan, view, highlighted);
  drawDimensions(ctx, layoutDimensions(plan, view).graphics);
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
  eachStep(worldLeft, worldRight, step, (x) => {
    vline(ctx, worldToScreen({ x, y: 0 }, view).x, height);
  });
  eachStep(worldBottom, worldTop, step, (y) => {
    hline(ctx, worldToScreen({ x: 0, y }, view).y, width);
  });
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

function drawRooms(ctx: CanvasRenderingContext2D, plan: Plan, view: View): void {
  ctx.fillStyle = INTERIOR;
  for (const room of plan.rooms) {
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

function drawWalls(ctx: CanvasRenderingContext2D, plan: Plan, view: View, highlighted: ReadonlySet<string>): void {
  for (const wall of plan.walls) {
    const polygon = wallDrawPolygon(plan, wall);
    if (polygon.length < 3) continue;
    trace(ctx, polygon, view);
    ctx.fillStyle = WALL;
    ctx.fill();
  }
  ctx.strokeStyle = SELECT;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  for (const wall of plan.walls) {
    if (!highlighted.has(wall.id)) continue;
    const polygon = wallDrawPolygon(plan, wall);
    if (polygon.length < 3) continue;
    trace(ctx, polygon, view);
    ctx.stroke();
  }
}

function drawDimensions(ctx: CanvasRenderingContext2D, graphics: DimGraphic[]): void {
  ctx.strokeStyle = DIM;
  ctx.lineWidth = 1;
  ctx.lineCap = "butt";
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

function trace(ctx: CanvasRenderingContext2D, points: Point[], view: View): void {
  ctx.beginPath();
  points.forEach((point, index) => {
    const screen = worldToScreen(point, view);
    if (index === 0) ctx.moveTo(screen.x, screen.y);
    else ctx.lineTo(screen.x, screen.y);
  });
  ctx.closePath();
}

function line(ctx: CanvasRenderingContext2D, a: Point, b: Point): void {
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
}
