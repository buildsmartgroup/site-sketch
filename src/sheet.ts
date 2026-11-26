import { contentBounds } from "./plan";
import { paint } from "./render";
import { chooseScale, scaleLabel } from "./scale";
import type { Plan, Sheet, View } from "./types";

const MM = 6;
const PAGE_W = 420 * MM;
const PAGE_H = 297 * MM;
const MARGIN = 8 * MM;
const TITLE_W = 82 * MM;
const NOTES_H = 50 * MM;
const INK = "#1a1a1a";
const PAPER = "#faf9f5";

export function renderSheet(canvas: HTMLCanvasElement, plan: Plan, sheet: Sheet): void {
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(5 * MM, 5 * MM, PAGE_W - 10 * MM, PAGE_H - 10 * MM);

  const viewX = MARGIN;
  const viewY = MARGIN;
  const viewW = PAGE_W - MARGIN * 2 - TITLE_W;
  const viewH = PAGE_H - MARGIN * 2 - NOTES_H;
  const bounds = contentBounds(plan, sheet);
  const pad = 520;
  const worldW = bounds ? bounds.width + pad * 2 : 3000;
  const worldD = bounds ? bounds.depth + pad * 2 : 2400;
  const choice = chooseScale(worldW, worldD, viewW / MM, viewH / MM);
  const pxPerMm = MM / choice.ratio;
  const cx = bounds ? bounds.x + bounds.width / 2 : 0;
  const cy = bounds ? bounds.y + bounds.depth / 2 : 0;
  const view: View = {
    pxPerMm,
    originX: cx - (viewX + viewW / 2) / pxPerMm,
    originY: cy + (viewY + viewH / 2) / pxPerMm,
  };

  ctx.save();
  ctx.beginPath();
  ctx.rect(viewX, viewY, viewW, viewH);
  ctx.clip();
  paint(ctx, plan, view, PAGE_W, PAGE_H, { sheet, grid: false, background: true, labels: true, paper: PAPER });
  ctx.restore();

  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.25;
  ctx.strokeRect(viewX, viewY, viewW, viewH);
  const titleX = PAGE_W - MARGIN - TITLE_W;
  ctx.strokeRect(titleX, MARGIN, TITLE_W, PAGE_H - MARGIN * 2);
  drawNotes(ctx, plan, viewX, viewY + viewH, viewW * 0.62, NOTES_H);
  drawLegend(ctx, viewX + viewW * 0.62, viewY + viewH, viewW * 0.38, NOTES_H);
  drawTitle(ctx, plan, sheet, scaleLabel(choice), titleX, MARGIN, TITLE_W, PAGE_H - MARGIN * 2);
  drawScaleBar(ctx, choice.ratio, viewX + 16, viewY + viewH - 36, viewW * 0.4);
  drawNorth(ctx, viewX + viewW - 28, viewY + 36);
}

function drawNotes(
  ctx: CanvasRenderingContext2D,
  plan: Plan,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
  ctx.fillStyle = INK;
  ctx.font = "700 13px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("NOTES", x + 10, y + 18);
  ctx.font = "11px system-ui, sans-serif";
  const lines = plan.meta.notes
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => wrap(ctx, line.toUpperCase(), width - 28));
  lines.slice(0, 6).forEach((line, index) => {
    ctx.fillText(`– ${line}`, x + 10, y + 36 + index * 14);
  });
  ctx.restore();
}

function drawLegend(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
  ctx.fillStyle = INK;
  ctx.font = "700 13px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("LEGEND", x + 8, y + 16);
  const rows: { draw: (sx: number, sy: number) => void; label: string }[] = [
    { label: "EXISTING", draw: (sx, sy) => { ctx.fillStyle = INK; ctx.fillRect(sx, sy, 18, 8); } },
    { label: "REMOVE", draw: (sx, sy) => { ctx.fillStyle = "#C0192B"; ctx.fillRect(sx, sy, 18, 8); } },
    {
      label: "NEW WORK",
      draw: (sx, sy) => {
        ctx.save();
        ctx.beginPath();
        ctx.rect(sx, sy, 18, 8);
        ctx.clip();
        ctx.fillStyle = "#e7f3fc";
        ctx.fillRect(sx, sy, 18, 8);
        ctx.strokeStyle = "#3E8EDE";
        ctx.beginPath();
        ctx.moveTo(sx - 2, sy + 8);
        ctx.lineTo(sx + 8, sy - 2);
        ctx.moveTo(sx + 6, sy + 10);
        ctx.lineTo(sx + 20, sy - 2);
        ctx.stroke();
        ctx.restore();
        ctx.strokeStyle = "#3E8EDE";
        ctx.strokeRect(sx + 0.5, sy + 0.5, 17, 7);
      },
    },
    {
      label: "ELECTRICAL",
      draw: (sx, sy) => {
        ctx.strokeStyle = "#00426B";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(sx + 8, sy + 4, 5, 0, Math.PI * 2);
        ctx.stroke();
      },
    },
    {
      label: "OVERHEAD / TURNING",
      draw: (sx, sy) => {
        ctx.strokeStyle = INK;
        ctx.setLineDash([3, 2]);
        ctx.beginPath();
        ctx.arc(sx + 8, sy + 4, 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      },
    },
  ];
  ctx.font = "11px system-ui, sans-serif";
  rows.forEach((row, index) => {
    const sy = y + 32 + index * 16;
    row.draw(x + 10, sy);
    ctx.fillStyle = INK;
    ctx.fillText(row.label, x + 34, sy + 4);
  });
  ctx.restore();
}

function drawTitle(
  ctx: CanvasRenderingContext2D,
  plan: Plan,
  sheet: Sheet,
  scale: string,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
  ctx.fillStyle = INK;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  let cursor = y + 22;
  const write = (text: string, size: number, bold = false, gap = 16) => {
    ctx.font = `${bold ? 700 : 400} ${size}px system-ui, sans-serif`;
    for (const line of wrap(ctx, text, width - 16)) {
      ctx.fillText(line, x + 8, cursor);
      cursor += gap;
    }
  };
  write("BUILDSMART GROUP", 13, true, 16);
  write("Builders Licence DBU 46138", 10, false, 13);
  write("NDIS Provider 4-GQRXUP3", 10, false, 13);
  write("info@buildsmartgroup.com.au", 10, false, 16);
  rule(ctx, x, cursor, width);
  cursor += 18;
  write("SITE SKETCH", 12, true, 16);
  write(sheet === "existing" ? "EXISTING / DEMOLITION" : "PROPOSED FLOOR PLAN", 12, true, 16);
  write(sheet === "existing" ? "SHEET 1 OF 2" : "SHEET 2 OF 2", 11, false, 16);
  rule(ctx, x, cursor, width);
  cursor += 16;
  const meta = plan.meta;
  for (const [label, value] of [
    ["PROJECT", meta.project],
    ["CLIENT", meta.client],
    ["ADDRESS", meta.address],
    ["DRAWN", meta.drawnBy],
    ["DATE", meta.date],
    ["REVISION", meta.revision || "A"],
    ["SCALE", `${scale} AT A3`],
  ] as const) {
    ctx.font = "700 9px system-ui, sans-serif";
    ctx.fillText(label, x + 8, cursor);
    cursor += 12;
    ctx.font = "12px system-ui, sans-serif";
    const shown = value.trim() || "—";
    for (const line of wrap(ctx, shown, width - 16).slice(0, 3)) {
      ctx.fillText(line, x + 8, cursor);
      cursor += 14;
    }
    cursor += 4;
    if (cursor > y + height - 8) break;
  }
  ctx.restore();
}

function drawScaleBar(ctx: CanvasRenderingContext2D, ratio: number, x: number, y: number, maxPx: number): void {
  let mm = 1000;
  if ((mm / ratio) * MM > maxPx) mm = 500;
  const px = (mm / ratio) * MM;
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + px, y);
  ctx.moveTo(x, y - 5);
  ctx.lineTo(x, y + 5);
  ctx.moveTo(x + px, y - 5);
  ctx.lineTo(x + px, y + 5);
  ctx.stroke();
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(String(mm), x + px / 2, y - 6);
  ctx.restore();
}

function drawNorth(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.save();
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.moveTo(x, y - 18);
  ctx.lineTo(x - 7, y + 8);
  ctx.lineTo(x, y + 1);
  ctx.lineTo(x + 7, y + 8);
  ctx.closePath();
  ctx.fill();
  ctx.font = "700 12px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText("N", x, y - 20);
  ctx.restore();
}

function rule(ctx: CanvasRenderingContext2D, x: number, y: number, width: number): void {
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 8, y);
  ctx.lineTo(x + width - 8, y);
  ctx.stroke();
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
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
  return lines;
}
