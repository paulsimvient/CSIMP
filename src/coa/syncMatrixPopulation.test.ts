import { describe, expect, it } from "vitest";
import { buildLogisticsPlan } from "./logistics";
import { runCoaPipeline } from "./pipeline";
import { buildSyncMatrixModel } from "./syncMatrix";
import { buildSystemSyncBar, aggregateChipsByAction } from "./syncMatrixPopulation";
import { buildChipAssessments } from "./matrixQuality";
import type { LogisticsPlan } from "./types";

describe("syncMatrixPopulation", () => {
  it("demo COA pipeline fills parallel matrix rows with system-generated cards", async () => {
    const state = await runCoaPipeline({ mode: "demo" });
    expect(state.status).toBe("ready");

    const candidate = Object.values(state.candidatesById).find(
      (c) =>
        c.status === "sat" &&
        c.logisticsPlan.kind === "populated" &&
        c.selectedActions.length >= 3
    );
    expect(candidate).toBeDefined();
    const plan = candidate!.logisticsPlan as Extract<LogisticsPlan, { kind: "populated" }>;

    const model = buildSyncMatrixModel({ plan, coaLabel: candidate!.label });
    expect(model.actionCount).toBeGreaterThanOrEqual(3);

    const rowsWithBars = model.rows.filter((row) => row.bars.length > 0);
    expect(rowsWithBars.length).toBeGreaterThanOrEqual(2);

    const bars = model.rows.flatMap((row) => row.bars);
    expect(bars.length).toBe(model.actionCount);
    expect(bars.every((bar) => bar.sourceLabel?.startsWith("System generated"))).toBe(
      true
    );
    expect(bars.some((bar) => bar.operationalFunction?.length)).toBe(true);
  });

  it("creates one matrix bar per COA action across operational rows", () => {
    const plan = buildLogisticsPlan({
      coaId: "coa-3",
      source: "validated-intel",
      actions: [
        {
          id: "observe",
          name: "Maintain contact with enemy force",
          type: "observe",
          startTime: 0,
          duration: 900,
          resources: ["uav-recon"],
        },
        {
          id: "suppress",
          name: "Suppress enemy position",
          type: "fires",
          startTime: 900,
          duration: 600,
          resources: ["fires-battery"],
        },
        {
          id: "secure",
          name: "1-42 secure Objective KEN",
          type: "movement",
          startTime: 900,
          duration: 1800,
          resources: ["1-42-infantry"],
        },
      ],
      intelActions: [
        {
          id: "observe",
          description: "Maintain contact",
          citedFacts: ["fact-1"],
          actionType: "observe",
        },
        {
          id: "suppress",
          description: "Suppress enemy position",
          citedFacts: ["fact-2"],
          actionType: "fires",
        },
        {
          id: "secure",
          description: "1-42 secure Objective KEN",
          citedFacts: ["fact-3"],
          actionType: "movement",
          requiredAssets: ["1-42-infantry"],
        },
      ],
      observedFacts: [
        {
          id: "fact-1",
          domain: "air",
          entity: "UAV",
          event: "Orbit",
          time: "00:00",
          source: "t",
          confidence: "high",
          severity: "low",
        },
        {
          id: "fact-3",
          domain: "ground",
          entity: "Objective KEN",
          event: "Secure",
          time: "00:00",
          source: "t",
          confidence: "high",
          severity: "medium",
        },
      ],
    });

    expect(plan.kind).toBe("populated");
    if (plan.kind !== "populated") return;

    const model = buildSyncMatrixModel({ plan, coaLabel: "COA 3" });
    expect(model.actionCount).toBe(3);
    expect(model.rows.some((row) => row.id === "isr::air" && row.bars.length > 0)).toBe(
      true
    );
    expect(model.rows.some((row) => row.id === "fires::suppression" && row.bars.length > 0)).toBe(
      true
    );
    expect(
      model.rows.some((row) => row.id === "maneuver::main-effort" && row.bars.length > 0)
    ).toBe(true);

    const secureBar = model.rows
      .flatMap((row) => row.bars)
      .find((bar) => bar.actionId === "secure");
    expect(secureBar?.actor).toMatch(/1-42/i);
    expect(secureBar?.actionVerb).toBeTruthy();
    expect(secureBar?.sourceLabel).toBe("System generated — COA 3");
    expect(secureBar?.operationalFunction).toMatch(/maneuver/i);
  });

  it("marks timing required without inventing schedule", () => {
    const plan = buildLogisticsPlan({
      coaId: "coa-1",
      source: "validated-intel",
      actions: [
        {
          id: "wait",
          name: "Monitor and wait for further information",
          type: "monitor",
          startTime: 0,
          duration: 300,
          resources: ["command-element"],
        },
      ],
      intelActions: [
        {
          id: "wait",
          description: "Monitor and wait — timing required for next phase",
          citedFacts: ["fact-1"],
          actionType: "monitor",
        },
      ],
      observedFacts: [
        {
          id: "fact-1",
          domain: "air",
          entity: "Contact",
          event: "Track",
          time: "00:00",
          source: "t",
          confidence: "medium",
          severity: "low",
        },
      ],
    });

    if (plan.kind !== "populated") return;
    const chips = aggregateChipsByAction(plan.chips);
    const chip = chips.get("wait")!;
    const assessments = buildChipAssessments(plan);
    const bar = buildSystemSyncBar({
      chip,
      assessment: assessments.get(chip.id) ?? {
        level: "green",
        reasons: [],
        fixes: [],
      },
      chipById: new Map(plan.chips.map((c) => [c.id, c])),
      coaLabel: "COA 1",
      modifiedIds: new Set(),
    });
    expect(bar.missingFields).not.toContain("timing");
    expect(assessments.get(chip.id)?.reasons.some((r) => /time/i.test(r))).toBe(true);
  });
});
