import { applyEffectsToCandidates, computeOverallScore, defaultEffectsEngine } from "./effects";
import { applyIntelFidelityScoring, deriveIntelScoringContext } from "./intelFidelityScoring";
import { solverResultToConstraintTrace } from "./constraintTrace";
import type { MaterializeRevisionContext } from "./materializeCoaRevision";
import { evaluateScheduledRevision } from "./validatedIntelSolver";
import { filterCitedIntelActions } from "./pipeline";
import type {
  CoaCandidate,
  EffectsEngineFn,
  PipelineInput,
  SolverInput,
} from "./types";

export type OperatorPipelineContext = MaterializeRevisionContext & {
  mode?: PipelineInput["mode"];
  cyberEmulation?: PipelineInput["cyberEmulation"];
};

type RevalidationDeps = {
  effectsEngine?: EffectsEngineFn;
};

/**
 * Runs pipeline-equivalent scoring on a materialized operator revision:
 * constraint re-check (SMT-style hard constraints), effects engine, intel fidelity.
 */
export async function revalidateOperatorWithPipeline(
  candidate: CoaCandidate,
  ctx: OperatorPipelineContext = {},
  deps: RevalidationDeps = {}
): Promise<CoaCandidate> {
  const intelActions = filterCitedIntelActions(
    (ctx.intelActions ?? []) as NonNullable<PipelineInput["intelActions"]>
  );

  const solverInput: SolverInput = {
    runId: candidate.runId,
    signals: [],
    mode: ctx.mode ?? "validated-intel",
    intelActions,
  };

  const evaluation = evaluateScheduledRevision(candidate.selectedActions, solverInput);
  const constraintTrace = solverResultToConstraintTrace(evaluation);

  if (evaluation.status !== "sat") {
    const blockers =
      evaluation.constraintSatisfaction?.hard
        .filter((h) => !h.satisfied)
        .map((h) => h.reason ?? h.label)
        .filter((reason): reason is string => Boolean(reason)) ?? [
        "Revision failed constraint revalidation",
      ];

    return {
      ...candidate,
      status: "incomplete",
      validationStatus: "unvalidated",
      constraintTrace,
      validationBlockers: blockers,
      validatedOrderSet: undefined,
      validation: undefined,
    };
  }

  let scored: CoaCandidate = {
    ...candidate,
    status: "sat",
    constraintTrace,
    validationBlockers: undefined,
  };

  const effectsEngine = deps.effectsEngine ?? defaultEffectsEngine;
  try {
    const effectsByCoaId = await effectsEngine([scored], {
      intelActions,
      cyberEmulation: ctx.cyberEmulation,
    });
    const enriched = applyEffectsToCandidates([scored], effectsByCoaId);
    scored = enriched[0] ?? scored;
  } catch (err) {
    console.warn("[COA] Operator pipeline effects failed — keeping logistics scores.", err);
  }

  const fidelityContext = deriveIntelScoringContext({ intelActions });
  scored = applyIntelFidelityScoring([scored], fidelityContext)[0] ?? scored;

  scored = {
    ...scored,
    scores: {
      ...scored.scores,
      overall: computeOverallScore(
        scored.scores.feasibility,
        scored.scores.logistics,
        scored.scores.effects,
        scored.scores.risk
      ),
    },
  };

  return scored;
}
