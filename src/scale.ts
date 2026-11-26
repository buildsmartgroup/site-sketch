/**
 * Prefer 1:30. Use a coarser standard only when the plan does not fit at 1:30.
 * `fit` is true when the note should say the scale was chosen to fit.
 */
export function chooseScale(
  worldWidth: number,
  worldDepth: number,
  paperWidth: number,
  paperDepth: number,
): { ratio: number; fit: boolean } {
  if (!(paperWidth > 0) || !(paperDepth > 0) || !(worldWidth > 0) || !(worldDepth > 0)) {
    return { ratio: 30, fit: false };
  }
  const need = Math.max(worldWidth / paperWidth, worldDepth / paperDepth);
  if (need <= 30) return { ratio: 30, fit: false };
  const standards = [50, 100, 200, 500];
  for (const ratio of standards) {
    if (ratio >= need - 1e-6) return { ratio, fit: true };
  }
  return { ratio: Math.ceil(need / 10) * 10, fit: true };
}

export function scaleLabel(choice: { ratio: number; fit: boolean }): string {
  return choice.fit ? `1:${choice.ratio} FIT` : `1:${choice.ratio}`;
}
