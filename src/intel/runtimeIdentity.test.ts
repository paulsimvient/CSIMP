import { describe, expect, it } from "vitest";
import { hashStableJson, buildAgentRuntimeProvenance } from "./runtimeIdentity";

describe("runtimeIdentity", () => {
  it("produces stable hashes for equivalent object key order", () => {
    const a = hashStableJson({ b: 1, a: 2 });
    const b = hashStableJson({ a: 2, b: 1 });
    expect(a).toBe(b);
  });

  it("builds provenance with input and output hashes", () => {
    const provenance = buildAgentRuntimeProvenance({
      agentId: "intel-interpreter",
      agentVersion: "1.0.0",
      releaseId: "rel-1",
      packet: { commanderIntent: "test", observedFacts: [] },
      interpretation: { observedFactsUsed: [], inferences: [], decisionPoints: [], assumptions: [], uncertainties: [], candidateActions: [] },
    });
    expect(provenance.inputHash).toHaveLength(16);
    expect(provenance.outputHash).toHaveLength(16);
    expect(provenance.inputHash).not.toBe(provenance.outputHash);
  });
});
