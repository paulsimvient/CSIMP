import { describe, expect, it } from "vitest";
import { POLICY_SHADOW_FIXTURES } from "./policyShadowEval";
import { forgeScenarios, mutateConflictingSensorReports } from "./scenarioForge";

describe("scenarioForge", () => {
  it("injects conflicting sensor report", () => {
    const base = POLICY_SHADOW_FIXTURES[0]!.packet;
    const { packet, meta } = mutateConflictingSensorReports("base-001", base);
    expect(packet.observedFacts.length).toBe(base.observedFacts.length + 1);
    expect(meta.mutator).toBe("conflicting-sensor-reports");
    expect(packet.contextWindow).toContain("SYNTHETIC SCENARIO");
  });

  it("forges multiple adversarial worlds from base packet", () => {
    const base = POLICY_SHADOW_FIXTURES[0]!.packet;
    const forged = forgeScenarios(base, { baseScenarioId: "port-a-base", maxScenarios: 3 });
    expect(forged.length).toBe(3);
    expect(new Set(forged.map((f) => f.scenarioId)).size).toBe(3);
  });
});
