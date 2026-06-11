/**
 * Mutation budgets — agents earn broader evolution scope via lineage trust.
 */

import type { GenomeLayer, MutationBudget } from "../../src/types/doctrine";
import type { AgentPatchProposal } from "../../src/types/proposal";
import type { LineageTrustRecord } from "../../src/types/doctrine";

const NEVER_ALLOWED_LAYERS: GenomeLayer[] = [];

export function trustTierFromLineage(record: Partial<LineageTrustRecord>): MutationBudget["trustTier"] {
  const releases = record.productionReleases ?? 0;
  const passports = record.passportsIssued ?? 0;
  const shadowDays = record.shadowDaysSurvived ?? 0;

  if (releases >= 2 && passports >= 2 && shadowDays >= 14) return "highly-trusted";
  if (releases >= 1 && passports >= 1) return "trusted";
  return "unproven";
}

export function mutationBudgetForTrust(
  agentId: string,
  trustTier: MutationBudget["trustTier"],
  lineageId = `${agentId}-lineage`
): MutationBudget {
  const expiry = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

  switch (trustTier) {
    case "highly-trusted":
      return {
        agentId,
        lineageId,
        maxFilesChanged: 8,
        maxLinesChanged: 400,
        allowedGenomeLayers: ["prompt", "policy", "workflow", "isolated-source"],
        maxNewTools: 1,
        maxNewNetworkPrivileges: 0,
        trustTier,
        expiry,
      };
    case "trusted":
      return {
        agentId,
        lineageId,
        maxFilesChanged: 3,
        maxLinesChanged: 120,
        allowedGenomeLayers: ["prompt", "policy", "workflow"],
        maxNewTools: 0,
        maxNewNetworkPrivileges: 0,
        trustTier,
        expiry,
      };
    default:
      return {
        agentId,
        lineageId,
        maxFilesChanged: 0,
        maxLinesChanged: 0,
        allowedGenomeLayers: ["policy"],
        maxNewTools: 0,
        maxNewNetworkPrivileges: 0,
        trustTier: "unproven",
        expiry,
      };
  }
}

function layersUsed(proposal: AgentPatchProposal): GenomeLayer[] {
  if (proposal.changeTier === "policy-update") return ["policy"];
  if (proposal.changeTier === "agent-module") return ["isolated-source"];
  return [];
}

export function evaluateProposalAgainstBudget(
  proposal: AgentPatchProposal,
  budget: MutationBudget
): { allowed: boolean; violations: string[] } {
  const violations: string[] = [];
  const usedLayers = layersUsed(proposal);

  for (const layer of usedLayers) {
    if (!budget.allowedGenomeLayers.includes(layer)) {
      violations.push(`Layer "${layer}" not permitted at trust tier ${budget.trustTier}`);
    }
  }

  if (proposal.changeTier === "agent-module") {
    if (proposal.changedFiles.length > budget.maxFilesChanged) {
      violations.push(
        `Changed files (${proposal.changedFiles.length}) exceed budget max ${budget.maxFilesChanged}`
      );
    }
    const lineEstimate = proposal.changedFiles.reduce(
      (sum, file) => sum + file.patch.split("\n").length,
      0
    );
    if (lineEstimate > budget.maxLinesChanged) {
      violations.push(
        `Estimated patch lines (${lineEstimate}) exceed budget max ${budget.maxLinesChanged}`
      );
    }
  }

  for (const layer of NEVER_ALLOWED_LAYERS) {
    if (usedLayers.includes(layer)) {
      violations.push(`Layer "${layer}" is never autonomously permitted`);
    }
  }

  return { allowed: violations.length === 0, violations };
}

export function defaultLineageTrust(agentId: string): LineageTrustRecord {
  return {
    agentId,
    lineageId: `${agentId}-lineage`,
    generation: 1,
    trustTier: "unproven",
    productionReleases: 0,
    passportsIssued: 0,
    shadowDaysSurvived: 0,
  };
}
