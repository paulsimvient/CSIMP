import { describe, expect, it } from "vitest";
import { runIntelInterpreterStub } from "./index";

describe("intelInterpreter agent module", () => {
  it("returns deterministic interpretation ref from fact ids", () => {
    const result = runIntelInterpreterStub({
      packetId: "pkt-001",
      factIds: ["fact_uas_001", "fact_cyber_001"],
    });
    expect(result.interpretationRef).toBe("stub-pkt-001-2-facts");
  });
});
