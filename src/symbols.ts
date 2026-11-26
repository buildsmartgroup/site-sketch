import { localToWorld } from "./fixtures";
import { worldToScreen } from "./geometry";
import type { Fixture, Point, View } from "./types";

const NEW_FILL = "#e7f3fc";

export function drawFixtureSymbol(
  ctx: CanvasRenderingContext2D,
  fixture: Fixture,
  view: View,
  color: string,
  style: "existing" | "remove" | "new",
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1.2, view.pxPerMm * 6);
  const dash = Math.max(4, view.pxPerMm * 40);
  if (fixture.kind === "turning" || fixture.kind === "light" || fixture.kind === "exhaust" || fixture.kind === "curtain") {
    ctx.setLineDash([dash, dash * 0.65]);
  }
  switch (fixture.kind) {
    case "toilet":
      drawToilet(ctx, fixture, view);
      break;
    case "basin":
      drawBasin(ctx, fixture, view);
      break;
    case "vanity":
      drawVanity(ctx, fixture, view);
      break;
    case "shower":
      drawShower(ctx, fixture, view, style);
      break;
    case "bath":
      drawBath(ctx, fixture, view, style);
      break;
    case "grab":
      drawGrab(ctx, fixture, view);
      break;
    case "grab-l":
      drawGrabL(ctx, fixture, view);
      break;
    case "curtain":
      drawCurtain(ctx, fixture, view);
      break;
    case "niche":
      drawNiche(ctx, fixture, view);
      break;
    case "mirror":
      drawMirror(ctx, fixture, view);
      break;
    case "gpo":
      drawGpo(ctx, fixture, view);
      break;
    case "switch":
      drawSwitch(ctx, fixture, view);
      break;
    case "exhaust":
      drawExhaust(ctx, fixture, view);
      break;
    case "light":
      drawLight(ctx, fixture, view);
      break;
    case "turning":
      drawTurning(ctx, fixture, view);
      break;
    default:
      break;
  }
  ctx.restore();
}

function drawToilet(ctx: CanvasRenderingContext2D, fixture: Fixture, view: View): void {
  const w = fixture.width;
  const d = fixture.depth;
  const tankH = Math.min(190, d * 0.28);
  const half = w * 0.46;
  strokeLocal(ctx, fixture, view, [
    { x: -half, y: 0 },
    { x: half, y: 0 },
    { x: half, y: tankH },
    { x: -half, y: tankH },
  ], true);
  const bowl = oval(0, tankH + (d - tankH) * 0.55, w * 0.4, (d - tankH) * 0.46);
  strokeLocal(ctx, fixture, view, bowl, true);
  strokeLocal(ctx, fixture, view, [
    { x: -w * 0.22, y: tankH + 20 },
    { x: w * 0.22, y: tankH + 20 },
  ], false);
}

function drawBasin(ctx: CanvasRenderingContext2D, fixture: Fixture, view: View): void {
  const w = fixture.width / 2;
  const d = fixture.depth;
  strokeLocal(ctx, fixture, view, rect(-w, 0, w, d * 0.92), true);
  strokeLocal(ctx, fixture, view, oval(0, d * 0.55, w * 0.55, d * 0.28), true);
  strokeLocal(ctx, fixture, view, oval(0, d * 0.55, 16, 16), true);
  strokeLocal(ctx, fixture, view, oval(0, Math.min(70, d * 0.16), 18, 18), true);
}

function drawVanity(ctx: CanvasRenderingContext2D, fixture: Fixture, view: View): void {
  const w = fixture.width / 2;
  const d = fixture.depth;
  strokeLocal(ctx, fixture, view, rect(-w, 0, w, d), true);
  strokeLocal(ctx, fixture, view, oval(0, d * 0.62, Math.min(w * 0.36, 230), d * 0.26), true);
  strokeLocal(ctx, fixture, view, oval(0, d * 0.62, 14, 14), true);
  strokeLocal(ctx, fixture, view, oval(0, Math.min(70, d * 0.16), 18, 18), true);
}

function drawShower(
  ctx: CanvasRenderingContext2D,
  fixture: Fixture,
  view: View,
  style: "existing" | "remove" | "new",
): void {
  const w = fixture.width / 2;
  const d = fixture.depth / 2;
  if (style === "new") {
    ctx.save();
    traceLocal(ctx, fixture, view, rect(-w, -d, w, d), true);
    ctx.fillStyle = NEW_FILL;
    ctx.fill();
    ctx.restore();
  }
  strokeLocal(ctx, fixture, view, rect(-w, -d, w, d), true);
  const waste = 50;
  strokeLocal(ctx, fixture, view, rect(-waste, -waste, waste, waste), true);
  ctx.save();
  ctx.setLineDash([Math.max(4, view.pxPerMm * 36), Math.max(3, view.pxPerMm * 24)]);
  const inset = 70;
  const stop = waste + 30;
  for (const [sx, sy, ex, ey] of [
    [-w + inset, -d + inset, -stop, -stop],
    [w - inset, -d + inset, stop, -stop],
    [-w + inset, d - inset, -stop, stop],
    [w - inset, d - inset, stop, stop],
  ] as const) {
    strokeLocal(ctx, fixture, view, [{ x: sx, y: sy }, { x: ex, y: ey }], false);
    arrowHead(ctx, fixture, view, { x: ex, y: ey }, { x: sx, y: sy });
  }
  ctx.restore();
}

function drawBath(
  ctx: CanvasRenderingContext2D,
  fixture: Fixture,
  view: View,
  style: "existing" | "remove" | "new",
): void {
  const w = fixture.width / 2;
  const d = fixture.depth / 2;
  if (style === "new") {
    ctx.save();
    traceLocal(ctx, fixture, view, rect(-w, -d, w, d), true);
    ctx.fillStyle = NEW_FILL;
    ctx.fill();
    ctx.restore();
  }
  strokeLocal(ctx, fixture, view, rect(-w, -d, w, d), true);
  strokeLocal(ctx, fixture, view, oval(0, 0, w * 0.86, d * 0.72), true);
  strokeLocal(ctx, fixture, view, oval(-w * 0.55, 0, 18, 18), true);
}

function drawGrab(ctx: CanvasRenderingContext2D, fixture: Fixture, view: View): void {
  const w = fixture.width / 2;
  const bar = 16;
  const y = Math.max(fixture.depth * 0.55, 36);
  strokeLocal(ctx, fixture, view, roundedRect(-w, y - bar, w, y + bar, bar), true);
  strokeLocal(ctx, fixture, view, [
    { x: -w + 28, y: 8 },
    { x: -w + 28, y: y - bar },
  ], false);
  strokeLocal(ctx, fixture, view, [
    { x: w - 28, y: 8 },
    { x: w - 28, y: y - bar },
  ], false);
  strokeLocal(ctx, fixture, view, rect(-w + 8, 0, -w + 64, 12), true);
  strokeLocal(ctx, fixture, view, rect(w - 64, 0, w - 8, 12), true);
}

function drawGrabL(ctx: CanvasRenderingContext2D, fixture: Fixture, view: View): void {
  const t = 16;
  strokeLocal(ctx, fixture, view, [
    { x: 0, y: t },
    { x: fixture.width - t, y: t },
    { x: fixture.width - t, y: -t },
    { x: fixture.width + t, y: -t },
    { x: fixture.width + t, y: t * 2 },
    { x: t, y: t * 2 },
    { x: t, y: fixture.depth },
    { x: -t, y: fixture.depth },
    { x: -t, y: t },
  ], true);
  strokeLocal(ctx, fixture, view, rect(-28, fixture.depth - 8, 28, fixture.depth + 18), true);
  strokeLocal(ctx, fixture, view, rect(fixture.width - 18, -28, fixture.width + 8, 28), true);
}

function drawCurtain(ctx: CanvasRenderingContext2D, fixture: Fixture, view: View): void {
  const y = fixture.depth * 0.5;
  strokeLocal(ctx, fixture, view, [
    { x: -fixture.width / 2, y },
    { x: fixture.width / 2, y },
  ], false);
  strokeLocal(ctx, fixture, view, oval(-fixture.width / 2, y, 10, 10), true);
  strokeLocal(ctx, fixture, view, oval(fixture.width / 2, y, 10, 10), true);
}

function drawNiche(ctx: CanvasRenderingContext2D, fixture: Fixture, view: View): void {
  const w = fixture.width / 2;
  strokeLocal(ctx, fixture, view, rect(-w, 0, w, -fixture.depth), true);
  strokeLocal(ctx, fixture, view, rect(-w + 12, -8, w - 12, -fixture.depth + 8), true);
}

function drawMirror(ctx: CanvasRenderingContext2D, fixture: Fixture, view: View): void {
  const w = fixture.width / 2;
  strokeLocal(ctx, fixture, view, rect(-w, 0, w, fixture.depth), true);
  strokeLocal(ctx, fixture, view, [
    { x: 0, y: 0 },
    { x: 0, y: fixture.depth },
  ], false);
}

function drawGpo(ctx: CanvasRenderingContext2D, fixture: Fixture, view: View): void {
  const w = fixture.width / 2;
  const d = fixture.depth;
  strokeLocal(ctx, fixture, view, rect(-w, 8, w, d), true);
  const pins = (cx: number) => {
    strokeLocal(ctx, fixture, view, [
      { x: cx - 8, y: d * 0.42 },
      { x: cx + 8, y: d * 0.42 },
    ], false);
    strokeLocal(ctx, fixture, view, [
      { x: cx, y: d * 0.42 },
      { x: cx, y: d * 0.72 },
    ], false);
  };
  pins(-w * 0.4);
  pins(w * 0.4);
}

function drawSwitch(ctx: CanvasRenderingContext2D, fixture: Fixture, view: View): void {
  const w = fixture.width / 2;
  strokeLocal(ctx, fixture, view, rect(-w, 6, w, fixture.depth), true);
  strokeLocal(ctx, fixture, view, oval(0, fixture.depth * 0.55, 8, 8), true);
}

function drawExhaust(ctx: CanvasRenderingContext2D, fixture: Fixture, view: View): void {
  const r = fixture.width / 2;
  strokeLocal(ctx, fixture, view, oval(0, 0, r, r), true);
  strokeLocal(ctx, fixture, view, oval(0, 0, r * 0.62, r * 0.62), true);
}

function drawLight(ctx: CanvasRenderingContext2D, fixture: Fixture, view: View): void {
  const r = fixture.width / 2;
  strokeLocal(ctx, fixture, view, oval(0, 0, r, r), true);
  strokeLocal(ctx, fixture, view, [
    { x: -r * 0.7, y: 0 },
    { x: r * 0.7, y: 0 },
  ], false);
  strokeLocal(ctx, fixture, view, [
    { x: 0, y: -r * 0.7 },
    { x: 0, y: r * 0.7 },
  ], false);
}

function drawTurning(ctx: CanvasRenderingContext2D, fixture: Fixture, view: View): void {
  const r = (fixture.diameter || fixture.width) / 2;
  strokeLocal(ctx, fixture, view, oval(0, 0, r, r), true);
  const screen = worldToScreen(localToWorld(fixture, { x: 0, y: 0 }), view);
  ctx.save();
  ctx.setLineDash([]);
  ctx.font = `700 ${Math.max(11, Math.min(18, view.pxPerMm * 80))}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(Math.round(fixture.diameter || fixture.width)), screen.x, screen.y);
  ctx.restore();
}

function arrowHead(ctx: CanvasRenderingContext2D, fixture: Fixture, view: View, tip: Point, from: Point): void {
  const worldTip = localToWorld(fixture, tip);
  const worldFrom = localToWorld(fixture, from);
  const screenTip = worldToScreen(worldTip, view);
  const screenFrom = worldToScreen(worldFrom, view);
  const angle = Math.atan2(screenTip.y - screenFrom.y, screenTip.x - screenFrom.x);
  const size = Math.max(6, view.pxPerMm * 50);
  ctx.beginPath();
  ctx.moveTo(screenTip.x, screenTip.y);
  ctx.lineTo(screenTip.x - size * Math.cos(angle - 0.4), screenTip.y - size * Math.sin(angle - 0.4));
  ctx.moveTo(screenTip.x, screenTip.y);
  ctx.lineTo(screenTip.x - size * Math.cos(angle + 0.4), screenTip.y - size * Math.sin(angle + 0.4));
  ctx.stroke();
}

function strokeLocal(ctx: CanvasRenderingContext2D, fixture: Fixture, view: View, points: Point[], close: boolean): void {
  traceLocal(ctx, fixture, view, points, close);
  ctx.stroke();
}

function traceLocal(ctx: CanvasRenderingContext2D, fixture: Fixture, view: View, points: Point[], close: boolean): void {
  ctx.beginPath();
  points.forEach((point, index) => {
    const screen = worldToScreen(localToWorld(fixture, point), view);
    if (index === 0) ctx.moveTo(screen.x, screen.y);
    else ctx.lineTo(screen.x, screen.y);
  });
  if (close) ctx.closePath();
}

function rect(x0: number, y0: number, x1: number, y1: number): Point[] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

function roundedRect(x0: number, y0: number, x1: number, y1: number, r: number): Point[] {
  return [
    { x: x0 + r, y: y0 },
    { x: x1 - r, y: y0 },
    { x: x1, y: (y0 + y1) / 2 },
    { x: x1 - r, y: y1 },
    { x: x0 + r, y: y1 },
    { x: x0, y: (y0 + y1) / 2 },
  ];
}

function oval(cx: number, cy: number, rx: number, ry: number): Point[] {
  return arcPoints(cx, cy, rx, ry, 0, Math.PI * 2);
}

function arcPoints(cx: number, cy: number, rx: number, ry: number, start: number, end: number): Point[] {
  const steps = 16;
  const points: Point[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = start + ((end - start) * i) / steps;
    points.push({ x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry });
  }
  return points;
}
