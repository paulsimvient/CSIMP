/** Prototype effects scores — not validated operational predictions. */
export const HEURISTIC_ESTIMATE_NOTE =
  "Prototype estimate derived from deterministic rules. Not a validated real-world prediction.";

/** Formats prototype/heuristic scores for UI — not operational estimates. */
export function formatHeuristicScore(value: number): string {
  return `Heuristic Estimate ${Math.round(value * 100)}%`;
}

export function formatHeuristicImpact(value: number): string {
  return `Heuristic Estimate impact ${Math.round(value * 100)}%`;
}

export function formatHeuristicRisk(value: number): string {
  return `Heuristic Estimate risk ${Math.round(value * 100)}%`;
}
