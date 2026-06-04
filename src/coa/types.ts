// ─── Identifiers ─────────────────────────────────────────────────────────────

export type CoaId = string;
export type ActionId = string;
export type RunId = string;
export type SignalId = string;

// ─── Actions ─────────────────────────────────────────────────────────────────

export type ScheduleAdjustment = {
  actionId: string;
  asset: string;
  originalStartSec: number;
  adjustedStartSec: number;
  reason: string;
};

export type ScheduleBundleResult =
  | { ok: true; actions: CoaAction[]; adjustments: ScheduleAdjustment[] }
  | {
      ok: false;
      reason: string;
      asset: string;
      actionIds: string[];
    };

export type CoaAction = {
  id: ActionId;
  name: string;
  type: string;
  /** Absolute start time in seconds from T0 */
  startTime: number;
  /** Duration in seconds */
  duration: number;
  /** Resource identifiers consumed by this action */
  resources: readonly string[];
};

// ─── Signals ─────────────────────────────────────────────────────────────────

export type Signal = {
  id: SignalId;
  type: string;
  value: unknown;
  timestamp: number;
  /** Originating intel fact ID, if this signal came from the intel layer */
  factId?: string;
};

// ─── Logistics ───────────────────────────────────────────────────────────────

export type LogisticsDependencyKind =
  | "requires-completion"
  | "uses-live-feed"
  | "shares-evidence";

export type TypedLogisticsDependency = {
  chipId: string;
  kind: LogisticsDependencyKind;
};

export type LogisticsChip = {
  id: string;
  actionId: ActionId;
  label: string;
  laneId: string;
  /** Offset in seconds from T0 */
  startOffset: number;
  /** Duration in seconds */
  duration: number;
  /** IDs of chips this chip depends on */
  dependencies: string[];
  /** Semantic type for each cross-lane dependency (same order as added entries). */
  typedDependencies?: TypedLogisticsDependency[];
  /** Grounded facts supporting this logistics action (map + orders linkage). */
  citedFactIds?: string[];
  linkedFactIds?: string[];
  resourceIds?: string[];
  actionType?: string;
  sceneEntities?: string[];
  sceneDomains?: string[];
  sceneSummary?: string;
  /** When true, matrix shows a provisional card with timing required. */
  timingUncertain?: boolean;
};

export type LogisticsLane = {
  id: string;
  label: string;
  /** Ordered chip IDs belonging to this lane */
  chipIds: string[];
};

export type PlanSource = "validated-intel" | "demo";

export type LogisticsPlan =
  | { kind: "empty"; reason: "no-actions" | "unsat" | "not-built" }
  | {
      kind: "populated";
      source: PlanSource;
      /** The COA this plan belongs to — must match CoaCandidate.id */
      coaId: CoaId;
      lanes: LogisticsLane[];
      chips: LogisticsChip[];
      /** Total plan duration in seconds */
      totalDuration: number;
    };

// ─── Effects ─────────────────────────────────────────────────────────────────

export type CyberEffectsAnnotation = {
  provider: import("./cyberEmulation/types").CyberEmulationProvider;
  executionMode: import("./cyberEmulation/types").CyberEmulationExecutionMode;
  residualRisk: number;
  confidence: number;
  techniquesEvaluated: import("./cyberEmulation/types").AttckTechniqueRef[];
  evidenceRefs: string[];
  validatedActionIds: string[];
  citedFactIds: string[];
  explanation: string;
  atomicTestsExecuted?: import("./cyberEmulation/types").AtomicTestExecution[];
};

export type EffectsEstimationMethod = "deterministic-heuristic";

export type EffectsSummary = {
  expectedImpact: number;
  confidence: number;
  /** Estimated time in seconds until effects are realized */
  timeToEffect: number;
  explanation: string;
  risks: string[];
  /** Prototype scoring method — not a validated operational prediction. */
  estimationMethod: EffectsEstimationMethod;
  isValidatedPrediction: false;
  /** Present when cyber-relevant actions were evaluated via the emulation adapter. */
  cyberEffects?: CyberEffectsAnnotation;
};

export type EffectsResult = {
  /** References an existing CoaCandidate.id — never creates a new one */
  coaId: CoaId;
  summary: EffectsSummary;
  score: number;
  risk: number;
  explanation: string;
};

// ─── Scores ──────────────────────────────────────────────────────────────────

export type CoaScores = {
  feasibility: number;
  logistics: number;
  effects: number;
  risk: number;
  overall: number;
};

export type IntelFidelityScore = {
  urgency: number;
  confidence: number;
  resourcePressure: number;
  alignment: number;
  effectsAdjustment: number;
  riskAdjustment: number;
  focusTypes: string[];
  matchedActionTypes: string[];
};

// ─── COA Candidate ───────────────────────────────────────────────────────────

/**
 * The single canonical object for a course of action.
 *
 * This type is the source of truth. It owns:
 *   - its selected actions (from the solver)
 *   - its logistics plan (from the logistics builder)
 *   - its effects annotation (from the effects engine)
 *   - its scores (derived from all of the above)
 *
 * No separate global logistics state should exist.
 * Effects annotate this object; they do not replace it.
 */
export type ConstraintTrace = {
  hard: {
    id: string;
    label: string;
    satisfied: boolean;
    reason: string;
    evidence?: string[];
  }[];
  soft: {
    id: string;
    label: string;
    score: number;
    weight: number;
    reason: string;
  }[];
};

export type RankingExplanation = {
  coaId: CoaId;
  rank: number;
  totalScore: number;
  components: {
    feasibility: number;
    effects: number;
    logistics: number;
    risk: number;
    intelFidelity?: number;
    parsimony: number;
  };
  tieBreakersApplied: string[];
  reason: string;
};

export type CoaRunMetadata = {
  scenarioId?: string;
  scenarioVersion?: string;
  constraintsVersion: string;
  scoringVersion: string;
  solverVersion: string;
  generatedAt: string;
  cyberEmulationProvider?: import("./cyberEmulation/types").CyberEmulationProvider;
  cyberEmulationExecutionMode?: import("./cyberEmulation/types").CyberEmulationExecutionMode;
};

export type RankingSensitivity = {
  confidence: "high" | "medium" | "low";
  reason: string;
  fragilePairs: Array<{
    leaderId: CoaId;
    challengerId: CoaId;
    flipCondition: string;
    scoreGap: number;
  }>;
};

export type CoaOrigin =
  | "automated"
  | "operator-authored"
  | "operator-modified"
  | "imported";

export type CoaValidationStatus = "unvalidated" | "validated" | "stale";

export type CoaCandidateStatus =
  | "sat"
  | "unsat"
  | "error"
  | "insufficient_evidence"
  | "draft"
  | "incomplete"
  | "validating"
  | "stale";

export type CoaCandidate = {
  id: CoaId;
  runId: RunId;
  /** Defaults to automated when omitted (legacy snapshots). */
  origin?: CoaOrigin;
  revisionId?: string;
  parentCoaId?: CoaId;
  validationStatus?: CoaValidationStatus;
  status: CoaCandidateStatus;
  label: string;
  selectedActions: CoaAction[];
  /**
   * Owned by this candidate. If status is "sat" and selectedActions.length > 0,
   * this must be kind "populated". See assertCoaState.
   */
  logisticsPlan: LogisticsPlan;
  /**
   * Populated after effects analysis runs. Undefined until then.
   * Effects engine writes here, never to logisticsPlan.
   */
  effects?: EffectsSummary;
  intelFidelity?: IntelFidelityScore;
  constraintTrace?: ConstraintTrace;
  dominatedBy?: CoaId;
  rankingExplanation?: RankingExplanation;
  scores: CoaScores;
  validation?: CoaValidationRecord;
  validatedOrderSet?: ValidatedOrderSet;
  /** Set when validation fails — surfaced in UI and execute gate. */
  validationBlockers?: string[];
};

export type CoaValidationRecord = {
  validatedAt: string;
  constraintsVersion: string;
  scoringVersion: string;
  evidenceSnapshotId: string;
  blockers: string[];
};

export type ValidatedOrderSetTask = {
  id: string;
  actionId: string;
  label: string;
  startSec: number;
  durationSec: number;
  rowKey?: string;
  actor?: string;
  target?: string;
  actionVerb?: string;
  status: string;
  origin: string;
  dependencies: string[];
  targetFactIds?: string[];
  isManual: boolean;
};

export type ValidatedOrderSet = {
  revisionId: string;
  actionCount: number;
  tasks: ValidatedOrderSetTask[];
};

// ─── Pipeline State ───────────────────────────────────────────────────────────

/**
 * The entire COA pipeline state. This is what the UI reads from.
 * The UI must never read from any separate logisticsTrailPlan.
 * The matrix renders from:
 *   candidatesById[selectedCoaId].logisticsPlan
 */
export type MatrixBarPatch = Partial<{
  startSec: number;
  durationSec: number;
  status: import("./syncMatrix").SyncBarStatus;
  rowKey: string;
  actor: string;
  target: string;
  subLabel: string;
  actionVerb: string;
}>;

export type MatrixOverlay = {
  revisionId: string;
  manualEntries: import("./manualSync").ManualSyncEntry[];
  barPatches: Record<string, MatrixBarPatch>;
  hiddenBarIds: string[];
  modifiedBarIds: string[];
};

export type PreparedExecution = {
  candidateId: CoaId;
  revisionId: string;
  preparedAt: string;
  label: string;
  origin: CoaOrigin;
  orderSet: ValidatedOrderSet;
  evidenceSnapshotId: string;
};

export type ExecutedCoaSnapshot = {
  candidateId: CoaId;
  revisionId: string;
  label: string;
  origin: CoaOrigin;
  executedAt: string;
  orderSet: ValidatedOrderSet;
  evidenceSnapshotId: string;
};

export type CoaState = {
  activeRunId?: RunId;
  candidatesById: Record<CoaId, CoaCandidate>;
  /** Ordered list of COA IDs, ranked best-first */
  candidateOrder: CoaId[];
  selectedCoaId?: CoaId;
  status: "idle" | "running" | "ready" | "error";
  error?: string;
  runMetadata?: CoaRunMetadata;
  /** Evidence-quality flags from normalized facts (deterministic, not LLM). */
  evidenceConflicts?: import("../intel/evidence").EvidenceConflict[];
  /** Whether top-ranked SAT COAs are fragile to scoring-weight changes. */
  rankingSensitivity?: RankingSensitivity;
  /** Matrix edits keyed to a specific candidate revision — not UI-only overlays. */
  matrixOverlaysByCoaId?: Record<CoaId, MatrixOverlay>;
  /** Frozen revision approved for execution (must match current overlay revision). */
  preparedExecution?: PreparedExecution;
  /** Last committed execution snapshot. */
  executedSnapshot?: ExecutedCoaSnapshot;
};

// ─── Solver I/O ──────────────────────────────────────────────────────────────

export type SolverInput = {
  runId: RunId;
  signals: Signal[];
  mode: "validated-intel" | "demo";
  intelActions?: NonNullable<PipelineInput["intelActions"]>;
};

export type SolverConstraintHard = {
  id: string;
  satisfied: boolean;
  label?: string;
  reason?: string;
  evidence?: string[];
};

export type SolverConstraintSoft = {
  id: string;
  satisfied: boolean;
  weight: number;
  label?: string;
  reason?: string;
  score?: number;
};

export type SolverCandidateResult = {
  status: "sat" | "unsat" | "error" | "insufficient_evidence";
  selectedActions: CoaAction[];
  constraintSatisfaction?: {
    hard: SolverConstraintHard[];
    soft: SolverConstraintSoft[];
  };
};

export type SolverFn = (input: SolverInput) => Promise<SolverCandidateResult[]>;

// ─── Effects I/O ─────────────────────────────────────────────────────────────

export type EffectsEngineContext = {
  intelActions?: PipelineInput["intelActions"];
  cyberEmulation?: import("./cyberEmulation/types").CyberEmulationRunOptions;
};

export type EffectsEngineFn = (
  candidates: CoaCandidate[],
  context?: EffectsEngineContext
) => Promise<Record<CoaId, EffectsResult>>;

// ─── Pipeline I/O ────────────────────────────────────────────────────────────

export type PipelineInput = {
  mode: "validated-intel" | "demo";
  signals?: Signal[];
  scenarioId?: string;
  scenarioVersion?: string;
  /** Normalized facts for evidence conflict detection and traceability. */
  observedFacts?: import("../intel/types").ObservedFact[];
  /**
   * Validated candidate actions from the intel layer.
   * These inform the solver about which action types are relevant to
   * the current situation. The solver still decides which combinations
   * are feasible — intel does not bypass the solver.
   */
  intelActions?: Array<{
    id: string;
    description: string;
    citedFacts: string[];
    actionType?:
      | "observe"
      | "monitor"
      | "investigate"
      | "coordinate"
      | "preserve"
      | "inform"
      | "harden"
      | "other";
    requiredAssets?: string[];
    timeSensitivity?: "immediate" | "time-bound" | "routine";
    confidence?: "low" | "medium" | "high";
  }>;
  /**
   * Optional cyber-effects adapter options (Phase 2 lab validation).
   * Requires human approval + lab confirmation for non-simulated providers.
   */
  cyberEmulation?: import("./cyberEmulation/types").CyberEmulationRunOptions;
};
