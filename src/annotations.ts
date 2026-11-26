import { distance } from "./geometry";
import type { ManualDim, Point, Sheet } from "./types";

export function formatArea(width: number, depth: number): string {
  return `${((width * depth) / 1_000_000).toFixed(2)} m²`;
}

export function roomLabelLines(name: string, area: string, ceiling: number, sheet: Sheet): string[] {
  const lines = [(name.trim() || "ROOM").toUpperCase(), sheet === "existing" ? `${area} (EXISTING)` : area];
  if (ceiling > 0) lines.push(`CH ${Math.round(ceiling)}`);
  return lines;
}

export function nextCalloutNumber(numbers: readonly number[]): number {
  return numbers.reduce((max, value) => Math.max(max, value), 0) + 1;
}

export function openingLabel(kind: "hinged" | "cavity" | "window", width: number): string {
  const size = String(Math.round(width));
  if (kind === "cavity") return `${size} CSD`;
  if (kind === "window") return `${size} W`;
  return size;
}

export function manualDimGeometry(dim: ManualDim): { a: Point; b: Point; mid: Point; length: number } | null {
  const dx = dim.b.x - dim.a.x;
  const dy = dim.b.y - dim.a.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return null;
  const nx = -dy / length;
  const ny = dx / length;
  const a = { x: dim.a.x + nx * dim.offset, y: dim.a.y + ny * dim.offset };
  const b = { x: dim.b.x + nx * dim.offset, y: dim.b.y + ny * dim.offset };
  return { a, b, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, length };
}

export function calloutNear(point: Point, anchor: Point, label: Point, slopMm: number): boolean {
  return distance(point, label) <= slopMm * 1.8 || distance(point, anchor) <= slopMm;
}
