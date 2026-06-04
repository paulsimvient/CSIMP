import { describe, expect, it } from "vitest";
import { filterCitedIntelActions, runCoaPipeline } from "./pipeline";
import type { CoaAction, EffectsEngineFn, SolverFn } from "./types";

describe("filterCitedIntelActions", () => {
  it("drops actions with no cited fact IDs", () => {
    const filtered = filterCitedIntelActions([
      {
        id: "bad",
        description: "Uncited action",
        citedFacts: [],
      },
      {
        id: "good",
        description: "Grounded action",
        citedFacts: ["fact_001"],
      },
    ]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe("good");
  });
});

describe("runCoaPipeline intel fidelity scoring", () => {
  it("prioritizes COAs aligned with urgent, high-confidence intel actions", async () => {
    const solver: SolverFn = async () => [
      {
        status: "sat",
        selectedActions: [makeAction("a-cyber", "Cyber Investigation", "cyber")],
      },
      {
        status: "sat",
        selectedActions: [makeAction("a-air", "Air Sweep", "air")],
      },
    ];

    const effectsEngine: EffectsEngineFn = async (candidates, _context) =>
      Object.fromEntries(
        candidates.map((candidate) => [
          candidate.id,
          {
            coaId: candidate.id,
            summary: {
              expectedImpact: 0.65,
              confidence: 0.65,
              timeToEffect: 3600,
              explanation: "Deterministic test effects",
              risks: [],
              estimationMethod: "deterministic-heuristic",
              isValidatedPrediction: false,
            },
            score: 0.65,
            risk: 0.25,
            explanation: "Deterministic test effects",
          },
        ])
      );

    const state = await runCoaPipeline(
      {
        mode: "validated-intel",
        intelActions: [
          {
            id: "ia_001",
            description:
              "Investigate authentication anomalies with cyber response team immediately",
            citedFacts: ["fact_cyber_001"],
            actionType: "investigate",
            requiredAssets: ["cyber-incident-response-team"],
            timeSensitivity: "immediate",
            confidence: "high",
          },
        ],
      },
      { solver, effectsEngine }
    );

    const ranked = state.candidateOrder.map((id) => state.candidatesById[id]);
    expect(ranked[0]?.selectedActions[0]?.type).toBe("cyber");
    expect(ranked[0]?.scores.overall).toBeGreaterThan(ranked[1]?.scores.overall ?? 0);
    expect(ranked[0]?.intelFidelity?.alignment).toBeGreaterThan(
      ranked[1]?.intelFidelity?.alignment ?? 0
    );
  });
});

function makeAction(id: string, name: string, type: string): CoaAction {
  return {
    id,
    name,
    type,
    startTime: 0,
    duration: 1800,
    resources: [`res-${id}`],
  };
}
