/// <reference types="vite/client" />
import type { CoaState } from "./types";

/**
 * Asserts invariants that must hold on every CoaState transition.
 *
 * Only runs in development (NODE_ENV !== "production").
 * Call after every pipeline completion and after every store mutation.
 *
 * If any invariant is violated, this throws immediately with a message that
 * identifies the specific COA and the broken property — so bugs surface at
 * the point of mutation, not somewhere downstream in the UI.
 */
export function assertCoaState(state: CoaState): void {
  if (import.meta.env.PROD) return;

  // selectedCoaId must reference an existing candidate
  if (state.selectedCoaId !== undefined) {
    const selected = state.candidatesById[state.selectedCoaId];
    if (!selected) {
      throw new Error(
        `[COA invariant] selectedCoaId "${state.selectedCoaId}" does not reference an existing candidate.\n` +
          `Known IDs: ${Object.keys(state.candidatesById).join(", ") || "(none)"}`
      );
    }
  }

  // candidateOrder must contain only known IDs
  for (const id of state.candidateOrder) {
    if (!state.candidatesById[id]) {
      throw new Error(
        `[COA invariant] candidateOrder contains unknown ID "${id}"`
      );
    }
  }

  // Every candidate must pass its own invariants
  for (const candidate of Object.values(state.candidatesById)) {
    const { id, status, selectedActions, logisticsPlan } = candidate;

    const origin = candidate.origin ?? "automated";

    if ((origin === "operator-authored" || origin === "imported") && status === "draft") {
      continue;
    }

    if (origin === "operator-modified" && (status === "incomplete" || status === "stale")) {
      continue;
    }

    // A SAT COA with actions must have a populated logistics plan
    if (status === "sat" && selectedActions.length > 0) {
      if (logisticsPlan.kind !== "populated") {
        throw new Error(
          `[COA invariant] SAT candidate "${id}" has ${selectedActions.length} selected actions ` +
            `but logisticsPlan.kind is "${logisticsPlan.kind}".\n` +
            `A SAT COA with actions must have a populated plan.`
        );
      }
    }

    // A populated plan must reference its owning candidate
    if (logisticsPlan.kind === "populated") {
      if (
        logisticsPlan.source !== "demo" &&
        logisticsPlan.source !== "validated-intel"
      ) {
        throw new Error(
          `[COA invariant] Candidate "${id}" has invalid logistics source "${String(logisticsPlan.source)}".`
        );
      }
      if (logisticsPlan.coaId !== id) {
        throw new Error(
          `[COA invariant] Candidate "${id}" owns a logistics plan ` +
            `whose coaId is "${logisticsPlan.coaId}".\n` +
            `A populated plan's coaId must match its owning candidate.`
        );
      }

      // Every chip's laneId must reference a real lane
      const laneIds = new Set(logisticsPlan.lanes.map((l) => l.id));
      for (const chip of logisticsPlan.chips) {
        if (!laneIds.has(chip.laneId)) {
          throw new Error(
            `[COA invariant] Candidate "${id}": chip "${chip.id}" references ` +
              `unknown lane "${chip.laneId}".`
          );
        }
      }

      // Every chip referenced by a lane must exist
      const chipIds = new Set(logisticsPlan.chips.map((c) => c.id));
      for (const lane of logisticsPlan.lanes) {
        for (const chipId of lane.chipIds) {
          if (!chipIds.has(chipId)) {
            throw new Error(
              `[COA invariant] Candidate "${id}": lane "${lane.id}" references ` +
                `unknown chip "${chipId}".`
            );
          }
        }
      }
    }

    // Scores must be in [0, 1]
    for (const [key, value] of Object.entries(candidate.scores)) {
      if (typeof value !== "number" || value < 0 || value > 1) {
        throw new Error(
          `[COA invariant] Candidate "${id}": score "${key}" is ${value} — must be in [0, 1].`
        );
      }
    }
  }
}
