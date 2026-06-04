import { describe, expect, it } from "vitest";
import { runCyberEmulationAdapter } from "./adapter";
import { CyberEmulationPolicyError } from "./types";

describe("runCyberEmulationAdapter", () => {
  it("returns simulated ATT&CK-mapped results with fact and action traceability", async () => {
    const result = await runCyberEmulationAdapter({
      coaId: "coa-1",
      validatedActionIds: ["ia_cyber"],
      citedFactIds: ["fact_cyber_001"],
      actionDescriptions: ["Investigate authentication anomalies"],
      actionTypes: ["cyber"],
    });

    expect(result.provider).toBe("simulated");
    expect(result.executionMode).toBe("simulation");
    expect(result.citedFactIds).toContain("fact_cyber_001");
    expect(result.validatedActionIds).toContain("ia_cyber");
    expect(result.techniquesEvaluated.length).toBeGreaterThan(0);
    expect(result.residualRisk).toBeGreaterThan(0);
    expect(result.residualRisk).toBeLessThanOrEqual(1);
    expect(result.evidenceRefs).toContain("fact_cyber_001");
  });

  it("runs atomic-red-team when lab approved", async () => {
    const result = await runCyberEmulationAdapter({
      coaId: "coa-1",
      validatedActionIds: ["ia_cyber"],
      citedFactIds: ["fact_cyber_001"],
      actionDescriptions: ["Investigate authentication failures"],
      actionTypes: ["cyber"],
      provider: "atomic-red-team",
      humanApproved: true,
      labEnvironmentConfirmed: true,
    });

    expect(result.provider).toBe("atomic-red-team");
    expect(result.executionMode).toBe("in-process-simulation");
  });

  it("rejects non-simulated runs without human approval", async () => {
    await expect(
      runCyberEmulationAdapter({
        coaId: "coa-1",
        validatedActionIds: ["ia_cyber"],
        citedFactIds: ["fact_cyber_001"],
        actionDescriptions: ["Test"],
        actionTypes: ["cyber"],
        provider: "caldera",
        labEnvironmentConfirmed: true,
        humanApproved: false,
      })
    ).rejects.toBeInstanceOf(CyberEmulationPolicyError);
  });

  it("rejects runs without cited facts", async () => {
    await expect(
      runCyberEmulationAdapter({
        coaId: "coa-1",
        validatedActionIds: ["ia_cyber"],
        citedFactIds: [],
        actionDescriptions: ["Test"],
        actionTypes: ["cyber"],
      })
    ).rejects.toBeInstanceOf(CyberEmulationPolicyError);
  });
});
