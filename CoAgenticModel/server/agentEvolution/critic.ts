import type { CriticFinding, CriticReport } from "../../src/types/actorCritic";
import type { EvaluationRunRecord } from "../../src/types/release";
import type { ParsedAgentPatchProposal } from "./proposalSchema";
import { evaluatePathPolicy } from "./policy";
import { runStaticAnalysis } from "./staticAnalysis";
import { evaluatePolicyCoherence } from "./policyCoherence";
import { runAgentEvalSuites } from "./evalAgents";
import { runAgentModuleEval } from "./agentModuleEval";
import { runPolicyShadowComparison } from "./policyShadowRunner";
import { applyChangedFiles } from "./applyPatch";
import { createIsolatedWorkspace } from "./workspace";
import {
  defaultLineageTrust,
  evaluateProposalAgainstBudget,
  mutationBudgetForTrust,
  trustTierFromLineage,
} from "../doctrineForge/mutationBudget";

export type CriticOptions = {
  repoRoot: string;
  round: number;
  productionVersion?: string;
  candidateVersion?: string;
  releaseId?: string;
  skipEval?: boolean;
  skipShadow?: boolean;
  /** Simulated next semver for in-memory policy shadow (before materialize). */
  simulatedCandidateVersion?: string;
};

function scoreFindings(findings: CriticFinding[]): number {
  let score = 1;
  for (const finding of findings) {
    if (finding.severity === "blocker") score -= 0.2;
    else if (finding.severity === "warning") score -= 0.05;
  }
  return Math.max(0, Math.min(1, score));
}

function policyFindings(
  proposal: ParsedAgentPatchProposal,
  elevated: boolean
): CriticFinding[] {
  const paths =
    proposal.changeTier === "policy-update"
      ? (proposal.policyChanges ?? []).map((c) => c.path)
      : proposal.changedFiles.map((f) => f.path);

  const decision = evaluatePathPolicy(paths, proposal.changeTier, elevated);
  const findings: CriticFinding[] = [];

  for (const error of decision.errors) {
    findings.push({
      dimension: "policy-path",
      severity: "blocker",
      code: error.includes("blocked") ? "policy.tier-blocked" : "policy.path-denied",
      message: error,
      remediation: "Move changes under policies/agents/<id>/ or src/agents/<id>/ per tier rules.",
    });
  }

  for (const warning of decision.warnings) {
    findings.push({
      dimension: "policy-path",
      severity: "warning",
      code: "policy.path-warning",
      message: warning,
    });
  }

  return findings;
}

function staticFindings(proposal: ParsedAgentPatchProposal): CriticFinding[] {
  const result = runStaticAnalysis(proposal);
  return result.findings.map((message) => ({
    dimension: "static-analysis",
    severity:
      message.includes("Dangerous pattern") ||
      message.includes("Patch too large") ||
      message.includes("Test weakening")
        ? "blocker"
        : "warning",
    code: message.includes("Dangerous pattern")
      ? "static.dangerous-pattern"
      : message.includes("Test weakening")
        ? "static.test-weakening"
        : message.includes("Patch too large")
          ? "static.patch-too-large"
          : "static.other",
    message,
    remediation: message.includes("testsAddedOrChanged")
      ? "Include testsAddedOrChanged referencing new or updated test files."
      : undefined,
  }));
}

function mutationBudgetFindings(proposal: ParsedAgentPatchProposal): CriticFinding[] {
  if (proposal.changeTier !== "agent-module") return [];

  const trust = trustTierFromLineage(defaultLineageTrust(proposal.targetAgentId));
  const budget = mutationBudgetForTrust(proposal.targetAgentId, trust);
  const decision = evaluateProposalAgainstBudget(proposal, budget);

  return decision.violations.map((message) => ({
    dimension: "policy-path" as const,
    severity: "blocker" as const,
    code: "policy.mutation-budget-exceeded",
    message,
    remediation: `Trust tier ${budget.trustTier} allows layers: ${budget.allowedGenomeLayers.join(", ")}`,
  }));
}

/**
 * Deterministic critic — evaluates proposals across schema, policy, coherence,
 * regression eval, and shadow safety. Never promotes; only scores and reports.
 */
export async function critiqueProposal(
  proposal: ParsedAgentPatchProposal,
  options: CriticOptions
): Promise<CriticReport> {
  const findings: CriticFinding[] = [];
  const evalRuns: EvaluationRunRecord[] = [];

  findings.push(...policyFindings(proposal, false));
  findings.push(...mutationBudgetFindings(proposal));
  findings.push(...staticFindings(proposal));

  if (proposal.changeTier === "policy-update" && proposal.policyChanges) {
    findings.push(
      ...(await evaluatePolicyCoherence({
        repoRoot: options.repoRoot,
        agentId: proposal.targetAgentId,
        baseVersion: proposal.baseAgentVersion,
        objective: proposal.objective,
        evidenceRefs: proposal.evidenceRefs,
        policyChanges: proposal.policyChanges,
      }))
    );
  }

  let shadowComparisons: CriticReport["shadowComparisons"];

  if (!options.skipEval && proposal.changeTier === "agent-module" && proposal.changedFiles.length > 0) {
    const workspace = await createIsolatedWorkspace(options.repoRoot);
    try {
      await applyChangedFiles(workspace.rootDir, options.repoRoot, proposal.changedFiles);
      const evalRoot = workspace.kind === "git-worktree" ? workspace.rootDir : options.repoRoot;
      const runs = await runAgentModuleEval(proposal, evalRoot);
      evalRuns.push(...runs);
      for (const run of runs) {
        if (!run.passed) {
          findings.push({
            dimension: "regression-eval",
            severity: "blocker",
            code: "eval.agent-module-failed",
            message: `Agent module eval failed: ${run.suite}`,
            remediation: "Fix agent module implementation and associated tests before promotion.",
            evidence: { suite: run.suite, metrics: run.metrics },
          });
        }
      }
    } finally {
      await workspace.dispose();
    }
  }

  if (!options.skipEval && proposal.changeTier === "policy-update") {
    const suites = await runAgentEvalSuites(
      options.repoRoot,
      proposal.targetAgentId,
      ["regression", "adversarial"]
    );
    evalRuns.push(...suites);
    for (const run of suites) {
      if (!run.passed) {
        findings.push({
          dimension: "regression-eval",
          severity: "blocker",
          code: `eval.${run.suite}-failed`,
          message: `Regression suite failed: ${run.suite}`,
          remediation:
            "Tighten policy guardrails or revise proposal to address failing regression scenarios.",
          evidence: { suite: run.suite, metrics: run.metrics },
        });
      }
    }
  }

  if (
    !options.skipShadow &&
    proposal.changeTier === "policy-update" &&
    options.productionVersion
  ) {
    const shadow = await runPolicyShadowComparison({
      repoRoot: options.repoRoot,
      agentId: proposal.targetAgentId,
      productionVersion: options.productionVersion,
      candidateVersion:
        options.simulatedCandidateVersion ??
        options.candidateVersion ??
        options.productionVersion,
      releaseId: options.releaseId ?? `shadow-${proposal.proposalId}`,
      policyChanges: proposal.policyChanges,
    });
    evalRuns.push(shadow.evalRun);
    shadowComparisons = [shadow.comparison];

    if (!shadow.comparison.promoted) {
      for (const blocker of shadow.comparison.blockers) {
        findings.push({
          dimension: "shadow-safety",
          severity: "blocker",
          code: "shadow.safety-blocker",
          message: blocker,
          remediation:
            "Revise policy to improve grounding pass rate or reduce unsupported actions vs production baseline.",
          evidence: {
            candidate: shadow.candidateMetrics,
            production: shadow.productionMetrics,
          },
        });
      }
    }
  }

  const blockers = findings.filter((f) => f.severity === "blocker");
  return {
    round: options.round,
    proposalId: proposal.proposalId,
    passed: blockers.length === 0,
    score: scoreFindings(findings),
    findings,
    evalRuns,
    shadowComparisons,
  };
}

export function findingsByCode(report: CriticReport, code: string): CriticFinding[] {
  return report.findings.filter((f) => f.code === code || f.code.startsWith(`${code}.`));
}

export function hasBlocker(report: CriticReport, codePrefix?: string): boolean {
  return report.findings.some(
    (f) =>
      f.severity === "blocker" &&
      (codePrefix ? f.code.startsWith(codePrefix) : true)
  );
}
