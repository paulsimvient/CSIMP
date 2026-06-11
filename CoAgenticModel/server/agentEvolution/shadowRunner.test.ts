import { describe, expect, it } from "vitest";
import { metricsFromVitestReport } from "./shadowRunner";

describe("metricsFromVitestReport", () => {
  it("computes grounding pass rate from vitest json tasks", () => {
    const metrics = metricsFromVitestReport({
      testResults: [
        {
          tasks: [
            { name: "grounding accepts cited facts", state: "pass" },
            { name: "rejects hallucinated fact id", state: "fail", errors: [{ message: "unknown fact id" }] },
            { name: "blocks unsupported action", state: "pass" },
          ],
        },
      ],
    });

    expect(metrics.groundingPassRate).toBeCloseTo(2 / 3);
    expect(metrics.hallucinatedFactIds).toBe(1);
  });
});
