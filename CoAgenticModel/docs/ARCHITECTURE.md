# CoAgenticModel Architecture

## Doctrine Forge (proof-carrying evolution)

Beyond actor-critic repair, **Doctrine Forge** converts operational surprise into durable doctrine:

```text
operational failure → causal trace → doctrine fossil → scenario forge → capability passport
```

| Module | Path | Role |
|--------|------|------|
| Types | `src/types/doctrine.ts` | AgentGenome, fossils, passports, mission envelopes |
| Scenario Forge | `src/intel/scenarioForge.ts` | Adversarial operational world mutations |
| Invariants | `src/intel/invariantEvaluator.ts` | Host-owned operational invariant checks |
| Causal trace | `server/doctrineForge/causalTrace.ts` | Minimal counterexample from grounding failures |
| Fossil store | `server/doctrineForge/fossilStore.ts` | Institutional memory — extinct failure classes |
| Passport builder | `server/doctrineForge/passportBuilder.ts` | Machine-checkable evidence packet per release |
| Service | `server/doctrineForge/doctrineForgeService.ts` | Orchestration |

API:

- `POST /api/agent-evolution/doctrine/record-failure` — record failure + forge scenarios (`{ demo: true }` for seed)
- `POST /api/agent-evolution/doctrine/passports/build` — build capability passport
- `GET /api/agent-evolution/doctrine/fossils`
- `GET /api/agent-evolution/doctrine/passports/:id`

Agents may evolve doctrine/cognition/capabilities; **safetyEnvelope invariants are host-owned**.

### Stage 2+ capabilities

| Capability | Module | Behavior |
|------------|--------|----------|
| Red-team coevolution | `redTeamAgent.ts` | Attacks operational assumptions; extends Scenario Forge |
| Variant tournament | `doctrineTournament.ts` | Competing policy variants scored on forged worlds |
| COA counterexamples | `src/coa/coaCounterexample.ts` | Generalizes solver/materialization rejections into doctrine |
| Mutation budgets | `mutationBudget.ts` | Trust-tier limits on evolvable genome layers (critic-enforced) |
| Envelope routing | `envelopeStore.ts` + `src/intel/envelopeRouter.ts` | Context-sensitive agent version selection at runtime |

Additional API:

- `POST /doctrine/red-team` — assumption attack challenge
- `POST /doctrine/tournament` — multi-variant tournament
- `POST /doctrine/record-coa-failure` — COA blocker → fossil
- `GET /doctrine/envelope-routes/:agentId`
- `POST /doctrine/envelope-routes/register` — promote passport envelope to runtime router
- `GET /doctrine/mutation-budget/:agentId`
- `GET /agents/:id/production?envelopeClass=` — envelope-routed production bundle

## Core invariant

**Agents may propose their next version; they never decide that their next version is trusted.**

This matches CODA2's existing intel pipeline (`src/intel/pipeline.ts`) where the LLM interprets but deterministic grounding (`src/intel/grounding.ts`) is the enforcement boundary.

## Actor-critic evolution

The rewrite loop separates **proposal generation (actor)** from **verification (critic)**:

```text
┌─────────────┐     propose/revise      ┌──────────────┐
│    ACTOR    │ ──────────────────────► │   proposal   │
│ LLM or det. │                         │   (JSON)     │
└─────────────┘                         └──────┬───────┘
       ▲                                       │
       │ structured feedback                   ▼
       │                               ┌──────────────┐
       └───────────────────────────────│    CRITIC    │
                                       │ deterministic│
                                       └──────────────┘
```

| Role | Module | Responsibility |
|------|--------|----------------|
| **Actor** | `actor.ts` | Revise proposals from critic findings. Hybrid: LLM when `LLM_ENDPOINT` configured, else deterministic structural fixes. |
| **Critic** | `critic.ts` | Score proposals across policy-path, static analysis, policy coherence, regression eval, shadow safety. |
| **Orchestrator** | `actorCriticLoop.ts` | Iterate actor→critic until converge, stall, or max rounds. Never promotes. |
| **Shadow runner** | `policyShadowRunner.ts` | Fixed grounding fixtures under production vs simulated candidate registry policy |
| **Policy coherence** | `policyCoherence.ts` | Detect duplicate/redundant rules against base registry version. |

### Critic dimensions (all deterministic)

1. **policy-path** — tier allowlists (`policy.ts`)
2. **static-analysis** — patch size, dangerous patterns (`staticAnalysis.ts`)
3. **policy-coherence** — redundant rules, objective alignment (`policyCoherence.ts`)
4. **regression-eval** — CODA2 vitest suites (`evalAgents.ts`) on final round
5. **shadow-safety** — grounding metrics vs production baseline (`shadowRunner.ts` + `shadow.ts`)

### API

`POST /api/agent-evolution/proposals/evolve` runs the loop and returns `{ session, processResult? }`.

Human promotion (shadow → canary → production) remains a separate explicit step — the actor-critic loop never self-deploys.

## Runtime integration (CODA2 intel)

Registry policies are no longer write-only. The intel pipeline consumes the production agent bundle at runtime:

| Step | Module | Behavior |
|------|--------|----------|
| Resolve version | `AgentEvolutionService.getProductionBundle()` | Hydrates `productionByAgent` from `releases.json`; falls back to latest registry semver |
| API | `GET /api/agent-evolution/agents/:id/production` | Returns manifest + policies + system prompt |
| Fetch | `src/intel/groundingPolicy.ts` | Browser fetches bundle before interpret |
| Constraints | `mergeConstraints()` | Registry `attribution.json` rules merged into scenario packet |
| Grounding | `validateGrounding(packet, interpretation, policy)` | `minCitedFactsPerAction`, attribution multi-source rules from registry |
| Provenance | `IntelState.agentRuntime` | Stamps agent id/version/release on intel state |
| Module loader | `manifest.moduleEntrypoint` + `registryAgentLoader.ts` | Stub mode invokes `CoAgenticModel/src/agents/<module>/` via production bundle |

Policy evolution (actor-critic → process → promote) now affects runtime behavior once a release reaches production.

Shadow comparison for Tier A proposals runs `policyShadowRunner.ts`: loads production bundle, simulates candidate policy in memory (`simulatePolicy.ts`), and scores both through `src/intel/policyShadowEval.ts` fixtures — before any registry write.

## Tier B — agent modules

- Paths under `CoAgenticModel/src/agents/<name>/` (and `src/agents/` when used)
- `applyPatch.ts` supports full-file and unified diff patches (single- and multi-file via `expandMultiFilePatches`)
- `applyUnifiedDiff.ts` handles multi-hunk, `/dev/null` new files, and `diff --git` bundles
- `agentModuleEval.ts` runs proposal-targeted vitest files in git worktree
- Materialization writes approved patches to repo after eval passes
- Actor-critic Tier B revisions fix paths, add tests, and materialize full-file patches on eval failure

## Rewrite tiers

| Tier | What changes | Default? | Approval |
|------|----------------|----------|----------|
| A | Prompts, policies, schemas, rubrics | Yes | 1 reviewer |
| B | `src/agents/<name>/` modules + tests | Phase 2 | 1 reviewer |
| C | Shared infra, cyber, persistence, server | Never autonomous | 2 reviewers + elevation |

## Agent roles (initial)

| Agent | May do | Must not do |
|-------|--------|-------------|
| intel-interpreter | Structured interpretation | Alter COAs / execute |
| coa-planner | Explain trade-offs | Override solver constraints |
| logistics-reviewer | Recommend matrix edits | Commit orders |
| risk-auditor | Examine provenance gaps | Modify operational state |
| coding-agent | Propose patches | Deploy or hot-reload |

## Server modules

| Module | Responsibility |
|--------|----------------|
| `proposalSchema.ts` | Zod validation — malformed proposals fail closed |
| `policy.ts` | Path allowlists, dangerous pattern scan |
| `staticAnalysis.ts` | Patch size, test-weakening detection |
| `workspace.ts` | Disposable evaluator environment |
| `evaluate.ts` | typecheck, test, build, replay suites |
| `shadow.ts` | Compare candidate vs production safety metrics |
| `promote.ts` | Human approval gate, staged rollout |
| `auditLog.ts` | Immutable provenance trail |
| `index.ts` | Orchestrated pipeline |

## Shadow mode

Production agent `v1.2` drives operator-facing results. Candidate `v1.3` receives the same bounded input, produces a shadow result, and is scored on:

- Schema validity
- Grounding pass rate
- Hallucinated fact IDs
- Unsupported actions
- Constraint violations
- Confidence inflation vs production
- Latency / token usage

Candidates cannot mutate application state until promoted past shadow.

## Cyber / execution boundary

Preserve CODA2 rule: **no LLM-to-execution path.**

Changes under `src/coa/cyberEmulation/` always use Tier C (elevated, dual approval). The coding agent cannot:

- Extend ATT&CK allowlists
- Change lab-harness trust rules
- Remove human approval gates
- Mark simulations as lab-executed

## UI integration (future)

The CODA2 React app should render:

1. Trigger / evidence
2. Scope and diff
3. Policy result
4. Verification report
5. Shadow comparison metrics
6. Approve → shadow → canary → promote / rollback

All writes go through `server/agentEvolution/` — never client-side `git` or filesystem access.

## Runtime identity

Every agent output in production should carry:

```ts
{
  agentId: "intel-interpreter",
  agentVersion: "1.3.0",
  releaseId: "release-2026-06-07-0042",
  inputHash: "...",
  outputHash: "..."
}
```

**Implemented (partial):** `IntelState.agentRuntime` stamps `agentId`, `agentVersion`, and `releaseId` when the evolution API serves the production policy bundle. `runIntelPipeline()` loads registry policies into packet constraints and `validateGrounding()`.

This enables explainable rollback when regressions appear.
