import type { CoaId } from "../types";

/** Provider identifiers — no provider may be invoked from the LLM layer. */
export type CyberEmulationProvider =
  | "simulated"
  | "atomic-red-team"
  | "caldera"
  | "manual-assessment";

export type CyberEmulationExecutionMode =
  | "simulation"
  | "in-process-simulation"
  | "lab-executed"
  | "lab-unavailable";

export class LabHarnessUnavailableError extends Error {
  constructor(message = "External lab harness URL is not configured or unreachable.") {
    super(message);
    this.name = "LabHarnessUnavailableError";
  }
}

export type AttckTechniqueRef = {
  techniqueId: string;
  techniqueName: string;
  tactic: string;
};

export type DetectionExpectation = {
  controlId: string;
  label: string;
  expected: boolean;
  observed?: boolean;
};

export type AtomicTestExecution = {
  testId: string;
  name: string;
  techniqueId: string;
  detectionObserved: boolean;
  harness: "in-process" | "http";
};

/**
 * Result of a cyber-effects evaluation (simulation or lab run).
 * Every field must be traceable to cited facts and validated action IDs.
 */
export type CyberEffectResult = {
  coaId: CoaId;
  validatedActionIds: string[];
  citedFactIds: string[];
  provider: CyberEmulationProvider;
  executionMode: CyberEmulationExecutionMode;
  residualRisk: number;
  confidence: number;
  techniquesEvaluated: AttckTechniqueRef[];
  expectedDetections: DetectionExpectation[];
  observedDetections: DetectionExpectation[];
  explanation: string;
  evidenceRefs: string[];
  /** Phase 2 — Atomic lab tests executed for this run. */
  atomicTestsExecuted?: AtomicTestExecution[];
};

export type CyberEmulationRunOptions = {
  provider?: CyberEmulationProvider;
  humanApproved?: boolean;
  labEnvironmentConfirmed?: boolean;
};

export type CyberEmulationRequest = {
  coaId: CoaId;
  validatedActionIds: string[];
  citedFactIds: string[];
  actionDescriptions: string[];
  actionTypes: string[];
  provider: CyberEmulationProvider;
  /** Required for any non-simulated provider. */
  humanApproved?: boolean;
  /** Required for lab execution providers. */
  labEnvironmentConfirmed?: boolean;
};

export type CyberEmulationPolicyViolation = {
  code:
    | "lab-only-required"
    | "technique-not-allowlisted"
    | "human-approval-required"
    | "production-execution-forbidden"
    | "provider-not-enabled";
  message: string;
};

export class CyberEmulationPolicyError extends Error {
  readonly violation: CyberEmulationPolicyViolation;

  constructor(violation: CyberEmulationPolicyViolation) {
    super(violation.message);
    this.name = "CyberEmulationPolicyError";
    this.violation = violation;
  }
}

export type CyberEmulationProviderFn = (
  request: CyberEmulationRequest
) => Promise<CyberEffectResult>;
