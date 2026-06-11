import type { PolicyChange } from "../../src/types/proposal";
import type { AgentPolicyBundle, PolicyDocument } from "../../src/types/policy";

function applyChangeToDoc(doc: PolicyDocument, change: PolicyChange, version: string): void {
  doc.version = version;

  if (change.operation === "add-rule" && change.rule) {
    const rules = doc.rules ?? [];
    if (!rules.includes(change.rule)) {
      rules.push(change.rule);
    }
    doc.rules = rules;
  } else if (change.operation === "remove-rule" && change.rule) {
    doc.rules = (doc.rules ?? []).filter((rule) => rule !== change.rule);
  } else if (change.operation === "replace-rule" && change.rule && change.key) {
    const rules = doc.rules ?? [];
    const idx = rules.findIndex((rule) => rule.startsWith(change.key!));
    if (idx >= 0) rules[idx] = change.rule;
    else rules.push(change.rule);
    doc.rules = rules;
  } else if (change.operation === "set-threshold" && change.key) {
    doc.thresholds = { ...(doc.thresholds ?? {}), [change.key]: Number(change.value) };
  }
}

/**
 * Simulate Tier A policy materialization in memory for shadow/critic evaluation
 * before a proposal is written to the registry.
 */
export function simulatePolicyBundle(
  base: AgentPolicyBundle,
  policyChanges: PolicyChange[],
  candidateVersion: string
): AgentPolicyBundle {
  const policies: Record<string, PolicyDocument> = structuredClone(base.policies);

  for (const change of policyChanges) {
    const prefix = `policies/agents/${base.agentId}/`;
    if (!change.path.startsWith(prefix)) continue;
    const filename = change.path.slice(prefix.length).split("/").pop() ?? "attribution.json";
    const doc = policies[filename] ?? { agentId: base.agentId, rules: [], thresholds: {} };
    applyChangeToDoc(doc, change, candidateVersion);
    doc.agentId = base.agentId;
    policies[filename] = doc;
  }

  return {
    ...base,
    version: candidateVersion,
    policies,
    manifest: { ...base.manifest, version: candidateVersion },
  };
}
