import type { CyberEmulationExecutionMode } from "./types";

/** Normalize legacy persisted values. */
export function normalizeCyberExecutionMode(
  mode: string
): CyberEmulationExecutionMode {
  if (mode === "simulated") return "simulation";
  if (
    mode === "simulation" ||
    mode === "in-process-simulation" ||
    mode === "lab-executed" ||
    mode === "lab-unavailable"
  ) {
    return mode;
  }
  return "simulation";
}

export function cyberExecutionBadgeLabel(mode: CyberEmulationExecutionMode): string {
  switch (normalizeCyberExecutionMode(mode)) {
    case "simulation":
      return "SIMULATED";
    case "in-process-simulation":
      return "IN-PROCESS SIMULATION";
    case "lab-executed":
      return "LAB EXECUTED";
    case "lab-unavailable":
      return "LAB UNAVAILABLE";
  }
}
