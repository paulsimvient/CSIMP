# CoAgenticModel

Supervised **agent-evolution pipeline** for CODA2. Agents may propose their next version; deterministic checks, simulation, and human approval decide whether a release becomes trusted.

This project mirrors the CODA2 intel boundary:

```text
LLM proposes → deterministic validation → constrained downstream use
```

**Agents never rewrite live code or self-promote.**

## Principles

| Rule | Implementation |
|------|----------------|
| Immutable approved versions | `registry/agents/<id>/<semver>/` |
| Tier A default (policies/prompts) | `changeTier: "policy-update"` |
| Tier B sandbox (`src/agents/`) | Phase 2 — path policy enforced |
| Tier C shared infra | Requires elevation + 2 approvals |
| No browser-side rewrites | `server/agentEvolution/` worker only |
| Shadow before production | Releases start at `stage: "shadow"` |
| Full provenance | `auditLog.ts` + `AgentReleaseRecord` |

## Layout

```text
CoAgenticModel/
  registry/agents/          # Immutable approved agent packages
  policies/agents/          # Tier A declarative policy (via registry)
  src/types/                # AgentDefinition, proposals, releases
  src/agents/               # Phase 2 agent-owned modules (sandbox)
  server/agentEvolution/    # Policy gate, evaluate, promote, audit
  examples/                 # Sample proposals
  scripts/                  # CLI validators
  docs/ARCHITECTURE.md      # Full design
```

## Quick start

```bash
cd CoAgenticModel
npm ci
npm run typecheck
npm test
npm run evolution:validate-proposal -- examples/policy-proposal.json
npm run eval:agents -- --agent intel-interpreter --suite regression
```

## Phased rollout

### Phase 1 (implemented)

- Formal `AgentDefinition` registry
- Tier A policy/prompt proposals only
- Zod schema validation
- Deterministic path + static analysis policy
- Shadow-stage promotion with human approval
- Audit log

### Phase 2 (implemented)

- Git worktree isolated workspace (falls back to temp dir)
- Policy version materialization under `registry/agents/<id>/<semver>/`
- CODA2 regression replay via `npm run eval:agents`
- Agent-module patch apply stub (`applyPatch.ts`)
- CLI: `npm run evolution:process-proposal -- examples/policy-proposal.json`

### Phase 3 (implemented)

- HTTP API at `/api/agent-evolution` (Vite dev/preview middleware)
- Release store with staged rollout: shadow → canary → production
- Rollback with audit trail
- CODA2 UI: **Analysis → Agent Evolution**

## Relationship to CODA2

CoAgenticModel is a **sibling package** under the CODA2 repo. The React app should eventually add an **Agent Evolution** panel that displays proposals, diffs, evaluation reports, and approval actions — but all repository mutation runs through this server-side pipeline, not the browser.

CODA2 areas that must **never** be silently modified by an autonomous loop:

- `server/` (LLM proxy, lab harness)
- `src/coa/cyberEmulation/`
- `src/persistence/`
- `src/schemas/`
- `package.json`, `run.sh`, `vite.config.ts`

## Example Tier A proposal

See `examples/policy-proposal.json`. The coding agent emits JSON like:

```json
{
  "changeTier": "policy-update",
  "policyChanges": [
    {
      "path": "policies/agents/intel-interpreter/attribution.json",
      "operation": "add-rule",
      "rule": "Do not infer attribution from a single degraded source."
    }
  ],
  "evidenceRefs": ["eval-run-188"]
}
```

Validate without applying:

```bash
npm run evolution:validate-proposal -- examples/policy-proposal.json
npm run evolution:process-proposal -- examples/policy-proposal.json
npm run evolution:process-proposal -- examples/agent-module-proposal.json
CODA2_ROOT=.. npm run eval:agents -- --agent intel-interpreter --suite regression
```

## HTTP API (dev server)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/agent-evolution/agents` | List registered agents |
| GET | `/api/agent-evolution/releases` | List releases |
| GET | `/api/agent-evolution/audit` | Audit events |
| POST | `/api/agent-evolution/proposals/validate` | Schema + policy only |
| POST | `/api/agent-evolution/proposals/process` | Full pipeline + materialize |
| POST | `/api/agent-evolution/proposals/evolve` | **Actor-critic loop** — revise until critic passes or max rounds |
| POST | `/api/agent-evolution/releases/:id/advance` | shadow → canary → production |
| POST | `/api/agent-evolution/releases/:id/rollback` | Roll back release |

## Actor-critic evolution

The rewrite loop mirrors CODA2 intel: **LLM/actor proposes, deterministic critic validates.**

- **Actor** (`actor.ts`): revises proposals from structured critic feedback. Hybrid mode uses `LLM_ENDPOINT` when configured; otherwise deterministic structural fixes (drop redundant rules, fix paths, propose novel guardrails).
- **Critic** (`critic.ts`): scores across policy-path, static analysis, policy coherence (vs base registry), regression eval, and shadow safety (real vitest metrics).
- **Loop** (`actorCriticLoop.ts`): iterates until converge, stall, or max rounds. Never promotes — humans still advance shadow → production.

See `docs/ARCHITECTURE.md` for the full design.

## Architecture diagram

```text
┌──────────────────────────────────────────────┐
│ CODA2 runtime (approved agent versions only) │
└───────────────────┬──────────────────────────┘
                    │ failures, metrics, feedback
                    ▼
┌──────────────────────────────────────────────┐
│ Evaluation store / evidence refs             │
└───────────────────┬──────────────────────────┘
                    ▼
┌──────────────────────────────────────────────┐
│ Rewrite proposer (structured patch proposal) │
└───────────────────┬──────────────────────────┘
                    ▼
┌──────────────────────────────────────────────┐
│ Deterministic policy gate (this package)     │
└───────────────────┬──────────────────────────┘
                    ▼
┌──────────────────────────────────────────────┐
│ Isolated evaluator (worktree + npm ci/test)  │
└───────────────────┬──────────────────────────┘
                    ▼
┌──────────────────────────────────────────────┐
│ Human review → shadow → canary → production  │
└──────────────────────────────────────────────┘
```

## License

Same as parent CODA2 project (private prototype).
