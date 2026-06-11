import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { loadPolicyBundle } from "./loadPolicyBundle";

describe("loadPolicyBundle", () => {
  it("loads manifest, policies, and system prompt for intel-interpreter", async () => {
    const repoRoot = join(import.meta.dirname, "../../..");
    const bundle = await loadPolicyBundle(repoRoot, "intel-interpreter", "1.0.0");

    expect(bundle.agentId).toBe("intel-interpreter");
    expect(bundle.version).toBe("1.0.0");
    expect(bundle.policies["attribution.json"]?.rules?.length).toBeGreaterThan(0);
    expect(bundle.policies["grounding.json"]?.requiresGroundingValidation).toBe(true);
    expect(bundle.systemPrompt?.length).toBeGreaterThan(20);
    expect(bundle.outputSchema).toContain("observedFactsUsed");
  });
});
