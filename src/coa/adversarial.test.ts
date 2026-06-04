import { describe, expect, it } from "vitest";
import { filterCitedIntelActions, runCoaPipeline } from "./pipeline";
import { scheduleBundleActions, solveValidatedIntelBundles } from "./validatedIntelSolver";
import type { SolverFn } from "./types";

describe("adversarial COA pipeline", () => {
  it("drops uncited intel actions before solver", () => {
    const filtered = filterCitedIntelActions([
      { id: "bad", description: "No facts", citedFacts: [] },
      { id: "good", description: "Grounded", citedFacts: ["f1"] },
    ]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe("good");
  });

  it("rejects pipeline input without cited facts on intel actions", async () => {
    await expect(
      runCoaPipeline({
        mode: "validated-intel",
        intelActions: [{ id: "x", description: "bad", citedFacts: [] }],
      })
    ).rejects.toThrow(/schema validation/i);
  });

  it("marks overlapping immediate shared-asset actions as UNSAT", async () => {
    const results = await solveValidatedIntelBundles({
      runId: "r1",
      signals: [],
      mode: "validated-intel",
      intelActions: [
        {
          id: "a1",
          description: "Use drone D7 for ISR",
          citedFacts: ["f1"],
          actionType: "observe",
          requiredAssets: ["drone-d7"],
          timeSensitivity: "immediate",
        },
        {
          id: "a2",
          description: "Retask drone D7 for extended ISR orbit",
          citedFacts: ["f1"],
          actionType: "observe",
          requiredAssets: ["drone-d7"],
          timeSensitivity: "immediate",
        },
      ],
    });
    const unsat = results.find((r) => r.status === "unsat");
    expect(unsat).toBeDefined();
    expect(
      unsat?.constraintSatisfaction?.hard.some(
        (h) => h.id === "hc-resource-exclusivity" && h.satisfied === false
      )
    ).toBe(true);
  });

  it("reschedules flexible actions with trace when sharing an asset", () => {
    const T0 = 1_000;
    const result = scheduleBundleActions(
      [
        {
          id: "hard-first",
          description: "Immediate task on shared asset",
          citedFacts: ["f1"],
          requiredAssets: ["team-a"],
          timeSensitivity: "immediate",
          confidence: "high",
        },
        {
          id: "flex-second",
          description: "Routine follow-on on same asset",
          citedFacts: ["f2"],
          requiredAssets: ["team-a"],
          timeSensitivity: "routine",
          confidence: "medium",
        },
      ],
      T0
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const flex = result.actions.find((a) => a.id === "flex-second")!;
    const hard = result.actions.find((a) => a.id === "hard-first")!;
    expect(flex.startTime).toBeGreaterThanOrEqual(hard.startTime + hard.duration);
    expect(result.adjustments.length).toBeGreaterThan(0);
    expect(result.adjustments[0]?.reason).toMatch(/overlap/i);
  });

  it("allows non-overlapping actions on different assets as SAT", async () => {
    const results = await solveValidatedIntelBundles({
      runId: "r-non-overlap",
      signals: [],
      mode: "validated-intel",
      intelActions: [
        {
          id: "a1",
          description: "ISR on drone A",
          citedFacts: ["f1"],
          actionType: "observe",
          requiredAssets: ["drone-a"],
          timeSensitivity: "immediate",
        },
        {
          id: "a2",
          description: "ISR on drone B",
          citedFacts: ["f2"],
          actionType: "observe",
          requiredAssets: ["drone-b"],
          timeSensitivity: "immediate",
        },
      ],
    });
    const sat = results.find(
      (r) => r.status === "sat" && r.selectedActions.length === 2
    );
    expect(sat).toBeDefined();
  });

  it("emits insufficient_evidence when only low-confidence escalatory actions exist", async () => {
    const results = await solveValidatedIntelBundles({
      runId: "r2",
      signals: [],
      mode: "validated-intel",
      intelActions: [
        {
          id: "strike1",
          description: "Conduct kinetic strike on contact",
          citedFacts: ["f1"],
          actionType: "other",
          confidence: "low",
        },
      ],
    });
    expect(results.some((r) => r.status === "insufficient_evidence")).toBe(true);
  });

  it("LLM-only uncited actions never produce SAT COA with those actions", async () => {
    const solver: SolverFn = async () => [
      { status: "sat", selectedActions: [] },
    ];
    const state = await runCoaPipeline(
      {
        mode: "validated-intel",
        intelActions: [
          {
            id: "ia1",
            description: "Monitor",
            citedFacts: ["fact_1"],
            actionType: "monitor",
          },
        ],
      },
      { solver }
    );
    const sat = Object.values(state.candidatesById).filter((c) => c.status === "sat");
    for (const c of sat) {
      expect(c.selectedActions.every((a) => a.id !== "uncited_llm_action")).toBe(true);
    }
  });
});
