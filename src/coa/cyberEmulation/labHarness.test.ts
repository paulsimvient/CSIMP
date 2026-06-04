import { describe, expect, it, vi } from "vitest";
import { selectAtomicTestsForTechniques } from "./atomicCatalog";
import { executeLabAtomicTests } from "./labHarness";
import { LabHarnessUnavailableError } from "./types";

describe("executeLabAtomicTests", () => {
  it("executes allowlisted tests in-process deterministically", async () => {
    const tests = selectAtomicTestsForTechniques(["T1110", "T1078"]);
    const result = await executeLabAtomicTests(
      {
        coaId: "coa-harness",
        citedFactIds: ["fact_cyber_001"],
        validatedActionIds: ["ia_1"],
        tests,
      },
      { allowInProcess: true }
    );

    expect(result.outcomes.length).toBeGreaterThan(0);
    expect(result.outcomes.every((o) => o.harness === "in-process")).toBe(true);
    expect(result.expectedDetections.length).toBeGreaterThan(0);
  });

  it("fails closed without harness URL when in-process fallback is disabled", async () => {
    vi.stubEnv("VITE_CYBER_ALLOW_IN_PROCESS_LAB", "");
    const tests = selectAtomicTestsForTechniques(["T1110"]);
    await expect(
      executeLabAtomicTests({
        coaId: "coa-harness",
        citedFactIds: ["fact_cyber_001"],
        validatedActionIds: ["ia_1"],
        tests,
      })
    ).rejects.toBeInstanceOf(LabHarnessUnavailableError);
    vi.unstubAllEnvs();
  });
});
