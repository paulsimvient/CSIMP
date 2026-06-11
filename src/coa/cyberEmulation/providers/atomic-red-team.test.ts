import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cyberExecutionBadgeLabel } from "../executionMode";
import { selectAtomicTestsForTechniques } from "../atomicCatalog";
import { mapActionsToTechniques } from "../techniqueMap";
import { atomicRedTeamProvider } from "./atomic-red-team";

const baseRequest = {
  coaId: "coa-lab-1",
  validatedActionIds: ["ia_cyber"],
  citedFactIds: ["fact_cyber_001"],
  actionDescriptions: ["Investigate authentication anomalies"],
  actionTypes: ["cyber"],
  provider: "atomic-red-team" as const,
  humanApproved: true,
  labEnvironmentConfirmed: true,
};

describe("atomicRedTeamProvider", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_CYBER_LAB_HARNESS_URL", "");
    vi.stubEnv("VITE_CYBER_LAB_USE_SERVER_PROXY", "");
    vi.stubEnv("VITE_CYBER_ALLOW_IN_PROCESS_LAB", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns in-process-simulation when harness falls back in-process", async () => {
    const result = await atomicRedTeamProvider(baseRequest);

    expect(result.executionMode).toBe("in-process-simulation");
    expect(result.provider).toBe("atomic-red-team");
    expect(result.atomicTestsExecuted?.length).toBeGreaterThan(0);
    expect(result.evidenceRefs.some((r) => r.startsWith("atomic:"))).toBe(true);
    expect(cyberExecutionBadgeLabel(result.executionMode)).not.toBe("LAB EXECUTED");
  });

  it("returns lab-unavailable when harness is unreachable and fallback disabled", async () => {
    vi.stubEnv("VITE_CYBER_ALLOW_IN_PROCESS_LAB", "");

    const result = await atomicRedTeamProvider(baseRequest);

    expect(result.executionMode).toBe("lab-unavailable");
    expect(cyberExecutionBadgeLabel(result.executionMode)).toBe("LAB UNAVAILABLE");
    expect(cyberExecutionBadgeLabel(result.executionMode)).not.toBe("LAB EXECUTED");
    expect(result.atomicTestsExecuted ?? []).toHaveLength(0);
  });

  it("returns lab-executed only after confirmed HTTP harness success", async () => {
    vi.stubEnv("VITE_CYBER_LAB_HARNESS_URL", "http://lab-harness.test/run");
    vi.stubEnv("VITE_CYBER_ALLOW_IN_PROCESS_LAB", "");

    const techniques = mapActionsToTechniques(
      baseRequest.actionDescriptions,
      baseRequest.actionTypes
    );
    const expectedTests = selectAtomicTestsForTechniques(
      techniques.map((technique) => technique.techniqueId)
    );
    expect(expectedTests.length).toBeGreaterThan(0);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        body: null,
        text: async () =>
          JSON.stringify({
            outcomes: expectedTests.map((test) => ({
              testId: test.testId,
              name: test.name,
              techniqueId: test.techniqueId,
              executed: true,
              detectionObserved: true,
            })),
          }),
      }))
    );

    const result = await atomicRedTeamProvider(baseRequest);

    expect(result.executionMode).toBe("lab-executed");
    expect(cyberExecutionBadgeLabel(result.executionMode)).toBe("LAB EXECUTED");
  });

  it("returns lab-unavailable when HTTP harness fetch fails", async () => {
    vi.stubEnv("VITE_CYBER_LAB_HARNESS_URL", "http://lab-harness.test/run");
    vi.stubEnv("VITE_CYBER_ALLOW_IN_PROCESS_LAB", "");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      })
    );

    const result = await atomicRedTeamProvider(baseRequest);

    expect(result.executionMode).toBe("lab-unavailable");
    expect(cyberExecutionBadgeLabel(result.executionMode)).not.toBe("LAB EXECUTED");
  });

  it("returns lab-unavailable when HTTP harness returns invalid test IDs", async () => {
    vi.stubEnv("VITE_CYBER_LAB_HARNESS_URL", "http://lab-harness.test/run");
    vi.stubEnv("VITE_CYBER_ALLOW_IN_PROCESS_LAB", "");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
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

    const result = await atomicRedTeamProvider(baseRequest);

    expect(result.executionMode).toBe("lab-unavailable");
    expect(result.atomicTestsExecuted ?? []).toHaveLength(0);
  });
});
