/**
 * Doctrine Forge — proof-carrying agent evolution types.
 * Host platform owns safetyEnvelope; agents may evolve doctrine/cognition/capabilities only.
 */

export type GenomeLayer =
  | "prompt"
  | "policy"
  | "workflow"
  | "tool"
  | "isolated-source";

export type GoalRule = {
  id: string;
  statement: string;
};

export type PriorityRule = {
  id: string;
  domain: string;
  weight: number;
};

export type EscalationRule = {
  id: string;
  trigger: string;
  action: string;
};

export type AuthorityRule = {
  id: string;
  authority: string;
  ceiling: "observe" | "recommend" | "requires-approval" | "forbidden";
};

export type OperationalInvariant = {
  id: string;
  label: string;
  /** Host-owned — not evolvable by agents. */
  hostOwned: true;
  category:
    | "fact-provenance"
    | "authority"
    | "grounding"
    | "logistics"
    | "cyber-allowlist"
    | "attribution";
};

export type ForbiddenTransition = {
  id: string;
  from: string;
  to: string;
  reason: string;
};

export type AuthorityCeiling = {
  maxActionType: "observe" | "recommend" | "coordinate";
  forbiddenDomains: string[];
};

/** Composable agent representation — separately evolvable layers. */
export type AgentGenome = {
  identity: {
    agentId: string;
    lineageId: string;
    generation: number;
    parentVersions: string[];
  };
  doctrine: {
    goals: GoalRule[];
    priorities: PriorityRule[];
    escalationRules: EscalationRule[];
    authorityConstraints: AuthorityRule[];
  };
  cognition: {
    promptBundle: string;
    workflowGraphId?: string;
    toolSelectionPolicyId?: string;
    uncertaintyPolicyId?: string;
  };
  capabilities: {
    toolIds: string[];
    isolatedModulePaths: string[];
  };
  /** Host platform safety envelope — agents may NOT mutate this layer. */
  safetyEnvelope: {
    invariants: OperationalInvariant[];
    forbiddenTransitions: ForbiddenTransition[];
    authorityCeiling: AuthorityCeiling;
  };
};

export type Predicate = {
  id: string;
  expression: string;
  description: string;
};

export type CausalTrace = {
  traceId: string;
  scenarioRef: string;
  failureClass: string;
  summary: string;
  minimalCounterexample: string;
  violatedInvariantIds: string[];
  groundingIssueKinds: string[];
  evidenceRefs: string[];
  observedAt: string;
};

export type AssumptionMutation = {
  field: string;
  prior: string;
  next: string;
};

export type AmbiguityInjection = {
  id: string;
  description: string;
  affectedFactIds: string[];
};

export type AdversarialSignal = {
  id: string;
  signalType: string;
  description: string;
};

export type ScenarioMutation = {
  mutationId: string;
  baseScenarioId: string;
  mutator: string;
  label: string;
  changedAssumptions: AssumptionMutation[];
  injectedAmbiguities: AmbiguityInjection[];
  adversarialSignals: AdversarialSignal[];
  expectedInvariantChecks: string[];
  difficultyScore: number;
  /** Synthetic — must be marked in forged scenario packets. */
  synthetic: true;
};

/** Minimal scenario packet shape for forge artifacts (full type in src/intel/types). */
export type ScenarioPacketLike = {
  commanderIntent: string;
  observedFacts: Array<{ id: string; domain: string; confidence: string; [key: string]: unknown }>;
  knownAssets: string[];
  knownAuthorities?: Record<string, string>;
  constraints: string[];
  contextWindow?: string;
  agentSystemPrompt?: string;
  agentOutputSchema?: string;
  agentId?: string;
  agentVersion?: string;
  moduleEntrypoint?: string;
  /** Set true for Scenario Forge outputs. */
  synthetic?: boolean;
  forgeMetadata?: {
    mutationId: string;
    baseScenarioId: string;
    mutator: string;
  };
};

export type LLMInterpretationLike = {
  observedFactsUsed: string[];
  inferences: Array<{ claim: string; supportingFacts: string[]; confidence: string }>;
  candidateActions: Array<{ id: string; citedFacts: string[]; confidence?: string; [key: string]: unknown }>;
  decisionPoints: unknown[];
  assumptions: unknown[];
  uncertainties: unknown[];
};

export type ForgedScenario = {
  scenarioId: string;
  mutation: ScenarioMutation;
  packet: ScenarioPacketLike;
};

export type DoctrineFossil = {
  fossilId: string;
  firstObservedAt: string;
  scenarioRef: string;
  failureClass: string;
  causalTrace: CausalTrace;
  /** Reject candidates that match this predicate. */
  prohibitedRegressionPredicate: Predicate;
  fixedByReleaseId?: string;
  derivedScenarioIds: string[];
  agentId: string;
};

export type MissionDomain = "cyber" | "maritime" | "air" | "logistics";

export type MissionEnvelope = {
  envelopeId: string;
  label: string;
  validFor: {
    scenarioClasses: string[];
    domains: MissionDomain[];
    authorityProfiles: string[];
    confidenceRange: [number, number];
  };
  invalidWhen: Predicate[];
  evidenceBundleId?: string;
};

export type InvariantResult = {
  invariantId: string;
  passed: boolean;
  violations: string[];
};

export type ReplayResult = {
  scenarioId: string;
  mutationId: string;
  passed: boolean;
  invariantResults: InvariantResult[];
  blockingIssues: number;
};

export type TournamentResult = {
  variantId: string;
  agentVersion: string;
  wins: number;
  losses: number;
  unresolvedFailures: string[];
};

export type MutationSummary = {
  layersChanged: GenomeLayer[];
  filesChanged: number;
  rulesAdded: number;
  description: string;
};

export type AgentLineage = {
  agentId: string;
  lineageId: string;
  generation: number;
  parentVersion: string;
};

export type CapabilityPassport = {
  passportId: string;
  releaseId?: string;
  agentId: string;
  agentVersion: string;
  lineage: AgentLineage;
  parentVersion: string;
  mutationSummary: MutationSummary;

  triggeringEvidence: string[];
  counterexamplesResolved: string[];
  fossilIds: string[];

  invariantResults: InvariantResult[];
  scenarioReplayResults: ReplayResult[];
  adversarialTournamentResults: TournamentResult[];

  newlySupportedMissionEnvelopes: MissionEnvelope[];
  degradedMissionEnvelopes: MissionEnvelope[];

  worldsSurvived: number;
  worldsGenerated: number;

  unresolvedRisks: Array<{ id: string; description: string; severity: "low" | "medium" | "high" }>;
  rollbackTarget: string;

  reviewerApprovals: Array<{
    reviewerId: string;
    decision: "approved" | "rejected";
    timestamp: string;
    justification?: string;
  }>;

  /** Stable hash of passport payload — machine-checkable evidence anchor. */
  signature: string;
  issuedAt: string;
};

export type MutationBudget = {
  agentId: string;
  lineageId: string;
  maxFilesChanged: number;
  maxLinesChanged: number;
  allowedGenomeLayers: GenomeLayer[];
  maxNewTools: number;
  maxNewNetworkPrivileges: 0;
  trustTier: "unproven" | "trusted" | "highly-trusted";
  expiry: string;
};

export type OperationalFailureInput = {
  agentId: string;
  scenarioRef: string;
  scenarioPacket: ScenarioPacketLike;
  interpretation: LLMInterpretationLike;
  evidenceRefs?: string[];
};

export type RecordFailureResult = {
  fossil: DoctrineFossil;
  causalTrace: CausalTrace;
  forgedScenarios: ForgedScenario[];
};

export type RedTeamChallenge = {
  challengeId: string;
  baseScenarioId: string;
  assumptionAttacked: string;
  adversarialSignals: AdversarialSignal[];
  forgedScenarios: ForgedScenario[];
  difficultyScore: number;
};

export type DoctrineVariant = {
  variantId: string;
  label: string;
  agentVersion: string;
  policyChanges: Array<{ path: string; operation: string; rule?: string }>;
};

export type TournamentSession = {
  sessionId: string;
  agentId: string;
  baseVersion: string;
  scenariosEvaluated: number;
  results: TournamentResult[];
  winnerVariantId?: string;
  ranAt: string;
};

export type CoaCounterexample = {
  counterexampleId: string;
  coaRef?: string;
  blockers: string[];
  minimalExplanation: string;
  generalizedDoctrine: string;
  failureClass: string;
};

export type EnvelopeRouteRecord = {
  agentId: string;
  defaultVersion: string;
  routes: Array<{
    envelopeClass: string;
    version: string;
    releaseId?: string;
    passportId?: string;
    label: string;
  }>;
  updatedAt: string;
};

export type LineageTrustRecord = {
  agentId: string;
  lineageId: string;
  generation: number;
  trustTier: MutationBudget["trustTier"];
  productionReleases: number;
  passportsIssued: number;
  shadowDaysSurvived: number;
};
