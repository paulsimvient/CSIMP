import { describe, expect, it } from "vitest";
import { scheduleBundleActions, solveValidatedIntelBundles } from "./validatedIntelSolver";

describe("solveValidatedIntelBundles", () => {
  it("returns multiple competing SAT bundles, not one mega-bundle", async () => {
    const results = await solveValidatedIntelBundles({
      runId: "run_test",
      signals: [],
      mode: "validated-intel",
      intelActions: [
        {
          id: "ia_cyber",
          description: "Investigate Keelung cyber anomalies",
          citedFacts: ["fact_cyber_001"],
          actionType: "investigate",
          requiredAssets: ["cyber-team"],
          timeSensitivity: "immediate",
          confidence: "high",
        },
        {
          id: "ia_air",
          description: "Retask ISR for mixed air tracks",
          citedFacts: ["fact_air_001"],
          actionType: "observe",
          requiredAssets: ["isr-wing"],
          timeSensitivity: "time-bound",
          confidence: "medium",
        },
        {
          id: "ia_mar",
          description: "Coordinate patrol for erratic vessels",
          citedFacts: ["fact_mar_001"],
          actionType: "coordinate",
          requiredAssets: ["patrol-flotilla"],
          timeSensitivity: "time-bound",
          confidence: "high",
        },
      ],
    });

    const sat = results.filter((r) => r.status === "sat");
    expect(sat.length).toBeGreaterThanOrEqual(3);
    expect(sat.some((r) => r.selectedActions.length === 1)).toBe(true);
    expect(sat.every((r) => r.constraintSatisfaction?.hard.some((h) => h.id === "hc-cited-facts"))).toBe(
      true
    );
  });
});


describe("scheduleBundleActions", () => {
  it("packs shared assets sequentially while allowing independent assets in parallel", () => {
    const T0 = 1_000;
    const result = scheduleBundleActions(
      [
        {
          id: "routine-shared",
          description: "Routine shared asset task",
          citedFacts: ["fact-1"],
          requiredAssets: ["team-a"],
          timeSensitivity: "routine",
          confidence: "medium",
        },
        {
          id: "immediate-shared",
          description: "Immediate shared asset task",
          citedFacts: ["fact-2"],
          requiredAssets: ["team-a"],
          timeSensitivity: "immediate",
          confidence: "high",
        },
        {
          id: "immediate-independent",
          description: "Immediate independent task",
          citedFacts: ["fact-3"],
          requiredAssets: ["team-b"],
          timeSensitivity: "immediate",
          confidence: "high",
        },
      ],
      T0
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const actions = result.actions;

    const sharedImmediate = actions.find((action) => action.id === "immediate-shared")!;
    const independent = actions.find((action) => action.id === "immediate-independent")!;
    const sharedRoutine = actions.find((action) => action.id === "routine-shared")!;

    expect(sharedImmediate.startTime).toBe(T0);
    expect(independent.startTime).toBe(T0);
    expect(sharedRoutine.startTime).toBeGreaterThanOrEqual(
      sharedImmediate.startTime + sharedImmediate.duration
    );
    expect(sharedImmediate.duration).toBe(10 * 60);
    expect(sharedRoutine.duration).toBe(60 * 60);
  });
});
