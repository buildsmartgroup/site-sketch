import { formatArea, openingLabel, roomLabelLines } from "./annotations";
import { layoutDimensions } from "./dimensions";
import { worldToScreen } from "./geometry";
import { openingFrame } from "./openings";
import { isVisible } from "./phase";
import { roomCenter, roomMetrics, wallById } from "./plan";
import type { DimTarget, Plan, Point, Sheet, View } from "./types";

export type ScreenLabel = {
  key: string;
  text: string;
  x: number;
  y: number;
  rotation: number;
  align: "center" | "left";
  provisional: boolean;
  kind: "dim" | "opening" | "room" | "callout" | "text" | "manual";
  dim?: DimTarget;
  id?: string;
};

export function screenLabels(plan: Plan, view: View, sheet: Sheet): ScreenLabel[] {
  const labels: ScreenLabel[] = [];
  const dims = layoutDimensions(plan, view, sheet);
  for (const label of dims.labels) {
    labels.push({
      key: label.key,
      text: label.text,
      x: label.x,
      y: label.y,
      rotation: label.rotation,
      align: "center",
      provisional: label.provisional,
      kind: "dim",
      dim: label.target,
    });
  }
  for (const opening of plan.openings) {
    if (!isVisible(opening, sheet)) continue;
    const wall = wallById(plan, opening.wallId);
    if (!wall || !isVisible(wall, sheet)) continue;
    const frame = openingFrame(wall, opening);
    if (!frame) continue;
    const at = opening.kind === "hinged"
      ? { x: (frame.hinge.x + frame.leafEnd.x) / 2, y: (frame.hinge.y + frame.leafEnd.y) / 2 }
      : {
          x: frame.center.x + frame.nx * opening.side * (wall.thickness / 2 + 160),
          y: frame.center.y + frame.ny * opening.side * (wall.thickness / 2 + 160),
        };
    const screen = worldToScreen(at, view);
    labels.push({
      key: `opening-${opening.id}`,
      text: openingLabel(opening.kind, opening.width),
      x: screen.x,
      y: screen.y,
      rotation: 0,
      align: "center",
      provisional: opening.id.startsWith("preview-"),
      kind: "opening",
      id: opening.id,
      dim: { kind: "opening", openingId: opening.id },
    });
  }
  for (const room of plan.rooms) {
    if (!room.wallIds.some((id) => {
      const wall = wallById(plan, id);
      return !!wall && isVisible(wall, sheet) && !wall.id.startsWith("preview-");
    })) continue;
    const metrics = roomMetrics(plan, room);
    const center = roomCenter(plan, room);
    if (!metrics || !center) continue;
    const screen = worldToScreen(center, view);
    labels.push({
      key: `room-${room.id}`,
      text: roomLabelLines(room.name, formatArea(metrics.width, metrics.depth), room.ceiling, sheet).join("\n"),
      x: screen.x,
      y: screen.y,
      rotation: 0,
      align: "center",
      provisional: room.id.startsWith("preview-"),
      kind: "room",
      id: room.id,
    });
  }
  for (const callout of plan.callouts) {
    if (callout.sheet !== sheet) continue;
    const circle = worldToScreen(callout.label, view);
    labels.push({
      key: `callout-${callout.id}`,
      text: callout.text,
      x: circle.x + 16,
      y: circle.y,
      rotation: 0,
      align: "left",
      provisional: callout.id.startsWith("preview-"),
      kind: "callout",
      id: callout.id,
    });
  }
  for (const note of plan.notes) {
    if (note.sheet !== sheet) continue;
    const screen = worldToScreen(note.at, view);
    labels.push({
      key: `text-${note.id}`,
      text: note.text,
      x: screen.x,
      y: screen.y,
      rotation: 0,
      align: "left",
      provisional: note.id.startsWith("preview-"),
      kind: "text",
      id: note.id,
    });
  }
  for (const dim of plan.dims) {
    if (dim.sheet !== sheet) continue;
    const dx = dim.b.x - dim.a.x;
    const dy = dim.b.y - dim.a.y;
    const length = Math.hypot(dx, dy);
    if (length < 1) continue;
    const nx = -dy / length;
    const ny = dx / length;
    const mid = worldToScreen({ x: (dim.a.x + dim.b.x) / 2 + nx * dim.offset, y: (dim.a.y + dim.b.y) / 2 + ny * dim.offset }, view);
    const screenA = worldToScreen(dim.a, view);
    const screenB = worldToScreen(dim.b, view);
    let rotation = (Math.atan2(screenB.y - screenA.y, screenB.x - screenA.x) * 180) / Math.PI;
    if (rotation > 90) rotation -= 180;
    if (rotation < -90) rotation += 180;
    labels.push({
      key: `manual-${dim.id}`,
      text: String(Math.round(length)),
      x: mid.x,
      y: mid.y,
      rotation,
      align: "center",
      provisional: dim.id.startsWith("preview-"),
      kind: "manual",
      id: dim.id,
    });
  }
  return labels;
}

export function calloutCircles(plan: Plan, view: View, sheet: Sheet): { id: string; circle: Point; anchor: Point; number: number }[] {
  return plan.callouts
    .filter((callout) => callout.sheet === sheet)
    .map((callout) => ({
      id: callout.id,
      circle: worldToScreen(callout.label, view),
      anchor: worldToScreen(callout.anchor, view),
      number: callout.number,
    }));
}
