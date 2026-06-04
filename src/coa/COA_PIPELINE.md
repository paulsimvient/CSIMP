# COA analysis pipeline

COA analysis is a **grounded, deterministic pipeline** — not a free-form LLM plan generator.

The LLM may help interpret or summarize intel, but it must not invent facts, candidate IDs, logistics trails, or scores. Anything shown as a validated COA must trace back to normalized facts and grounded intel actions.

## Product question

**What can we do, why that, what will it cost, what might happen, and how sure are we?**

## Architectural boundary

Facts are normalized **before** the LLM sees them (`normalizeReport()` → `ObservedFact` with domain, entity, event, time, location, coordinates, source, confidence, severity, `rawEvidenceRef`).

The COA layer consumes:

- structured `ObservedFact` records (via scenario packets / fact sets), and
- **validated intel actions** that cite those fact IDs.

It does not consume raw unbounded prose.

## Pipeline flow

Entry point: `runCoaPipeline()` in `pipeline.ts`. This is the **only** place that constructs `CoaCandidate` objects. The store commits one complete `CoaState` when the run finishes.

| Step | Responsibility | Rules |
|------|----------------|-------|
| 1. Collect signals | `defaultCollectSignals()` | Convert cited validated intel actions into `Signal`s retaining `citedFacts`. **Uncited actions are dropped.** |
| 2. Generate candidates | `solver` (`stubSolver` / `validatedIntelSolver`) | Stable IDs, selected actions, `sat` / `unsat` / `error`. Solver decides feasibility; intel does not bypass it. |
| 3. Logistics | `buildLogisticsPlan()` | Each SAT candidate with actions owns `candidate.logisticsPlan`. No global `logisticsTrailPlan`. |
| 4. Effects | `defaultEffectsEngine` | Cyber emulation adapter (Phase 1 simulated default; Phase 2 `atomic-red-team` when approved) then effects scoring. Annotate by `coaId` only. Never create candidates or mutate actions/plans. See `cyberEmulation/CYBER_EMULATION.md`. |
| 5. Intel fidelity | `applyIntelFidelityScoring()` | Adjust effects/risk from urgency, confidence, resource pressure, action-type alignment. Exposed as `candidate.intelFidelity`. |
| 6. Rank | `rankCoas()` + `applyDominanceFlags()` | SAT first, then `insufficient_evidence`, then UNSAT/error. Parsimony tie-break. |
| 6b. Sensitivity | `analyzeRankingSensitivity()` | Flags fragile leader/challenger pairs when weights could flip rank. |
| 7. Commit | Return `CoaState` | Atomic: `candidatesById`, `candidateOrder`, `selectedCoaId`, `evidenceConflicts`, `rankingSensitivity`, `runMetadata`. |
| 8. Validate | `assertCoaState()` + Zod (`assertPipelineInputSchema`) | Dev invariants; runtime I/O schemas at pipeline + LLM boundaries. |

## Scoring

Overall score is a weighted combination (see `computeOverallScore()` in `effects.ts`):

```text
overall ≈ feasibility×0.30 + logistics×0.20 + effects×0.35 + (1−risk)×0.15
```

Intel fidelity may adjust `effects` and `risk` before ranking. The UI shows components separately — a COA should never be a bare “recommended” label.

## UI data sources

Logistics matrix and COA detail must read from the **selected candidate**:

```ts
state.candidatesById[state.selectedCoaId].logisticsPlan
```

Use `useDisplayedPlan()` — it wraps the selector above. Do not maintain separate logistics state.

### Operator revisions (not pipeline-generated)

`runCoaPipeline()` still creates **automated** candidates only. Operator paths use the COA store:

| Path | Created by | Validate | Execute |
|------|------------|----------|---------|
| Operator-authored | `createOperatorDraft()` | `validateOperatorCoa()` → `materializeCoaRevision()` | `prepareCoaExecution()` + `executePreparedCoaRevision()` |
| Operator-modified | `forkOperatorModified()` / auto-fork on edit | `validateOperatorCoaWithPipeline()` | same; optional `mergeOperatorIntoParent()` after validate |
| Imported | `createImportedOperatorDraft()` / **Import COA draft** UI | same pipeline validation | same |

`validateOperatorCoaWithPipeline()` materializes the visible matrix, then runs constraint re-check (`evaluateScheduledRevision`), `defaultEffectsEngine`, and intel-fidelity scoring — the same steps automated COAs receive after the solver. `reorderCoaCandidates()` refreshes `candidateOrder` and `dominatedBy` for automated and operator COAs together.

Overlays (`matrixOverlaysByCoaId`) are persisted in `coa_state`. Validation bakes the **visible matrix** into `selectedActions`, `logisticsPlan`, `validatedOrderSet`, and refreshed scores. Execution commits `executedSnapshot` with the frozen order set and `evidenceSnapshotId`.

Rank explanations: `buildCoaRankRationale(candidate, rank)` in `rankRationale.ts`.

## Invariants (`assertCoaState`)

- `selectedCoaId` references an existing candidate.
- `candidateOrder` contains only known IDs.
- SAT + actions ⇒ `logisticsPlan.kind === "populated"`.
- Populated plan `coaId` matches owning candidate.
- All scores in `[0, 1]`.

## Traceability rule

```text
normalized facts → validated actions (cited) → signals → solver (SMT) → logistics → cyber emulation adapter → effects scoring → fidelity → ranking → commander matrix
```

If a recommendation cannot be traced to observed facts, it must not appear as a validated COA.

## Adding scenarios / actions

- Demo facts: `src/scenarios/*.json` + `loadFactSet(id)`.
- COA demo mode: `runCoaPipeline({ mode: "demo" })` — clearly separated from `validated-intel`.
