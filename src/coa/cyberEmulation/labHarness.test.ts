import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    vi.stubEnv("VITE_CYBER_LAB_HARNESS_URL", "");
    vi.stubEnv("VITE_CYBER_LAB_USE_SERVER_PROXY", "");
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

  it("rejects HTTP harness responses with unexpected test IDs", async () => {
    vi.stubEnv("VITE_CYBER_LAB_HARNESS_URL", "http://lab-harness.test/run");
    vi.stubEnv("VITE_CYBER_ALLOW_IN_PROCESS_LAB", "");
    const tests = selectAtomicTestsForTechniques(["T1110"]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          outcomes: [
            {
              testId: "T1003.001",
              name: "LSASS Memory",
              techniqueId: "T1003",
              executed: true,
              detectionObserved: true,
            },
          ],
        }),
        body: null,
        text: async () =>
          JSON.stringify({
            outcomes: [
              {
                testId: "T1003.001",
                name: "LSASS Memory",
                techniqueId: "T1003",
                executed: true,
                detectionObserved: true,
              },
            ],
          }),
      }))
    );

    await expect(
      executeLabAtomicTests({
        coaId: "coa-harness",
        citedFactIds: ["fact_cyber_001"],
        validatedActionIds: ["ia_1"],
        tests,
      })
    ).rejects.toBeInstanceOf(LabHarnessUnavailableError);

    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
});
