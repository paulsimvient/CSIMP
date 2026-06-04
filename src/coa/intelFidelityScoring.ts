import { computeOverallScore } from "./effects";
import type { CoaCandidate, IntelFidelityScore, PipelineInput } from "./types";

export type IntelScoringContext = {
  urgency: number;
  confidence: number;
  resourcePressure: number;
  focusTypes: Set<string>;
};

export function deriveIntelScoringContext(
  input: Pick<PipelineInput, "intelActions">
): IntelScoringContext {
  const actions = input.intelActions ?? [];
  if (actions.length === 0) {
    return {
      urgency: 0.5,
      confidence: 0.6,
      resourcePressure: 0,
      focusTypes: new Set<string>(),
    };
  }

  const urgency =
    actions.reduce((sum, action) => sum + timeSensitivityWeight(action.timeSensitivity), 0) /
    actions.length;
  const confidence =
    actions.reduce((sum, action) => sum + confidenceWeight(action.confidence), 0) /
    actions.length;
  const resourcePressure = computeResourcePressure(actions);
  const focusTypes = deriveFocusTypes(actions);

  return { urgency, confidence, resourcePressure, focusTypes };
}

export function applyIntelFidelityScoring(
  candidates: CoaCandidate[],
  context: IntelScoringContext
): CoaCandidate[] {
  return candidates.map((candidate) => {
    if (candidate.status !== "sat") return candidate;

    const alignment = computeCandidateAlignment(candidate, context.focusTypes);
    const mappedActionTypes = candidate.selectedActions.map((action) =>
      mapSolverTypeToFocusType(action.type)
    );
    const matchedActionTypes = Array.from(
      new Set(mappedActionTypes.filter((type) => context.focusTypes.has(type)))
    );

    const effectsAdjusted = clamp(
      candidate.scores.effects * (0.75 + context.confidence * 0.25) +
        alignment * context.urgency * 0.2,
      0,
      1
    );

    const riskAdjusted = clamp(
      candidate.scores.risk + context.resourcePressure * (1 - alignment) * 0.3,
      0,
      1
    );

    const fidelity: IntelFidelityScore = {
      urgency: context.urgency,
      confidence: context.confidence,
      resourcePressure: context.resourcePressure,
      alignment,
      effectsAdjustment: effectsAdjusted - candidate.scores.effects,
      riskAdjustment: riskAdjusted - candidate.scores.risk,
      focusTypes: Array.from(context.focusTypes),
      matchedActionTypes,
    };

    return {
      ...candidate,
      intelFidelity: fidelity,
      scores: {
        ...candidate.scores,
        effects: effectsAdjusted,
        risk: riskAdjusted,
        overall: computeOverallScore(
          candidate.scores.feasibility,
          candidate.scores.logistics,
          effectsAdjusted,
          riskAdjusted
        ),
      },
    };
  });
}

function computeCandidateAlignment(
  candidate: CoaCandidate,
  focusTypes: Set<string>
): number {
  if (focusTypes.size === 0) return 0.5;
  if (candidate.selectedActions.length === 0) return 0;

  const mapped = candidate.selectedActions.map((action) =>
    mapSolverTypeToFocusType(action.type)
  );
  const matching = mapped.filter((type) => focusTypes.has(type)).length;
  return matching / mapped.length;
}

function mapSolverTypeToFocusType(type: string): string {
  if (type === "air" || type === "electronic-warfare" || type === "strike") return "air";
  if (type === "cyber") return "cyber";
  if (type === "information") return "information";
  if (type === "naval") return "maritime";
  if (type === "ground") return "ground";
  return type;
}

function deriveFocusTypes(actions: NonNullable<PipelineInput["intelActions"]>): Set<string> {
  const focus = new Set<string>();
  for (const action of actions) {
    const description = action.description.toLowerCase();
    const requiredAssets = (action.requiredAssets ?? []).join(" ").toLowerCase();
    const text = `${description} ${requiredAssets}`;
    if (action.actionType === "investigate" || /cyber|forensic|authentication|siem/.test(text)) {
      focus.add("cyber");
    }
    if (action.actionType === "inform" || /public|information|message|rumor/.test(text)) {
      focus.add("information");
    }
    if (action.actionType === "observe" || /uas|airspace|drone|radar/.test(text)) {
      focus.add("air");
    }
    if (action.actionType === "coordinate" || /maritime|port|vessel|liaison/.test(text)) {
      focus.add("maritime");
    }
    if (action.actionType === "preserve" || /logistics|continuity|sustain/.test(text)) {
      focus.add("logistics");
    }
  }
  return focus;
}

function computeResourcePressure(actions: NonNullable<PipelineInput["intelActions"]>): number {
  const usage = new Map<string, number>();
  let total = 0;

  for (const action of actions) {
    for (const asset of action.requiredAssets ?? []) {
      const key = asset.toLowerCase();
      usage.set(key, (usage.get(key) ?? 0) + 1);
      total += 1;
    }
  }

  if (total === 0) return 0;
  const concentratedLoad = Math.max(...usage.values(), 1);
  return clamp(concentratedLoad / Math.max(actions.length, 1) - 0.5, 0, 1);
}

function timeSensitivityWeight(value: "immediate" | "time-bound" | "routine" | undefined): number {
  if (value === "immediate") return 1;
  if (value === "time-bound") return 0.75;
  return 0.4;
}

function confidenceWeight(value: "low" | "medium" | "high" | undefined): number {
  if (value === "high") return 0.9;
  if (value === "medium") return 0.7;
  return 0.45;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
