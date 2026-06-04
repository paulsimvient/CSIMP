import { describe, expect, it } from "vitest";
import { buildLogisticsPlan } from "./logistics";

describe("logistics scene linkage", () => {
  it("attaches cited facts and cross-action dependencies to chips", () => {
    const plan = buildLogisticsPlan({
      coaId: "coa-1",
      source: "validated-intel",
      intelActions: [
        {
          id: "ia_1",
          description: "Monitor UAS near port",
          citedFacts: ["fact_uas_001"],
          actionType: "observe",
          requiredAssets: ["counter-uas-unit"],
        },
        {
          id: "ia_2",
          description: "Correlate UAS with cyber anomaly",
          citedFacts: ["fact_uas_001", "fact_cyber_001"],
          actionType: "investigate",
          requiredAssets: ["data-fusion-cell"],
        },
      ],
      observedFacts: [
        {
          id: "fact_uas_001",
          domain: "air",
          entity: "UAS Track",
          event: "Unknown UAS near port",
          time: "12:00Z",
          location: "Port A",
          source: "radar",
          confidence: "medium",
          severity: "high",
          rawEvidenceRef: "r1",
        },
        {
          id: "fact_cyber_001",
          domain: "cyber",
          entity: "Port ICS",
          event: "Auth failures",
          time: "12:05Z",
          location: "Port A",
          source: "siem",
          confidence: "high",
          severity: "high",
          rawEvidenceRef: "r2",
        },
      ],
      actions: [
        {
          id: "ia_1",
          name: "Monitor UAS near port",
          type: "observe",
          startTime: 1000,
          duration: 600,
          resources: ["counter-uas-unit"],
        },
        {
          id: "ia_2",
          name: "Correlate UAS with cyber anomaly",
          type: "investigate",
          startTime: 1300,
          duration: 900,
          resources: ["data-fusion-cell"],
        },
      ],
    });

    expect(plan.kind).toBe("populated");
    if (plan.kind !== "populated") return;

    const fusionChip = plan.chips.find((c) => c.actionId === "ia_2");
    expect(fusionChip?.linkedFactIds).toContain("fact_uas_001");
    expect(fusionChip?.linkedFactIds).toContain("fact_cyber_001");
    expect(fusionChip?.sceneSummary).toMatch(/UAS|Auth/);
    expect((fusionChip?.dependencies.length ?? 0) > 0).toBe(true);
    expect(
      fusionChip?.typedDependencies?.some((dep) => dep.kind === "uses-live-feed")
    ).toBe(true);
  });
});
