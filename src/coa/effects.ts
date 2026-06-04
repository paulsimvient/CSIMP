import {
  isCyberRelevantActionType,
  runCyberEmulationAdapter,
} from "./cyberEmulation";
import { LabHarnessUnavailableError } from "./cyberEmulation/types";
import type { CyberEffectResult } from "./cyberEmulation";
import type {
  CoaCandidate,
  CoaId,
  CyberEffectsAnnotation,
  EffectsEngineContext,
  EffectsEngineFn,
  EffectsResult,
  EffectsSummary,
} from "./types";

const HEURISTIC_SUMMARY_FIELDS: Pick<
  EffectsSummary,
  "estimationMethod" | "isValidatedPrediction"
> = {
  estimationMethod: "deterministic-heuristic",
  isValidatedPrediction: false,
};

export type { EffectsEngineFn, EffectsEngineContext };

// ─── Stub effects engine ──────────────────────────────────────────────────────

/** Deterministic effects estimate for operator revisions (no cyber adapter). */
export function buildRevisionEffects(candidate: CoaCandidate): EffectsResult {
  return scoreEffectsForCandidate(candidate);
}

function scoreEffectsForCandidate(candidate: CoaCandidate): EffectsResult {
  const actionCount = candidate.selectedActions.length;
  const hasKineticAction = candidate.selectedActions.some((a) =>
    ["strike", "air"].includes(a.type)
  );
  const hasCovertAction = candidate.selectedActions.some((a) =>
    isCyberRelevantActionType(a.type)
  );

  const expectedImpact = clamp(0.3 + actionCount * 0.1 + (hasKineticAction ? 0.2 : 0), 0, 1);
  const confidence = clamp(
    0.5 + (hasCovertAction ? 0.2 : 0) + (actionCount > 3 ? -0.1 : 0.1),
    0,
    1
  );
  const risk = clamp(
    0.2 + (hasKineticAction ? 0.3 : 0) + (actionCount > 4 ? 0.2 : 0),
    0,
    1
  );
  const score = clamp(expectedImpact * confidence * (1 - risk * 0.5), 0, 1);

  const risks: string[] = [];
  if (hasKineticAction) risks.push("Collateral damage probability elevated");
  if (actionCount > 4) risks.push("High operational tempo — sustainment risk");
  if (!hasCovertAction) risks.push("Limited information operations coverage");

  const explanation = buildExplanation(candidate, hasKineticAction, hasCovertAction);

  return {
    coaId: candidate.id,
    summary: {
      expectedImpact,
      confidence,
      timeToEffect: 3600 * (hasKineticAction ? 2 : 6),
      explanation,
      risks,
      ...HEURISTIC_SUMMARY_FIELDS,
    },
    score,
    risk,
    explanation,
  };
}

function mergeCyberIntoEffects(
  base: EffectsResult,
  cyber: CyberEffectResult
): EffectsResult {
  const annotation = cyberResultToAnnotation(cyber);
  const detectionRate =
    cyber.observedDetections.length > 0
      ? cyber.observedDetections.filter((d) => d.observed).length /
        cyber.observedDetections.length
      : 0.5;

  const expectedImpact = clamp(
    base.summary.expectedImpact * 0.6 +
      (1 - cyber.residualRisk) * 0.25 +
      detectionRate * 0.15,
    0,
    1
  );
  const confidence = clamp(
    (base.summary.confidence + cyber.confidence) / 2,
    0,
    1
  );
  const risk = clamp(
    (base.risk * 0.5 + cyber.residualRisk * 0.5),
    0,
    1
  );
  const score = clamp(expectedImpact * confidence * (1 - risk * 0.5), 0, 1);

  const risks = [
    ...base.summary.risks,
    `Cyber residual risk ${Math.round(cyber.residualRisk * 100)}% (${cyber.executionMode})`,
  ];
  if (cyber.techniquesEvaluated.length > 0) {
    risks.push(
      `ATT&CK assessed: ${cyber.techniquesEvaluated.map((t) => t.techniqueId).join(", ")}`
    );
  }

  const explanation = `${base.explanation} ${cyber.explanation}`;

  return {
    coaId: base.coaId,
    summary: {
      ...base.summary,
      expectedImpact,
      confidence,
      explanation,
      risks,
      ...HEURISTIC_SUMMARY_FIELDS,
      cyberEffects: annotation,
    },
    score,
    risk,
    explanation,
  };
}

function cyberResultToAnnotation(cyber: CyberEffectResult): CyberEffectsAnnotation {
  return {
    provider: cyber.provider,
    executionMode: cyber.executionMode,
    residualRisk: cyber.residualRisk,
    confidence: cyber.confidence,
    techniquesEvaluated: cyber.techniquesEvaluated,
    evidenceRefs: cyber.evidenceRefs,
    validatedActionIds: cyber.validatedActionIds,
    citedFactIds: cyber.citedFactIds,
    explanation: cyber.explanation,
    ...(cyber.atomicTestsExecuted
      ? { atomicTestsExecuted: cyber.atomicTestsExecuted }
      : {}),
  };
}

function resolveCyberContext(
  candidate: CoaCandidate,
  context?: EffectsEngineContext
): {
  validatedActionIds: string[];
  citedFactIds: string[];
  descriptions: string[];
  types: string[];
} {
  const cyberActions = candidate.selectedActions.filter((a) =>
    isCyberRelevantActionType(a.type)
  );
  const intelById = new Map(
    (context?.intelActions ?? []).map((a) => [a.id, a])
  );

  const validatedActionIds: string[] = [];
  const citedFactIds = new Set<string>();
  const descriptions: string[] = [];
  const types: string[] = [];

  for (const action of cyberActions) {
    validatedActionIds.push(action.id);
    descriptions.push(action.name);
    types.push(action.type);
    const intel = intelById.get(action.id);
    if (intel) {
      for (const factId of intel.citedFacts) citedFactIds.add(factId);
    }
  }

  return {
    validatedActionIds,
    citedFactIds: Array.from(citedFactIds),
    descriptions,
    types,
  };
}

/**
 * Default effects engine: base scoring plus cyber-effects adapter (simulated Phase 1).
 * Cyber emulation runs only for SAT candidates with cyber-relevant actions and cited facts.
 */
export const defaultEffectsEngine: EffectsEngineFn = async (candidates, context) => {
  await simulatedDelay(800);
  const results: Record<CoaId, EffectsResult> = {};

  for (const candidate of candidates) {
    if (candidate.status !== "sat") continue;

    const base = scoreEffectsForCandidate(candidate);
    const cyberCtx = resolveCyberContext(candidate, context);
    const hasCyber = cyberCtx.validatedActionIds.length > 0;

    if (!hasCyber) {
      results[candidate.id] = base;
      continue;
    }

    if (cyberCtx.citedFactIds.length === 0) {
      results[candidate.id] = {
        ...base,
        summary: {
          ...base.summary,
          risks: [
            ...base.summary.risks,
            "Cyber actions present but no cited facts — emulation skipped",
          ],
        },
      };
      continue;
    }

    const emulation = context?.cyberEmulation;
    try {
      const cyber = await runCyberEmulationAdapter({
        coaId: candidate.id,
        validatedActionIds: cyberCtx.validatedActionIds,
        citedFactIds: cyberCtx.citedFactIds,
        actionDescriptions: cyberCtx.descriptions,
        actionTypes: cyberCtx.types,
        provider: emulation?.provider,
        humanApproved: emulation?.humanApproved,
        labEnvironmentConfirmed: emulation?.labEnvironmentConfirmed,
      });
      results[candidate.id] = mergeCyberIntoEffects(base, cyber);
    } catch (err) {
      const harnessBlocked = err instanceof LabHarnessUnavailableError;
      console.warn(
        `[COA effects] Cyber emulation skipped for ${candidate.id}:`,
        err
      );
      results[candidate.id] = {
        ...base,
        summary: {
          ...base.summary,
          risks: [
            ...base.summary.risks,
            harnessBlocked
              ? "Lab harness unavailable — atomic cyber validation blocked (fail closed)"
              : "Cyber emulation failed — using heuristic effects only",
          ],
        },
      };
    }
  }

  return results;
};

/** @deprecated Use defaultEffectsEngine — kept as alias for tests. */
export const stubEffectsEngine: EffectsEngineFn = defaultEffectsEngine;

// ─── Apply effects to candidates ──────────────────────────────────────────────

export function applyEffectsToCandidates(
  candidates: CoaCandidate[],
  effectsByCoaId: Record<CoaId, EffectsResult>
): CoaCandidate[] {
  return candidates.map((candidate) => {
    const effect = effectsByCoaId[candidate.id];

    if (!effect) {
      return candidate;
    }

    const overall = computeOverallScore(
      candidate.scores.feasibility,
      candidate.scores.logistics,
      effect.score,
      effect.risk
    );

    return {
      ...candidate,
      effects: effect.summary,
      scores: {
        ...candidate.scores,
        effects: effect.score,
        risk: effect.risk,
        overall,
      },
    };
  });
}

// ─── Overall score ────────────────────────────────────────────────────────────

export type ScoreWeights = {
  feasibility: number;
  logistics: number;
  effects: number;
  risk: number;
};

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  feasibility: 0.3,
  logistics: 0.2,
  effects: 0.35,
  risk: 0.15,
};

export function computeOverallScore(
  feasibility: number,
  logistics: number,
  effects: number,
  risk: number,
  weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS
): number {
  return clamp(
    feasibility * weights.feasibility +
      logistics * weights.logistics +
      effects * weights.effects +
      (1 - risk) * weights.risk,
    0,
    1
  );
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function simulatedDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function buildExplanation(
  candidate: CoaCandidate,
  hasKinetic: boolean,
  hasCovert: boolean
): string {
  if (
    candidate.logisticsPlan.kind === "populated" &&
    candidate.logisticsPlan.source === "validated-intel"
  ) {
    const actionTypes = Array.from(
      new Set(candidate.selectedActions.map((a) => a.type || "other"))
    );
    return `COA uses ${candidate.selectedActions.length} validated action${
      candidate.selectedActions.length === 1 ? "" : "s"
    } focused on ${actionTypes.join(", ")}. Effects are limited to grounded, non-escalatory planning support.`;
  }
  const parts: string[] = [
    `${candidate.label} employs ${candidate.selectedActions.length} actions.`,
  ];
  if (hasKinetic && hasCovert) {
    parts.push("Combines kinetic and covert effects for layered impact.");
  } else if (hasKinetic) {
    parts.push("Primarily kinetic — rapid effect but elevated risk profile.");
  } else if (hasCovert) {
    parts.push("Primarily covert — slower effect with lower signature.");
  }
  return parts.join(" ");
}
