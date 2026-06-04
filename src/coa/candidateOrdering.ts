import { applyDominanceFlags } from "./dominance";
import { buildRankingExplanation } from "./rankRationale";
import { rankCoas } from "./ranking";
import type { CoaCandidate, CoaState } from "./types";

/**
 * Re-ranks all candidates (automated + operator) and rebuilds candidateOrder.
 * Called after operator validation/merge so dominance and grid order stay current.
 */
export function reorderCoaCandidates(state: CoaState): CoaState {
  const candidates = Object.values(state.candidatesById);
  if (candidates.length === 0) return state;

  const withDominance = applyDominanceFlags(candidates);
  const ranked = rankCoas(withDominance).map((candidate, index) => ({
    ...candidate,
    rankingExplanation: buildRankingExplanation(candidate, index + 1),
  }));

  return {
    ...state,
    candidatesById: Object.fromEntries(ranked.map((c) => [c.id, c])),
    candidateOrder: ranked.map((c) => c.id),
  };
}

export function pickRankIndex(
  ranked: CoaCandidate[],
  coaId: string
): number {
  return ranked.findIndex((c) => c.id === coaId) + 1;
}
