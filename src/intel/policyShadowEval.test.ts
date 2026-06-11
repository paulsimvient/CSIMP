import { describe, expect, it } from "vitest";
import { runPolicyShadowMetrics, POLICY_SHADOW_FIXTURES } from "./policyShadowEval";
import { DEFAULT_GROUNDING_POLICY } from "./groundingPolicy";

describe("policyShadowEval", () => {
  it("scores fixtures under default policy", () => {
    const metrics = runPolicyShadowMetrics(DEFAULT_GROUNDING_POLICY);
    expect(metrics.fixtureResults).toHaveLength(POLICY_SHADOW_FIXTURES.length);
    expect(metrics.groundingPassRate).toBeGreaterThan(0);
    expect(metrics.groundingPassRate).toBeLessThanOrEqual(1);
  });

  it("blocks single-source attribution under strict multi-source rule", () => {
    const strict = {
      ...DEFAULT_GROUNDING_POLICY,
      attributionRules: [
        "Require corroboration from two independent sources before attribution claims.",
      ],
    };
    const metrics = runPolicyShadowMetrics(strict);
    const attributionFixture = metrics.fixtureResults.find((f) => f.id === "single-source-attribution");
    expect(attributionFixture?.valid).toBe(false);
  });
});
