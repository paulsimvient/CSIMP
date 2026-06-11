import type { AgentPatchProposal } from "./proposal";
import type { EvaluationRunRecord } from "./release";
import type { ShadowComparisonResult } from "./shadow";

/** Deterministic evaluation dimensions — the critic never self-promotes. */
export type CriticDimension =
  | "schema"
  | "policy-path"
  | "static-analysis"
  | "policy-coherence"
  | "regression-eval"
  | "shadow-safety";

export type CriticSeverity = "blocker" | "warning" | "info";

export type CriticFinding = {
  dimension: CriticDimension;
  severity: CriticSeverity;
  /** Stable code for the revision actor to map remediations. */
  code: string;
  message: string;
  remediation?: string;
  evidence?: Record<string, unknown>;
};

export type CriticReport = {
  round: number;
  proposalId: string;
  passed: boolean;
  /** Composite quality score in [0, 1] — used by actor to prioritize fixes. */
  score: number;
  findings: CriticFinding[];
  evalRuns: EvaluationRunRecord[];
  shadowComparisons?: ShadowComparisonResult[];
};

export type ActorBackend = "deterministic" | "llm" | "hybrid";

export type ActorRevisionContext = {
  sessionId: string;
  round: number;
  objective: string;
  evidenceRefs: string[];
  priorProposal: AgentPatchProposal;
  criticReport: CriticReport;
};

export type ActorRevisionResult = {
  revised: boolean;
  proposal?: AgentPatchProposal;
  backend: ActorBackend;
  notes: string[];
  /** When the actor cannot improve further. */
  stallReason?: string;
};

export type ActorCriticRound = {
  round: number;
  proposal: AgentPatchProposal;
  critic: CriticReport;
  actor?: ActorRevisionResult;
};

export type ActorCriticSessionStatus =
  | "converged"
  | "max-rounds"
  | "stalled"
  | "schema-invalid";

export type ActorCriticSession = {
  sessionId: string;
  targetAgentId: string;
  status: ActorCriticSessionStatus;
  maxRounds: number;
  actorBackend: ActorBackend;
  rounds: ActorCriticRound[];
  finalProposal?: AgentPatchProposal;
  /** Human-readable summary of what the loop accomplished. */
  summary: string;
};
