import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentPatchProposal, ChangedFile, PolicyChange } from "../../src/types/proposal";
import type {
  ActorBackend,
  ActorRevisionContext,
  ActorRevisionResult,
  CriticFinding,
} from "../../src/types/actorCritic";
import { defaultAgentModulePath } from "../../src/registry/moduleEntrypoint";
import { agentPatchProposalSchema, type ParsedAgentPatchProposal } from "./proposalSchema";
import { applyUnifiedDiff, isUnifiedDiff } from "./applyUnifiedDiff";

const ATTRIBUTION_RULE_TEMPLATES = [
  "Require corroboration from two independent sources before attribution claims.",
  "Do not upgrade confidence on attribution without multi-source confirmation.",
  "Treat single-source indicators as unconfirmed until independently validated.",
];

const GROUNDING_RULE_TEMPLATES = [
  "Every candidate action must cite observed fact IDs present in the input packet.",
  "Reject decision points with empty citedFacts arrays.",
];

export type ActorRevisionOptions = {
  repoRoot?: string;
};

function nextProposalId(baseId: string, round: number): string {
  const stem = baseId.replace(/-r\d+$/, "");
  return `${stem}-r${round + 1}`;
}

function dedupePolicyChanges(changes: PolicyChange[]): PolicyChange[] {
  const seen = new Set<string>();
  const result: PolicyChange[] = [];
  for (const change of changes) {
    if (change.operation !== "add-rule" || !change.rule) {
      result.push(change);
      continue;
    }
    const key = `${change.path}::${change.rule.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(change);
  }
  return result;
}

function fixPolicyPaths(proposal: AgentPatchProposal, findings: CriticFinding[]): PolicyChange[] {
  const changes = [...(proposal.policyChanges ?? [])];
  const pathDenied = findings.some((f) => f.code === "policy.path-denied");
  if (!pathDenied) return changes;

  return changes.map((change) => {
    const agentPrefix = `policies/agents/${proposal.targetAgentId}/`;
    if (change.path.startsWith(agentPrefix)) return change;
    const basename = change.path.split("/").pop() ?? "attribution.json";
    return { ...change, path: `${agentPrefix}${basename}` };
  });
}

function dropRedundantRules(
  changes: PolicyChange[],
  findings: CriticFinding[]
): PolicyChange[] {
  const redundant = new Set(
    findings
      .filter((f) => f.code === "policy.rule-already-present")
      .map((f) => String(f.evidence?.rule ?? "").trim().toLowerCase())
      .filter(Boolean)
  );
  if (redundant.size === 0) return changes;

  return changes.filter(
    (change) =>
      change.operation !== "add-rule" ||
      !change.rule ||
      !redundant.has(change.rule.trim().toLowerCase())
  );
}

function proposeNovelRule(proposal: AgentPatchProposal, round: number): PolicyChange | null {
  const objective = proposal.objective.toLowerCase();
  const templates = /attribution|corroborat|source/.test(objective)
    ? ATTRIBUTION_RULE_TEMPLATES
    : GROUNDING_RULE_TEMPLATES;
  const index = round % templates.length;
  const rule = templates[index]!;
  const path = `policies/agents/${proposal.targetAgentId}/attribution.json`;
  const alreadyProposed = (proposal.policyChanges ?? []).some(
    (c) => c.rule?.trim().toLowerCase() === rule.toLowerCase()
  );
  if (alreadyProposed) return null;
  return { path, operation: "add-rule", rule };
}

function fixAgentModulePaths(
  proposal: AgentPatchProposal,
  findings: CriticFinding[]
): ChangedFile[] {
  const files = [...(proposal.changedFiles ?? [])];
  const needsFix = findings.some(
    (f) => f.code === "policy.path-denied" || f.code === "policy.tier-blocked"
  );
  if (!needsFix) return files;

  const modulePrefix = defaultAgentModulePath(proposal.targetAgentId);
  return files.map((file) => {
    const normalized = file.path.replace(/\\/g, "/");
    if (normalized.startsWith(modulePrefix)) return file;

    if (normalized.startsWith("src/agents/")) {
      return { ...file, path: `CoAgenticModel/${normalized}` };
    }

    const basename = normalized.split("/").pop() ?? normalized;
    return { ...file, path: `${modulePrefix}${basename}` };
  });
}

function ensureTestsListed(proposal: AgentPatchProposal, findings: CriticFinding[]): string[] {
  const tests = [...(proposal.testsAddedOrChanged ?? [])];
  const needsTests = findings.some(
    (f) =>
      f.remediation?.includes("testsAddedOrChanged") ||
      f.message.includes("testsAddedOrChanged")
  );
  if (!needsTests) return tests;

  const modulePrefix = defaultAgentModulePath(proposal.targetAgentId);
  for (const file of proposal.changedFiles ?? []) {
    const normalized = file.path.replace(/\\/g, "/");
    const testPath = normalized.endsWith(".test.ts")
      ? normalized
      : normalized.replace(/\.ts$/, ".test.ts");
    if (!testPath.endsWith(".test.ts")) continue;
    if (!tests.includes(testPath)) tests.push(testPath);
    const coagenticTest = testPath.startsWith("CoAgenticModel/")
      ? testPath
      : `${modulePrefix}${testPath.split("/").pop() ?? "index.test.ts"}`;
    if (!tests.includes(coagenticTest)) tests.push(coagenticTest);
  }

  if (tests.length === 0) {
    tests.push(`${modulePrefix}index.test.ts`);
  }

  return [...new Set(tests)];
}

async function normalizeUnifiedDiffToFullFile(
  repoRoot: string,
  file: ChangedFile
): Promise<ChangedFile> {
  if (!isUnifiedDiff(file.patch)) return file;

  const normalizedPath = file.path.replace(/\\/g, "/");
  let base = "";
  try {
    base = await readFile(join(repoRoot, normalizedPath), "utf8");
  } catch {
    base = "";
  }

  try {
    const content = applyUnifiedDiff(base, file.patch);
    return {
      ...file,
      patch: content.endsWith("\n") ? content : `${content}\n`,
    };
  } catch {
    return file;
  }
}

function hasUnfixableAgentModuleBlockers(findings: CriticFinding[]): boolean {
  return findings.some(
    (f) =>
      f.severity === "blocker" &&
      (f.code === "static.dangerous-pattern" || f.code === "static.test-weakening")
  );
}

async function applyDeterministicAgentModuleRevisions(
  context: ActorRevisionContext,
  options: ActorRevisionOptions = {}
): Promise<ActorRevisionResult> {
  const notes: string[] = [];
  const findings = context.criticReport.findings;

  if (hasUnfixableAgentModuleBlockers(findings)) {
    return {
      revised: false,
      backend: "deterministic",
      notes: ["Dangerous or test-weakening patterns cannot be auto-remediated."],
      stallReason: "Agent-module blockers require human-authored fixes.",
    };
  }

  let changedFiles = fixAgentModulePaths(context.priorProposal, findings);
  if (
    changedFiles.some(
      (file, index) => file.path !== context.priorProposal.changedFiles?.[index]?.path
    )
  ) {
    notes.push("Corrected changedFiles paths to CoAgenticModel/src/agents/<module>/ scope.");
  }

  let testsAddedOrChanged = ensureTestsListed(context.priorProposal, findings);
  if (testsAddedOrChanged.length > (context.priorProposal.testsAddedOrChanged?.length ?? 0)) {
    notes.push("Added testsAddedOrChanged entries for agent-module eval.");
  }

  const needsMaterialize =
    findings.some((f) => f.code === "eval.agent-module-failed") ||
    findings.some((f) => f.message.toLowerCase().includes("context mismatch"));

  if (needsMaterialize && options.repoRoot) {
    const materialized: ChangedFile[] = [];
    for (const file of changedFiles) {
      const next = await normalizeUnifiedDiffToFullFile(options.repoRoot, file);
      if (next.patch !== file.patch) {
        notes.push(`Materialized full-file patch for ${file.path} after diff apply failure.`);
      }
      materialized.push(next);
    }
    changedFiles = materialized;
  }

  if (changedFiles.length === 0) {
    return {
      revised: false,
      backend: "deterministic",
      notes,
      stallReason: "No agent-module files to revise.",
    };
  }

  const revised: AgentPatchProposal = {
    ...context.priorProposal,
    proposalId: nextProposalId(context.priorProposal.proposalId, context.round),
    changedFiles,
    testsAddedOrChanged,
    objective: `${context.priorProposal.objective} [actor revision r${context.round + 1}]`,
  };

  return { revised: true, proposal: revised, backend: "deterministic", notes };
}

function applyDeterministicPolicyRevisions(context: ActorRevisionContext): ActorRevisionResult {
  const notes: string[] = [];
  let changes = [...(context.priorProposal.policyChanges ?? [])];
  const findings = context.criticReport.findings;

  const beforeLen = changes.length;
  changes = fixPolicyPaths(context.priorProposal, findings);
  if (
    changes.length !== beforeLen ||
    changes.some((c, i) => c.path !== context.priorProposal.policyChanges?.[i]?.path)
  ) {
    notes.push("Corrected policy paths to policies/agents/<id>/ scope.");
  }

  changes = dropRedundantRules(changes, findings);
  if (changes.length < beforeLen) {
    notes.push("Removed rules already present in base agent version.");
  }

  changes = dedupePolicyChanges(changes);
  if (findings.some((f) => f.code === "policy.duplicate-in-proposal")) {
    notes.push("Deduplicated identical add-rule entries within proposal.");
  }

  if (findings.some((f) => f.code === "policy.objective-path-mismatch")) {
    const path = `policies/agents/${context.priorProposal.targetAgentId}/attribution.json`;
    if (!changes.some((c) => c.path === path)) {
      const rule = proposeNovelRule(context.priorProposal, context.round);
      if (rule) {
        changes.push(rule);
        notes.push("Added attribution policy change aligned with stated objective.");
      }
    }
  }

  if (
    changes.length === 0 &&
    findings.some((f) => f.code.startsWith("policy.rule-already-present"))
  ) {
    const novel = proposeNovelRule(context.priorProposal, context.round);
    if (novel) {
      changes.push(novel);
      notes.push("Proposed novel guardrail after redundant changes were removed.");
    }
  }

  if (findings.some((f) => f.code.startsWith("eval."))) {
    const groundingPath = `policies/agents/${context.priorProposal.targetAgentId}/grounding.json`;
    const rule = GROUNDING_RULE_TEMPLATES[context.round % GROUNDING_RULE_TEMPLATES.length]!;
    if (!changes.some((c) => c.rule === rule)) {
      changes.push({ path: groundingPath, operation: "add-rule", rule });
      notes.push("Added grounding guardrail in response to regression eval failure.");
    }
  }

  if (changes.length === 0) {
    return {
      revised: false,
      backend: "deterministic",
      notes,
      stallReason: "No deterministic revision available for remaining critic blockers.",
    };
  }

  const revised: AgentPatchProposal = {
    ...context.priorProposal,
    proposalId: nextProposalId(context.priorProposal.proposalId, context.round),
    policyChanges: changes,
    objective: `${context.priorProposal.objective} [actor revision r${context.round + 1}]`,
  };

  return { revised: true, proposal: revised, backend: "deterministic", notes };
}

function buildLlmSystemPrompt(changeTier: AgentPatchProposal["changeTier"]): string {
  if (changeTier === "agent-module") {
    return `You are the ACTOR in a supervised agent-evolution pipeline.
Revise the JSON proposal to address CRITIC findings. Output ONLY valid JSON matching AgentPatchProposal.
For agent-module tier: revise changedFiles with unified diff or full-file patches under CoAgenticModel/src/agents/<module>/.
Include testsAddedOrChanged for every new or updated test file. Never propose server/cyber/persistence paths.
Agents propose; humans promote — do not claim deployment.`;
  }

  return `You are the ACTOR in a supervised agent-evolution pipeline.
Revise the JSON proposal to address CRITIC findings. Output ONLY valid JSON matching AgentPatchProposal.
Never include changedFiles for policy-update tier. Never propose server/cyber/persistence paths.
Agents propose; humans promote — do not claim deployment.`;
}

async function callLlmForRevision(
  context: ActorRevisionContext
): Promise<AgentPatchProposal | null> {
  const endpoint = process.env.LLM_ENDPOINT ?? process.env.VITE_LLM_ENDPOINT;
  const apiKey = process.env.LLM_API_KEY;
  if (!endpoint?.trim() || !apiKey?.trim()) return null;

  const findingSummary = context.criticReport.findings
    .map(
      (f) =>
        `- [${f.severity}] ${f.code}: ${f.message}${f.remediation ? ` → ${f.remediation}` : ""}`
    )
    .join("\n");

  const systemPrompt = buildLlmSystemPrompt(context.priorProposal.changeTier);

  const userPrompt = `Objective: ${context.objective}
Evidence: ${context.evidenceRefs.join(", ")}
Round: ${context.round}
Change tier: ${context.priorProposal.changeTier}

Prior proposal:
${JSON.stringify(context.priorProposal, null, 2)}

Critic report (score ${context.criticReport.score.toFixed(2)}, passed=${context.criticReport.passed}):
${findingSummary}

Return revised AgentPatchProposal JSON with a new proposalId suffix -r${context.round + 1}.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.LLM_EVOLUTION_MODEL ?? "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = agentPatchProposalSchema.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function applyDeterministicRevisions(
  context: ActorRevisionContext,
  options: ActorRevisionOptions = {}
): Promise<ActorRevisionResult> {
  if (context.priorProposal.changeTier === "agent-module") {
    return applyDeterministicAgentModuleRevisions(context, options);
  }
  return applyDeterministicPolicyRevisions(context);
}

/**
 * ACTOR: revises proposals in response to critic feedback.
 * Hybrid mode tries LLM first, falls back to deterministic structural revisions.
 */
export async function reviseProposal(
  context: ActorRevisionContext,
  backend: ActorBackend = "hybrid",
  options: ActorRevisionOptions = {}
): Promise<ActorRevisionResult> {
  if (backend === "llm" || backend === "hybrid") {
    const llmProposal = await callLlmForRevision(context);
    if (llmProposal) {
      return {
        revised: true,
        proposal: llmProposal,
        backend: "llm",
        notes: ["LLM actor produced revised proposal from critic feedback."],
      };
    }
    if (backend === "llm") {
      return {
        revised: false,
        backend: "llm",
        notes: [],
        stallReason: "LLM actor unavailable or returned invalid proposal.",
      };
    }
  }

  return applyDeterministicRevisions(context, options);
}

export function seedProposalFromObjective(input: {
  agentId: string;
  baseVersion: string;
  baseCommitSha: string;
  objective: string;
  evidenceRefs: string[];
  sessionId: string;
}): AgentPatchProposal {
  return {
    proposalId: `prop-${input.sessionId}`,
    targetAgentId: input.agentId,
    baseAgentVersion: input.baseVersion,
    baseCommitSha: input.baseCommitSha,
    changeTier: "policy-update",
    objective: input.objective,
    evidenceRefs: input.evidenceRefs,
    changedFiles: [],
    testsAddedOrChanged: [],
    expectedBenefits: ["Address critic-identified grounding or attribution gaps"],
    knownRisks: ["May increase conservatism in monitoring recommendations"],
    requestedRiskClass: "low",
    policyChanges: [
      {
        path: `policies/agents/${input.agentId}/attribution.json`,
        operation: "add-rule",
        rule: "Do not infer attribution from a single degraded source.",
      },
    ],
  };
}

export type { ParsedAgentPatchProposal };
