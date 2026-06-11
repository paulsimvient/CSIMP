import { randomUUID } from "node:crypto";
import type {
  ActorBackend,
  ActorCriticRound,
  ActorCriticSession,
  ActorCriticSessionStatus,
} from "../../src/types/actorCritic";
import type { AgentPatchProposal } from "../../src/types/proposal";
import type { AuditLog } from "./auditLog";
import { reviseProposal, seedProposalFromObjective } from "./actor";
import { critiqueProposal } from "./critic";
import { safeParseAgentPatchProposal } from "./proposalSchema";

export type ActorCriticInput = {
  /** Initial proposal JSON, or omit to seed from objective. */
  rawProposal?: unknown;
  objective?: string;
  evidenceRefs?: string[];
  targetAgentId?: string;
  baseAgentVersion?: string;
  baseCommitSha?: string;
  maxRounds?: number;
  actorBackend?: ActorBackend;
  productionVersion?: string;
  candidateVersion?: string;
  skipEval?: boolean;
  skipShadow?: boolean;
};

export type ActorCriticOptions = {
  repoRoot: string;
  auditLog?: AuditLog;
};

const DEFAULT_MAX_ROUNDS = 5;

export async function runActorCriticLoop(
  input: ActorCriticInput,
  options: ActorCriticOptions
): Promise<ActorCriticSession> {
  const sessionId = randomUUID().slice(0, 12);
  const maxRounds = input.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const actorBackend = input.actorBackend ?? "hybrid";
  const rounds: ActorCriticRound[] = [];

  let proposal: AgentPatchProposal | undefined;

  if (input.rawProposal) {
    const parsed = safeParseAgentPatchProposal(input.rawProposal);
    if (!parsed.success) {
      return {
        sessionId,
        targetAgentId: input.targetAgentId ?? "unknown",
        status: "schema-invalid",
        maxRounds,
        actorBackend,
        rounds: [],
        summary: `Initial proposal failed schema: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      };
    }
    proposal = parsed.data;
  } else if (input.objective && input.targetAgentId && input.baseAgentVersion) {
    proposal = seedProposalFromObjective({
      sessionId,
      agentId: input.targetAgentId,
      baseVersion: input.baseAgentVersion,
      baseCommitSha: input.baseCommitSha ?? "0000000",
      objective: input.objective,
      evidenceRefs: input.evidenceRefs ?? ["manual-evolve-request"],
    });
  } else {
    return {
      sessionId,
      targetAgentId: input.targetAgentId ?? "unknown",
      status: "schema-invalid",
      maxRounds,
      actorBackend,
      rounds: [],
      summary: "Provide rawProposal or objective + targetAgentId + baseAgentVersion.",
    };
  }

  const targetAgentId = proposal.targetAgentId;
  let status: ActorCriticSessionStatus = "max-rounds";
  let finalProposal: AgentPatchProposal | undefined;

  await options.auditLog?.append({
    type: "actor-critic-started",
    proposalId: proposal.proposalId,
    detail: { sessionId, maxRounds, actorBackend, targetAgentId },
  });

  for (let round = 1; round <= maxRounds; round += 1) {
    const critic = await critiqueProposal(proposal, {
      repoRoot: options.repoRoot,
      round,
      productionVersion: input.productionVersion ?? proposal.baseAgentVersion,
      candidateVersion: input.candidateVersion,
      simulatedCandidateVersion: bumpPatchVersion(proposal.baseAgentVersion, round),
      releaseId: `ac-${sessionId}`,
      skipEval: input.skipEval ?? round < maxRounds,
      skipShadow: input.skipShadow ?? round < maxRounds - 1,
    });

    await options.auditLog?.append({
      type: "critic-report",
      proposalId: proposal.proposalId,
      detail: {
        sessionId,
        round,
        passed: critic.passed,
        score: critic.score,
        findingCount: critic.findings.length,
      },
    });

    const roundRecord: ActorCriticRound = { round, proposal, critic };

    if (critic.passed) {
      rounds.push(roundRecord);
      status = "converged";
      finalProposal = proposal;
      break;
    }

    if (round >= maxRounds) {
      rounds.push(roundRecord);
      break;
    }

    const actor = await reviseProposal(
      {
        sessionId,
        round,
        objective: proposal.objective,
        evidenceRefs: proposal.evidenceRefs,
        priorProposal: proposal,
        criticReport: critic,
      },
      actorBackend,
      { repoRoot: options.repoRoot }
    );

    roundRecord.actor = actor;
    rounds.push(roundRecord);

    await options.auditLog?.append({
      type: "actor-revision",
      proposalId: proposal.proposalId,
      detail: {
        sessionId,
        round,
        revised: actor.revised,
        backend: actor.backend,
        notes: actor.notes,
        stallReason: actor.stallReason,
      },
    });

    if (!actor.revised || !actor.proposal) {
      status = "stalled";
      break;
    }

    const reparsed = safeParseAgentPatchProposal(actor.proposal);
    if (!reparsed.success) {
      status = "stalled";
      break;
    }
    proposal = reparsed.data;
  }

  if (status === "max-rounds" && finalProposal) {
    status = "converged";
  }

  const summary = buildSessionSummary(status, rounds, finalProposal);

  await options.auditLog?.append({
    type: "actor-critic-completed",
    proposalId: finalProposal?.proposalId ?? proposal.proposalId,
    detail: { sessionId, status, roundCount: rounds.length, summary },
  });

  return {
    sessionId,
    targetAgentId,
    status,
    maxRounds,
    actorBackend,
    rounds,
    finalProposal,
    summary,
  };
}

function bumpPatchVersion(version: string, round: number): string {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return `${version}-r${round}`;
  return `${match[1]}.${match[2]}.${Number(match[3]) + round}`;
}

function buildSessionSummary(
  status: ActorCriticSessionStatus,
  rounds: ActorCriticRound[],
  finalProposal?: AgentPatchProposal
): string {
  const lastCritic = rounds.at(-1)?.critic;
  const score = lastCritic?.score.toFixed(2) ?? "n/a";
  switch (status) {
    case "converged":
      return `Converged in ${rounds.length} round(s) with critic score ${score}. Final proposal: ${finalProposal?.proposalId ?? "none"}.`;
    case "stalled":
      return `Actor stalled after ${rounds.length} round(s); critic score ${score}. Human review required.`;
    case "schema-invalid":
      return "Initial proposal invalid — no critic rounds executed.";
    default:
      return `Reached max rounds (${rounds.length}); critic score ${score}. Human review required.`;
  }
}
