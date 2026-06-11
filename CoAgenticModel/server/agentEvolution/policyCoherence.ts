import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PolicyChange } from "../../src/types/proposal";
import type { CriticFinding } from "../../src/types/actorCritic";
import { registryRoot } from "./registry";

type PolicyDocument = {
  rules?: string[];
  thresholds?: Record<string, number>;
};

async function loadPolicyDoc(
  repoRoot: string,
  agentId: string,
  version: string,
  policyPath: string
): Promise<PolicyDocument | null> {
  const prefix = `policies/agents/${agentId}/`;
  if (!policyPath.startsWith(prefix)) return null;
  const relative = policyPath.slice(prefix.length);
  const absPath = join(registryRoot(repoRoot), agentId, version, "policies", relative);
  try {
    return JSON.parse(await readFile(absPath, "utf8")) as PolicyDocument;
  } catch {
    return null;
  }
}

function normalizeRule(rule: string): string {
  return rule.trim().replace(/\s+/g, " ").toLowerCase();
}

export async function evaluatePolicyCoherence(input: {
  repoRoot: string;
  agentId: string;
  baseVersion: string;
  objective: string;
  evidenceRefs: string[];
  policyChanges: PolicyChange[];
}): Promise<CriticFinding[]> {
  const findings: CriticFinding[] = [];
  const seenRules = new Set<string>();

  for (const change of input.policyChanges) {
    if (change.operation === "add-rule" && change.rule) {
      const normalized = normalizeRule(change.rule);
      if (seenRules.has(normalized)) {
        findings.push({
          dimension: "policy-coherence",
          severity: "blocker",
          code: "policy.duplicate-in-proposal",
          message: `Duplicate rule in proposal: "${change.rule}"`,
          remediation: "Remove duplicate add-rule entries; keep one canonical wording.",
          evidence: { rule: change.rule, path: change.path },
        });
      }
      seenRules.add(normalized);

      const doc = await loadPolicyDoc(
        input.repoRoot,
        input.agentId,
        input.baseVersion,
        change.path
      );
      const existing = (doc?.rules ?? []).map(normalizeRule);
      if (existing.includes(normalized)) {
        findings.push({
          dimension: "policy-coherence",
          severity: "blocker",
          code: "policy.rule-already-present",
          message: `Rule already in ${input.baseVersion} policy: "${change.rule}"`,
          remediation:
            "Drop redundant add-rule or propose a distinct guardrail aligned with the objective.",
          evidence: { rule: change.rule, path: change.path, baseVersion: input.baseVersion },
        });
      }
    }

    if (change.operation === "set-threshold" && change.key) {
      const value = Number(change.value);
      if (!Number.isFinite(value)) {
        findings.push({
          dimension: "policy-coherence",
          severity: "blocker",
          code: "policy.invalid-threshold",
          message: `Threshold ${change.key} must be numeric`,
          remediation: "Provide a finite number for set-threshold operations.",
          evidence: { key: change.key, value: change.value },
        });
      }
      if (change.key === "minCitedFactsPerAction" && value < 1) {
        findings.push({
          dimension: "policy-coherence",
          severity: "blocker",
          code: "policy.weakening-threshold",
          message: "minCitedFactsPerAction cannot be below 1",
          remediation: "Grounding requires at least one cited fact per action.",
        });
      }
    }
  }

  if (input.evidenceRefs.length === 0) {
    findings.push({
      dimension: "policy-coherence",
      severity: "blocker",
      code: "policy.missing-evidence",
      message: "Policy proposals require evidenceRefs linking to eval failures or incidents",
      remediation: "Add at least one evidence reference (eval run id, audit event, etc.).",
    });
  }

  const objectiveTokens = input.objective.toLowerCase();
  const hasAttributionFocus =
    /attribution|corroborat|source|infer/.test(objectiveTokens);
  const touchesAttribution = input.policyChanges.some((c) =>
    c.path.includes("attribution")
  );
  if (hasAttributionFocus && !touchesAttribution) {
    findings.push({
      dimension: "policy-coherence",
      severity: "warning",
      code: "policy.objective-path-mismatch",
      message: "Objective mentions attribution/corroboration but no attribution policy change",
      remediation: "Target policies/agents/<id>/attribution.json for attribution guardrails.",
    });
  }

  return findings;
}
