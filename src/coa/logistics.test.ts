import { describe, expect, it } from "vitest";
import { runCoaPipeline } from "./pipeline";
import { buildLogisticsPlan } from "./logistics";

describe("validated-intel logistics plan safety", () => {
  it("does not include demo offensive labels in validated-intel logistics plan", async () => {
    const state = await runCoaPipeline({
      mode: "validated-intel",
      intelActions: [
        {
          id: "action_001",
          description: "Monitor UAS activity closely",
          actionType: "observe",
          requiredAssets: ["counter-uas-unit"],
          citedFacts: ["fact_uas_001"],
          confidence: "medium",
          timeSensitivity: "immediate",
        },
      ],
    });

    const selectedId = state.selectedCoaId;
    expect(selectedId).toBeDefined();
    const selected = selectedId ? state.candidatesById[selectedId] : undefined;
    expect(selected?.logisticsPlan.kind).toBe("populated");
    if (!selected || selected.logisticsPlan.kind !== "populated") return;

    const text = JSON.stringify(selected.logisticsPlan).toLowerCase();
    expect(text).not.toContain("cyber strike");
    expect(text).not.toContain("maritime blockade");
    expect(text).not.toContain("precision strike");
    expect(text).not.toContain("air superiority");
    expect(selected.logisticsPlan.source).toBe("validated-intel");
  });

  it("supports explicit demo mode separately from validated-intel mode", async () => {
    const state = await runCoaPipeline({
      mode: "demo",
      intelActions: [
        {
          id: "action_001",
          description: "Monitor UAS activity closely",
          actionType: "observe",
          requiredAssets: ["counter-uas-unit"],
          citedFacts: ["fact_uas_001"],
          confidence: "medium",
          timeSensitivity: "immediate",
        },
      ],
    });

    const selectedId = state.selectedCoaId;
    expect(selectedId).toBeDefined();
    const selected = selectedId ? state.candidatesById[selectedId] : undefined;
    expect(selected?.logisticsPlan.kind).toBe("populated");
    if (!selected || selected.logisticsPlan.kind !== "populated") return;
    expect(selected.logisticsPlan.source).toBe("demo");
  });
});


describe("buildLogisticsPlan evidence dependencies", () => {
  it("links non-adjacent completed actions that share cited facts", () => {
    const plan = buildLogisticsPlan({
      coaId: "coa_test",
      source: "validated-intel",
      actions: [
        { id: "a", name: "Observe route", type: "observe", startTime: 0, duration: 10, resources: ["asset-a"] },
        { id: "b", name: "Coordinate team", type: "coordinate", startTime: 10, duration: 10, resources: ["asset-b"] },
        { id: "c", name: "Preserve access", type: "preserve", startTime: 20, duration: 10, resources: ["asset-c"] },
      ],
      intelActions: [
        { id: "a", description: "Observe route", citedFacts: ["fact-shared"] },
        { id: "b", description: "Coordinate team", citedFacts: ["fact-other"] },
        { id: "c", description: "Preserve access", citedFacts: ["fact-shared"] },
      ],
      observedFacts: [
        { id: "fact-shared", domain: "logistics", entity: "Route", event: "Access degraded", time: "00:00", source: "test", confidence: "high", severity: "medium" },
        { id: "fact-other", domain: "ground", entity: "Team", event: "Coordination required", time: "00:00", source: "test", confidence: "high", severity: "medium" },
      ],
    });

    expect(plan.kind).toBe("populated");
    if (plan.kind !== "populated") return;
    const sourceChip = plan.chips.find((chip) => chip.actionId === "a")!;
    const targetChip = plan.chips.find((chip) => chip.actionId === "c")!;
    expect(targetChip.dependencies).toContain(sourceChip.id);
  });
});
