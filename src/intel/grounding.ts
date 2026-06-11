import {
  confidenceExceedsEvidence,
  detectEvidenceConflicts,
  isHighRiskActionType,
  maxConfidenceFromFactIds,
} from "./evidence";
import type {
  CandidateAction,
  GroundingIssue,
  GroundingValidationResult,
  LLMInterpretation,
  ObservedFact,
  ScenarioPacket,
} from "./types";
import {
  DEFAULT_GROUNDING_POLICY,
  type GroundingPolicyConfig,
} from "./groundingPolicy";

// ─── Grounding validator ──────────────────────────────────────────────────────
//
// Deterministic validation of LLM output against known facts.
// Does not use the LLM to check the LLM.
//
// The validator is the enforcement boundary between LLM reasoning and
// downstream systems. Only validated candidate actions flow to the solver.
//
// Checks:
//   1. Every cited fact ID exists in the scenario packet.
//   2. Every candidate action cites at least one observed fact.
//   3. No forbidden language ("proves", "confirms", "shows adversary did").
//   4. No invented entities (entities not mentioned in the packet or facts).
//   5. Inference confidence requires whyNotHigher when < "high".

// Forbidden words in claims and rationale — see architecture principle 6
// Overridden by registry policy when provided to validateGrounding().

export function validateGrounding(
  packet: ScenarioPacket,
  interpretation: LLMInterpretation,
  policy: GroundingPolicyConfig = DEFAULT_GROUNDING_POLICY
): GroundingValidationResult {
  if (!policy.requiresGroundingValidation) {
    return passthroughGrounding(packet, interpretation);
  }

  const forbiddenHedgeWords = policy.forbiddenHedgeWords;
  const knownFactIds = new Set(packet.observedFacts.map((f) => f.id));
  const knownAssets = new Set(packet.knownAssets.map((a) => a.toLowerCase()));
  const knownAuthorities = packet.knownAuthorities ?? {};
  const knownEntities = buildKnownEntitySet(packet.observedFacts);
  const evidenceConflicts = detectEvidenceConflicts(packet.observedFacts);
  const blockHighRiskActions = evidenceConflicts.some(
    (c) => c.effect === "block-high-risk-actions"
  );
  const issues: GroundingIssue[] = [];
  const flaggedInferenceClaims = new Set<string>();

  // ── 1. Check cited facts exist ──────────────────────────────────────────────
  for (const id of interpretation.observedFactsUsed) {
    if (!knownFactIds.has(id)) {
      issues.push({ kind: "hallucinated-fact-id", id });
    }
  }

  for (const inference of interpretation.inferences) {
    const validSupportingFacts = inference.supportingFacts.filter((id) =>
      knownFactIds.has(id)
    );
    if (validSupportingFacts.length === 0) {
      flaggedInferenceClaims.add(inference.claim);
      issues.push({
        kind: "unsupported-inference",
        claim: inference.claim,
        reason: "Inference has no valid supporting facts",
      });
    }
    if (
      inference.confidence !== "high" &&
      (!inference.whyNotHigher || inference.whyNotHigher.trim() === "")
    ) {
      flaggedInferenceClaims.add(inference.claim);
      issues.push({
        kind: "unsupported-inference",
        claim: inference.claim,
        reason: 'Non-high confidence inference is missing "whyNotHigher"',
      });
    }
    for (const id of inference.supportingFacts) {
      if (!knownFactIds.has(id)) {
        issues.push({ kind: "hallucinated-fact-id", id });
      }
    }
  }

  for (const decisionPoint of interpretation.decisionPoints) {
    for (const id of decisionPoint.triggerFacts) {
      if (!knownFactIds.has(id)) {
        issues.push({ kind: "hallucinated-fact-id", id });
      }
    }
    for (const option of decisionPoint.options) {
      for (const id of option.citedFacts) {
        if (!knownFactIds.has(id)) {
          issues.push({ kind: "hallucinated-fact-id", id });
        }
      }
    }
  }

  for (const action of interpretation.candidateActions) {
    for (const id of action.citedFacts) {
      if (!knownFactIds.has(id)) {
        issues.push({ kind: "hallucinated-fact-id", id });
      }
    }
  }

  for (const decisionPoint of interpretation.decisionPoints) {
    const validTriggerFacts = decisionPoint.triggerFacts.filter((id) =>
      knownFactIds.has(id)
    );
    if (validTriggerFacts.length === 0) {
      const firstOption = decisionPoint.options[0]?.id ?? "unknown";
      issues.push({
        kind: "unsupported-decision-option",
        decisionPointId: decisionPoint.id,
        optionId: firstOption,
        reason: "Decision point has no valid trigger facts",
      });
    }

    for (const option of decisionPoint.options) {
      const validCitedFacts = option.citedFacts.filter((id) => knownFactIds.has(id));
      if (validCitedFacts.length === 0) {
        issues.push({
          kind: "unsupported-decision-option",
          decisionPointId: decisionPoint.id,
          optionId: option.id,
          reason: "Decision option has no valid cited facts",
        });
      }
      if (option.citedFactsInherited && validCitedFacts.length > 0) {
        issues.push({
          kind: "degraded-grounding",
          decisionPointId: decisionPoint.id,
          optionId: option.id,
          reason:
            "Decision option citedFacts were inherited from decisionPoint.triggerFacts",
        });
      }
      for (const requiredAsset of option.requiredAssets) {
        if (!knownAssets.has(requiredAsset.toLowerCase())) {
          issues.push({
            kind: "unsupported-decision-option",
            decisionPointId: decisionPoint.id,
            optionId: option.id,
            reason: `Unknown required asset "${requiredAsset}"`,
          });
        }
      }

      for (const requiredAuthority of option.requiredAuthority) {
        if (!(requiredAuthority in knownAuthorities)) {
          issues.push({
            kind: "unsupported-decision-option",
            decisionPointId: decisionPoint.id,
            optionId: option.id,
            reason: `Unknown authority "${requiredAuthority}"`,
          });
          continue;
        }
      }
    }
  }

  // ── 2. Every candidate action must cite at least one real fact ──────────────
  const knownInferenceClaims = new Set(
    interpretation.inferences.map((inference) => inference.claim)
  );
  for (const action of interpretation.candidateActions) {
    const validCitedFacts = action.citedFacts.filter((id) =>
      knownFactIds.has(id)
    );

    if (validCitedFacts.length === 0) {
      if (policy.rejectUncitedActions) {
        issues.push({
          kind: "unsupported-action",
          actionId: action.id,
          reason: "No cited fact IDs reference known observed facts",
        });
      }
    } else if (validCitedFacts.length < policy.minCitedFactsPerAction) {
      issues.push({
        kind: "unsupported-action",
        actionId: action.id,
        reason: `Action cites ${validCitedFacts.length} fact(s); policy requires at least ${policy.minCitedFactsPerAction}`,
      });
    }

    const evidenceCeiling = maxConfidenceFromFactIds(
      packet.observedFacts,
      validCitedFacts
    );
    if (
      action.confidence &&
      confidenceExceedsEvidence(action.confidence, evidenceCeiling)
    ) {
      issues.push({
        kind: "confidence-exceeds-evidence",
        actionId: action.id,
        reason: `Action confidence "${action.confidence}" exceeds cited fact ceiling "${evidenceCeiling}"`,
      });
    }

    if (isHighRiskActionType(action.actionType, action.description)) {
      if (evidenceCeiling !== "high" && validCitedFacts.length < 2) {
        issues.push({
          kind: "unsupported-action",
          actionId: action.id,
          reason:
            "High-risk action requires high-confidence evidence or multi-source support",
        });
      }
      if (blockHighRiskActions) {
        issues.push({
          kind: "evidence-conflict",
          conflictId:
            evidenceConflicts.find((c) => c.effect === "block-high-risk-actions")?.id ??
            "evidence-conflict",
          actionId: action.id,
          reason:
            "Evidence conflicts (degraded source or contradiction) block escalatory actions",
        });
      }
    }

    if (!action.timeSensitivity) {
      issues.push({
        kind: "unsupported-action",
        actionId: action.id,
        reason: "Missing timeSensitivity (immediate | time-bound | routine)",
      });
    }

    for (const requiredAsset of action.requiredAssets ?? []) {
      if (!knownAssets.has(requiredAsset.toLowerCase())) {
        issues.push({
          kind: "unknown-asset",
          actionId: action.id,
          asset: requiredAsset,
        });
      }
    }

    for (const requiredAuthority of action.requiredAuthority ?? []) {
      if (!(requiredAuthority in knownAuthorities)) {
        issues.push({
          kind: "missing-authority-state",
          actionId: action.id,
          authority: requiredAuthority,
        });
        continue;
      }
      const authorityState = knownAuthorities[requiredAuthority];
      if (authorityState === "prohibited" || authorityState === "unknown") {
        issues.push({
          kind: "unsupported-action",
          actionId: action.id,
          reason: `Authority "${requiredAuthority}" is ${authorityState}`,
        });
      }
    }

    for (const claim of action.citedInferences ?? []) {
      if (!knownInferenceClaims.has(claim)) {
        issues.push({
          kind: "unsupported-action",
          actionId: action.id,
          reason: `Unknown cited inference "${claim}"`,
        });
        continue;
      }
      if (flaggedInferenceClaims.has(claim)) {
        issues.push({
          kind: "unsupported-action",
          actionId: action.id,
          reason: `Cites flagged inference "${claim}"`,
        });
      }
    }
  }

  // ── 3. Check for forbidden hedge violations ─────────────────────────────────
  const textSources: Array<{
    text: string;
    location: string;
    actionId?: string;
    decisionPointId?: string;
    optionId?: string;
  }> = [
    ...interpretation.inferences.map((inf) => ({
      text: inf.claim,
      location: `inference: "${inf.claim.slice(0, 40)}…"`,
    })),
    ...interpretation.decisionPoints.map((dp) => ({
      text: dp.question,
      location: `decision point ${dp.id} question`,
      decisionPointId: dp.id,
    })),
    ...interpretation.decisionPoints.flatMap((dp) =>
      dp.options.map((option) => ({
        text: option.label,
        location: `decision point ${dp.id} option ${option.id} label`,
        decisionPointId: dp.id,
        optionId: option.id,
      }))
    ),
    ...interpretation.decisionPoints.flatMap((dp) =>
      dp.options.flatMap((option) =>
        option.benefits.map((benefit) => ({
          text: benefit,
          location: `decision point ${dp.id} option ${option.id} benefit`,
          decisionPointId: dp.id,
          optionId: option.id,
        }))
      )
    ),
    ...interpretation.candidateActions.map((a) => ({
      text: a.rationale,
      location: `action ${a.id} rationale`,
      actionId: a.id,
    })),
    ...interpretation.candidateActions.map((a) => ({
      text: a.description,
      location: `action ${a.id} description`,
      actionId: a.id,
    })),
  ];

  for (const { text, location, actionId, decisionPointId, optionId } of textSources) {
    for (const word of forbiddenHedgeWords) {
      if (isOverclaim(text, word)) {
        issues.push({
          kind: "hedge-violation",
          claim: location,
          forbiddenWord: word,
          ...(actionId ? { actionId } : {}),
          ...(decisionPointId ? { decisionPointId } : {}),
          ...(optionId ? { optionId } : {}),
        });
      }
    }
  }

  // ── 3b. Check for invented entities ────────────────────────────────────────
  for (const { text, location, actionId, decisionPointId, optionId } of textSources) {
    const extracted = extractNamedEntities(text);
    for (const entity of extracted) {
      if (!knownEntities.has(entity.toLowerCase())) {
        issues.push({
          kind: "invented-entity",
          entity,
          foundIn: location,
          ...(actionId ? { actionId } : {}),
          ...(decisionPointId ? { decisionPointId } : {}),
          ...(optionId ? { optionId } : {}),
        });
      }
    }
  }

  // ── 4. Check for constraint violations ─────────────────────────────────────
  // Constraint checks should be scoped to specific outputs, not global.
  for (const constraint of packet.constraints) {
    if (constraint.toLowerCase().includes("do not assume attribution")) {
      const violatingInferenceClaims = new Set<string>();
      for (const inf of interpretation.inferences) {
        if (
          inf.claim.toLowerCase().includes("adversary") &&
          inf.confidence === "high"
        ) {
          flaggedInferenceClaims.add(inf.claim);
          violatingInferenceClaims.add(inf.claim);
          issues.push({
            kind: "constraint-violation",
            constraint,
            foundIn: `inference: "${inf.claim.slice(0, 60)}"`,
          });
        }
      }

      for (const action of interpretation.candidateActions) {
        const citedViolatingInference = (action.citedInferences ?? []).find((claim) =>
          violatingInferenceClaims.has(claim)
        );
        if (citedViolatingInference) {
          issues.push({
            kind: "constraint-violation",
            constraint,
            foundIn: `action ${action.id} cites violating inference "${citedViolatingInference.slice(0, 60)}"`,
            actionId: action.id,
          });
        }
      }

      for (const source of textSources) {
        if (!source.decisionPointId && !source.optionId && !source.actionId) continue;
        if (!source.text.toLowerCase().includes("adversary")) continue;
        issues.push({
          kind: "constraint-violation",
          constraint,
          foundIn: source.location,
          ...(source.actionId ? { actionId: source.actionId } : {}),
          ...(source.decisionPointId ? { decisionPointId: source.decisionPointId } : {}),
          ...(source.optionId ? { optionId: source.optionId } : {}),
        });
      }
    }
  }

  applyRegistryAttributionRules(
    packet,
    interpretation,
    policy.attributionRules,
    issues,
    flaggedInferenceClaims
  );

  // ── 5. Track unused facts ───────────────────────────────────────────────────
  const citedIds = new Set([
    ...interpretation.observedFactsUsed,
    ...interpretation.inferences.flatMap((i) => i.supportingFacts),
    ...interpretation.decisionPoints.flatMap((dp) => dp.triggerFacts),
    ...interpretation.decisionPoints.flatMap((dp) =>
      dp.options.flatMap((option) => option.citedFacts)
    ),
    ...interpretation.candidateActions.flatMap((a) => a.citedFacts),
  ]);

  const unusedFacts = packet.observedFacts
    .map((f) => f.id)
    .filter((id) => !citedIds.has(id));

  // ── 6. Determine which actions are valid ────────────────────────────────────
  const invalidActionIds = new Set(
    issues
      .filter(
        (i) =>
          i.kind === "unsupported-action" ||
          i.kind === "confidence-exceeds-evidence" ||
          i.kind === "evidence-conflict" ||
          i.kind === "unknown-asset" ||
          i.kind === "missing-authority-state" ||
          (i.kind === "hedge-violation" && !!i.actionId) ||
          (i.kind === "invented-entity" && !!i.actionId) ||
          (i.kind === "constraint-violation" && !!i.actionId)
      )
      .map((i) => (i as { actionId: string }).actionId)
  );

  const validatedActionIds = interpretation.candidateActions
    .filter((a) => !invalidActionIds.has(a.id))
    .filter((a) => a.citedFacts.every((id) => knownFactIds.has(id)))
    .map((a) => a.id);

  const invalidDecisionOptionKeys = new Set<string>();
  for (const issue of issues) {
    if (issue.kind === "unsupported-decision-option") {
      invalidDecisionOptionKeys.add(`${issue.decisionPointId}:${issue.optionId}`);
      continue;
    }
    if (
      (issue.kind === "hedge-violation" ||
        issue.kind === "invented-entity" ||
        issue.kind === "constraint-violation") &&
      issue.decisionPointId &&
      issue.optionId
    ) {
      invalidDecisionOptionKeys.add(`${issue.decisionPointId}:${issue.optionId}`);
      continue;
    }
    if (
      (issue.kind === "hedge-violation" ||
        issue.kind === "invented-entity" ||
        issue.kind === "constraint-violation") &&
      issue.decisionPointId &&
      !issue.optionId
    ) {
      const dp = interpretation.decisionPoints.find((item) => item.id === issue.decisionPointId);
      for (const option of dp?.options ?? []) {
        invalidDecisionOptionKeys.add(`${issue.decisionPointId}:${option.id}`);
      }
    }
  }

  const validatedDecisionPointIds = interpretation.decisionPoints
    .map((dp) => ({
      ...dp,
      options: dp.options.filter(
        (option) => !invalidDecisionOptionKeys.has(`${dp.id}:${option.id}`)
      ),
    }))
    .filter((dp) => dp.options.length > 0)
    .map((dp) => dp.id);

  // Deduplicate issues
  const deduped = deduplicateIssues(issues);
  const reviewIssues = deduped.filter((issue) => issue.kind === "degraded-grounding").length;
  const blockingIssues = deduped.length - reviewIssues;

  return {
    valid: deduped.length === 0,
    hasIssues: deduped.length > 0,
    blockingIssues,
    reviewIssues,
    usableForPlanning: validatedActionIds.length > 0 || validatedDecisionPointIds.length > 0,
    issues: deduped,
    evidenceConflicts,
    unusedFacts,
    validatedActionIds,
    validatedDecisionPointIds,
  };
}

/**
 * Filters candidate actions to only those that passed grounding validation.
 */
export function extractValidatedActions(
  interpretation: LLMInterpretation,
  groundingResult: GroundingValidationResult
): CandidateAction[] {
  const validIds = new Set(groundingResult.validatedActionIds);
  return interpretation.candidateActions.filter((a) => validIds.has(a.id));
}

export function extractValidatedDecisionPoints(
  interpretation: LLMInterpretation,
  groundingResult: GroundingValidationResult,
  packet?: ScenarioPacket
) {
  const validIds = new Set(groundingResult.validatedDecisionPointIds);
  const invalidOptionKeys = new Set(
    groundingResult.issues
      .flatMap((issue) => {
        if (issue.kind === "unsupported-decision-option") {
          return [`${issue.decisionPointId}:${issue.optionId}`];
        }
        if (
          (issue.kind === "hedge-violation" ||
            issue.kind === "invented-entity" ||
            issue.kind === "constraint-violation") &&
          issue.decisionPointId &&
          issue.optionId
        ) {
          return [`${issue.decisionPointId}:${issue.optionId}`];
        }
        return [];
      })
  );
  const knownAuthorities = packet?.knownAuthorities ?? {};
  return interpretation.decisionPoints
    .filter((dp) => validIds.has(dp.id))
    .map((dp) => ({
      ...dp,
      options: dp.options
        .filter((option) => !invalidOptionKeys.has(`${dp.id}:${option.id}`))
        .map((option) => ({
          ...option,
          grounding: resolveOptionGrounding(option.citedFacts.length, !!option.citedFactsInherited),
          status: resolveOptionStatus(option.requiredAuthority, knownAuthorities),
        })),
    }))
    .filter((dp) => dp.options.length > 0);
}

function passthroughGrounding(
  packet: ScenarioPacket,
  interpretation: LLMInterpretation
): GroundingValidationResult {
  return {
    valid: true,
    hasIssues: false,
    blockingIssues: 0,
    reviewIssues: 0,
    usableForPlanning: true,
    issues: [],
    evidenceConflicts: [],
    unusedFacts: packet.observedFacts.map((f) => f.id),
    validatedActionIds: interpretation.candidateActions.map((a) => a.id),
    validatedDecisionPointIds: interpretation.decisionPoints.map((dp) => dp.id),
  };
}

function isAttributionClaim(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("adversary") ||
    lower.includes("attribution") ||
    lower.includes("attributed to") ||
    lower.includes("actor responsible") ||
    lower.includes("confirmed attack")
  );
}

function ruleRequiresMultiSource(rule: string): boolean {
  const lower = rule.toLowerCase();
  return (
    (lower.includes("single") && (lower.includes("source") || lower.includes("degraded"))) ||
    (lower.includes("corroboration") && lower.includes("two")) ||
    lower.includes("two independent sources")
  );
}

/** Enforce registry attribution.json rules beyond packet constraint strings. */
function applyRegistryAttributionRules(
  packet: ScenarioPacket,
  interpretation: LLMInterpretation,
  rules: string[],
  issues: GroundingIssue[],
  flaggedInferenceClaims: Set<string>
): void {
  const multiSourceRules = rules.filter(ruleRequiresMultiSource);
  if (multiSourceRules.length === 0) return;

  for (const inference of interpretation.inferences) {
    if (!isAttributionClaim(inference.claim)) continue;
    const validFacts = inference.supportingFacts.filter((id) =>
      packet.observedFacts.some((f) => f.id === id)
    );
    if (validFacts.length < 2 && inference.confidence === "high") {
      flaggedInferenceClaims.add(inference.claim);
      for (const rule of multiSourceRules) {
        issues.push({
          kind: "constraint-violation",
          constraint: rule,
          foundIn: `inference: "${inference.claim.slice(0, 60)}"`,
        });
      }
    }
  }

  for (const action of interpretation.candidateActions) {
    const text = `${action.description} ${action.rationale}`.toLowerCase();
    if (!isAttributionClaim(text)) continue;
    const validFacts = action.citedFacts.filter((id) =>
      packet.observedFacts.some((f) => f.id === id)
    );
    if (validFacts.length < 2) {
      for (const rule of multiSourceRules) {
        issues.push({
          kind: "constraint-violation",
          constraint: rule,
          foundIn: `action ${action.id}`,
          actionId: action.id,
        });
      }
    }
  }
}

// ─── Internal utilities ───────────────────────────────────────────────────────

function buildKnownEntitySet(facts: ObservedFact[]): Set<string> {
  const entities = new Set<string>();
  for (const fact of facts) {
    entities.add(fact.entity.toLowerCase());
    for (const token of extractNamedEntities(fact.entity)) {
      entities.add(token.toLowerCase());
    }
    if (fact.location) {
      // Extract key nouns from location strings
      for (const part of fact.location.split(/[,\s]+/)) {
        if (part.length > 3) entities.add(part.toLowerCase());
      }
      for (const token of extractNamedEntities(fact.location)) {
        entities.add(token.toLowerCase());
      }
    }
  }
  return entities;
}

function extractNamedEntities(text: string): string[] {
  // Capture only multi-token proper-noun phrases like "Port A" or "Harbor Zulu".
  // This avoids false positives from sentence-leading words like "Increase".
  const matches = text.match(/\b[A-Z][a-z0-9-]*(?:\s+[A-Z][a-z0-9-]*)+\b/g) ?? [];
  return matches
    .map((m) => m.trim())
    .filter((m) => m.length >= 3)
    .filter((m) => !IGNORED_ENTITY_TOKENS.has(m.toLowerCase()));
}

const IGNORED_ENTITY_TOKENS = new Set([
  "the",
  "this",
  "that",
  "and",
  "or",
  "no",
  "yes",
  "do",
  "not",
  "action",
  "inference",
  "candidate",
  "facts",
  "fact",
  "observed",
  "requires",
  "confirmation",
]);

function deduplicateIssues(issues: GroundingIssue[]): GroundingIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = JSON.stringify(issue);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isOverclaim(text: string, word: string): boolean {
  const lower = text.toLowerCase();
  if (!lower.includes(word.toLowerCase())) return false;
  if (/\bfact_[a-z0-9_]+\s+(shows|confirms)\b/.test(lower)) return false;
  if (/\bcited fact(s)?\s+(show|shows|confirm|confirms)\b/.test(lower)) return false;
  return true;
}

function resolveOptionStatus(
  requiredAuthority: string[],
  knownAuthorities: Record<string, "authorized" | "requires-approval" | "prohibited" | "unknown">
): "executable" | "requires-command-decision" | "not-available" {
  if (requiredAuthority.length === 0) return "executable";
  let needsApproval = false;
  for (const authority of requiredAuthority) {
    const state = knownAuthorities[authority];
    if (state === "prohibited" || state === "unknown") return "not-available";
    if (state === "requires-approval") needsApproval = true;
  }
  return needsApproval ? "requires-command-decision" : "executable";
}

function resolveOptionGrounding(
  citedFactCount: number,
  citedFactsInherited: boolean
): "explicit" | "inherited" | "missing" {
  if (citedFactCount === 0) return "missing";
  return citedFactsInherited ? "inherited" : "explicit";
}

// ─── Grounding report ────────────────────────────────────────────────────────

/**
 * Formats a grounding result as a human-readable string for logging.
 */
export function formatGroundingReport(result: GroundingValidationResult): string {
  const lines: string[] = [];

  lines.push(result.valid ? "✓ Grounding: VALID" : "✗ Grounding: INVALID");
  lines.push(`  Validated actions: ${result.validatedActionIds.join(", ") || "none"}`);
  lines.push(
    `  Validated decision points: ${result.validatedDecisionPointIds.join(", ") || "none"}`
  );

  if (result.issues.length > 0) {
    lines.push(`  Issues (${result.issues.length}):`);
    for (const issue of result.issues) {
      switch (issue.kind) {
        case "hallucinated-fact-id":
          lines.push(`    - Hallucinated fact ID: "${issue.id}"`);
          break;
        case "unsupported-inference":
          lines.push(`    - Unsupported inference "${issue.claim}": ${issue.reason}`);
          break;
        case "unsupported-action":
          lines.push(`    - Unsupported action "${issue.actionId}": ${issue.reason}`);
          break;
        case "unsupported-decision-option":
          lines.push(
            `    - Unsupported decision option "${issue.optionId}" in "${issue.decisionPointId}": ${issue.reason}`
          );
          break;
        case "degraded-grounding":
          lines.push(
            `    - Degraded grounding for option "${issue.optionId}" in "${issue.decisionPointId}": ${issue.reason}`
          );
          break;
        case "invented-entity":
          lines.push(`    - Invented entity "${issue.entity}" in ${issue.foundIn}`);
          break;
        case "unknown-asset":
          lines.push(`    - Action "${issue.actionId}" references unknown asset "${issue.asset}"`);
          break;
        case "missing-authority-state":
          lines.push(
            `    - Action "${issue.actionId}" references unknown authority "${issue.authority}"`
          );
          break;
        case "constraint-violation":
          lines.push(`    - Constraint violated: "${issue.constraint}" in ${issue.foundIn}`);
          break;
        case "hedge-violation":
          lines.push(`    - Forbidden language in ${issue.claim}: "${issue.forbiddenWord}"`);
          break;
      }
    }
  }

  if (result.unusedFacts.length > 0) {
    lines.push(`  Unused facts: ${result.unusedFacts.join(", ")}`);
  }

  return lines.join("\n");
}
