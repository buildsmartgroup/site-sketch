import type { Origin, Removal, Sheet } from "./types";

export type DrawStyle = "existing" | "remove" | "new";

/** Existing sheet shows existing work, removed items in red. Proposed hides removals and shows new work. */
export function isVisible(element: { origin: Origin; removal: Removal }, sheet: Sheet): boolean {
  if (element.origin === "new") return sheet === "proposed";
  if (sheet === "proposed" && element.removal === "remove") return false;
  return true;
}

export function drawStyle(element: { origin: Origin; removal: Removal }, sheet: Sheet): DrawStyle | null {
  if (!isVisible(element, sheet)) return null;
  if (element.removal === "remove") return "remove";
  if (element.origin === "new") return "new";
  return "existing";
}
