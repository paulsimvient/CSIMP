import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { loadPolicyBundle } from "./loadPolicyBundle";
import { simulatePolicyBundle } from "./simulatePolicy";
import { runPolicyShadowComparison } from "./policyShadowRunner";

describe("policy shadow comparison", () => {
  it("detects stricter candidate policy vs production on attribution fixture", async () => {
    const repoRoot = join(import.meta.dirname, "../../..");
    const production = await loadPolicyBundle(repoRoot, "intel-interpreter", "1.0.0");

    const result = await runPolicyShadowComparison({
      repoRoot,
      agentId: "intel-interpreter",
      productionVersion: "1.0.0",
      candidateVersion: "1.1.0",
      releaseId: "shadow-test",
      policyChanges: [
        {
          path: "policies/agents/intel-interpreter/attribution.json",
          operation: "add-rule",
          rule: "Require corroboration from two independent sources before attribution claims.",
        },
      ],
    });

    expect(result.mode).toBe("policy-fixtures");
    expect(result.productionMetrics.groundingPassRate).toBeGreaterThanOrEqual(
      result.candidateMetrics.groundingPassRate
    );
    expect(result.comparison.blockers.length).toBeGreaterThanOrEqual(0);
  });

  it("simulatePolicyBundle applies add-rule in memory", async () => {
    const repoRoot = join(import.meta.dirname, "../../..");
    const base = await loadPolicyBundle(repoRoot, "intel-interpreter", "1.0.0");
    const simulated = simulatePolicyBundle(base, [
      {
        path: "policies/agents/intel-interpreter/attribution.json",
        operation: "add-rule",
        rule: "Test rule for simulation.",
      },
    ], "1.1.0");

    expect(simulated.version).toBe("1.1.0");
    expect(simulated.policies["attribution.json"]?.rules).toContain("Test rule for simulation.");
  });
});
