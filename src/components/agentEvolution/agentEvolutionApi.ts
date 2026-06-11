export type AgentSummary = {
  id: string;
  versions: string[];
  productionVersion?: string;
};

export type AgentRelease = {
  releaseId: string;
  agentId: string;
  version: string;
  stage: "shadow" | "canary" | "production";
  proposalId: string;
  evidenceRefs: string[];
  evaluationRuns: Array<{
    suite: string;
    passed: boolean;
    metrics: Record<string, number>;
  }>;
  deployedAt?: string;
  rolledBackAt?: string;
};

export type AuditEvent = {
  id: string;
  type: string;
  timestamp: string;
  proposalId?: string;
  releaseId?: string;
  detail?: Record<string, unknown>;
};

export type PipelineStage =
  | { stage: "schema"; ok: true; proposal: unknown }
  | { stage: "schema"; ok: false; errors: string[] }
  | { stage: "policy"; ok: boolean; errors: string[]; warnings: string[] }
  | { stage: "static-analysis"; ok: boolean; findings: string[] }
  | { stage: "evaluation"; ok: boolean; runs: AgentRelease["evaluationRuns"] }
  | { stage: "promotion"; ok: true; release: AgentRelease }
  | { stage: "promotion"; ok: false; reasons: string[] };

const BASE = "/api/agent-evolution";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
  return body;
}

export function fetchAgents() {
  return request<{ agents: AgentSummary[] }>("/agents");
}

export function fetchReleases() {
  return request<{ releases: AgentRelease[] }>("/releases");
}

export function fetchAudit(params?: { proposalId?: string; releaseId?: string }) {
  const query = new URLSearchParams();
  if (params?.proposalId) query.set("proposalId", params.proposalId);
  if (params?.releaseId) query.set("releaseId", params.releaseId);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request<{ events: AuditEvent[] }>(`/audit${suffix}`);
}

export function validateProposal(input: {
  proposal: unknown;
  nextVersion: string;
  approvals: unknown[];
}) {
  return request<{ stages: PipelineStage[] }>("/proposals/validate", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function processProposal(input: {
  proposal: unknown;
  nextVersion: string;
  approvals: unknown[];
}) {
  return request<{ stages: PipelineStage[]; release?: AgentRelease }>(
    "/proposals/process",
    {
      method: "POST",
      body: JSON.stringify(input),
    }
  );
}

export type CriticFinding = {
  dimension: string;
  severity: "blocker" | "warning" | "info";
  code: string;
  message: string;
  remediation?: string;
};

export type ActorCriticRound = {
  round: number;
  proposal: unknown;
  critic: {
    passed: boolean;
    score: number;
    findings: CriticFinding[];
  };
  actor?: {
    revised: boolean;
    backend: string;
    notes: string[];
    stallReason?: string;
    proposal?: unknown;
  };
};

export type ActorCriticSession = {
  sessionId: string;
  targetAgentId: string;
  status: "converged" | "max-rounds" | "stalled" | "schema-invalid";
  maxRounds: number;
  actorBackend: string;
  rounds: ActorCriticRound[];
  finalProposal?: unknown;
  summary: string;
};

export function evolveProposal(input: {
  proposal?: unknown;
  nextVersion?: string;
  maxRounds?: number;
  actorBackend?: "deterministic" | "llm" | "hybrid";
  skipEval?: boolean;
  skipShadow?: boolean;
  autoProcessOnConverge?: boolean;
  approvals?: unknown[];
}) {
  return request<{
    session: ActorCriticSession;
    processResult?: { stages: PipelineStage[]; release?: AgentRelease };
  }>("/proposals/evolve", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function advanceRelease(
  releaseId: string,
  input: {
    targetStage: "canary" | "production";
    approval: {
      reviewerId: string;
      decision: "approved";
      justification?: string;
    };
  }
) {
  return request<{ release: AgentRelease }>(`/releases/${releaseId}/advance`, {
    method: "POST",
    body: JSON.stringify({
      ...input,
      approval: {
        ...input.approval,
        timestamp: new Date().toISOString(),
      },
    }),
  });
}

export function rollbackRelease(
  releaseId: string,
  input: {
    approval: {
      reviewerId: string;
      decision: "approved";
      justification?: string;
    };
  }
) {
  return request<{ release: AgentRelease }>(`/releases/${releaseId}/rollback`, {
    method: "POST",
    body: JSON.stringify({
      approval: {
        ...input.approval,
        timestamp: new Date().toISOString(),
      },
    }),
  });
}

// ─── Doctrine Forge ───────────────────────────────────────────────────────────

export type DoctrineFossil = {
  fossilId: string;
  firstObservedAt: string;
  scenarioRef: string;
  failureClass: string;
  causalTrace: {
    traceId: string;
    summary: string;
    minimalCounterexample: string;
    failureClass: string;
  };
  derivedScenarioIds: string[];
  agentId: string;
};

export type CapabilityPassport = {
  passportId: string;
  agentId: string;
  agentVersion: string;
  worldsSurvived: number;
  worldsGenerated: number;
  signature: string;
  invariantResults: Array<{ invariantId: string; passed: boolean; violations: string[] }>;
  newlySupportedMissionEnvelopes: Array<{ envelopeId: string; label: string }>;
  unresolvedRisks: Array<{ id: string; description: string; severity: string }>;
  fossilIds: string[];
  counterexamplesResolved: string[];
};

export function fetchDoctrineFossils() {
  return request<{ fossils: DoctrineFossil[] }>("/doctrine/fossils");
}

export function recordDoctrineDemoFailure(agentId = "intel-interpreter") {
  return request<{
    result: {
      fossil: DoctrineFossil;
      causalTrace: DoctrineFossil["causalTrace"];
      forgedScenarios: Array<{ scenarioId: string; mutation: { label: string; mutator: string } }>;
    };
  }>("/doctrine/record-failure", {
    method: "POST",
    body: JSON.stringify({ demo: true, agentId }),
  });
}

export function buildCapabilityPassport(input: {
  agentId: string;
  agentVersion: string;
  parentVersion: string;
  rollbackTarget: string;
  fossilIds?: string[];
}) {
  return request<{
    passport: CapabilityPassport;
    summary: string;
    regressionRejected: boolean;
  }>("/doctrine/passports/build", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchCapabilityPassport(passportId: string) {
  return request<{ passport: CapabilityPassport }>(`/doctrine/passports/${passportId}`);
}

export function runDoctrineTournament(input: {
  agentId: string;
  baseVersion: string;
  fossilIds?: string[];
}) {
  return request<{ session: TournamentSession }>("/doctrine/tournament", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function registerEnvelopeRoute(passportId: string) {
  return request<{ routes: unknown }>("/doctrine/envelope-routes/register", {
    method: "POST",
    body: JSON.stringify({ passportId }),
  });
}

export function fetchMutationBudget(agentId: string) {
  return request<{ budget: MutationBudget }>(`/doctrine/mutation-budget/${agentId}`);
}

export type TournamentSession = {
  sessionId: string;
  agentId: string;
  baseVersion: string;
  scenariosEvaluated: number;
  results: Array<{
    variantId: string;
    agentVersion: string;
    wins: number;
    losses: number;
    unresolvedFailures: string[];
  }>;
  winnerVariantId?: string;
  ranAt: string;
};

export type MutationBudget = {
  agentId: string;
  trustTier: "unproven" | "trusted" | "highly-trusted";
  allowedGenomeLayers: string[];
  maxFilesChanged: number;
  maxLinesChanged: number;
};
