import { describe, expect, it } from "vitest";
import { ATOMIC_LAB_CATALOG } from "./atomicCatalog";
import {
  LabHarnessValidationError,
  validateHarnessResponse,
} from "./labHarnessValidation";

describe("validateHarnessResponse", () => {
  const requested = ATOMIC_LAB_CATALOG.slice(0, 2);

  it("accepts one outcome per requested test", () => {
    const outcomes = validateHarnessResponse(requested, {
      outcomes: requested.map((test) => ({
        testId: test.testId,
        name: test.name,
        techniqueId: test.techniqueId,
        executed: true,
        detectionObserved: true,
      })),
    });

    expect(outcomes).toHaveLength(requested.length);
  });

  it("rejects unexpected test IDs", () => {
    expect(() =>
      validateHarnessResponse(requested, {
        outcomes: [
          {
            testId: "T1003.001",
            name: "LSASS Memory",
            techniqueId: "T1003",
            executed: true,
            detectionObserved: true,
          },
        ],
      })
    ).toThrow(LabHarnessValidationError);
  });

  it("rejects duplicate test IDs", () => {
    expect(() =>
      validateHarnessResponse([requested[0]!], {
        outcomes: [
          {
            testId: requested[0]!.testId,
            name: requested[0]!.name,
            techniqueId: requested[0]!.techniqueId,
            executed: true,
            detectionObserved: false,
          },
          {
            testId: requested[0]!.testId,
            name: requested[0]!.name,
            techniqueId: requested[0]!.techniqueId,
            executed: true,
            detectionObserved: true,
          },
        ],
      })
    ).toThrow(LabHarnessValidationError);
  });

  it("rejects techniqueId mismatches", () => {
    expect(() =>
      validateHarnessResponse([requested[0]!], {
        outcomes: [
          {
            testId: requested[0]!.testId,
            name: requested[0]!.name,
            techniqueId: "T9999",
            executed: true,
            detectionObserved: true,
          },
        ],
      })
    ).toThrow(LabHarnessValidationError);
  });
});
