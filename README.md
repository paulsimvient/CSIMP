# CODA2 — Advanced Interactive Prototype

CODA2 is an advanced interactive prototype for course-of-action (COA) planning against validated intelligence. It is **not** an operational command system.

## Prototype status

- Effects scores are **Heuristic Estimates** derived from deterministic rules — not validated real-world predictions.
- The default scenario includes bundled **scenario demo** facts when no intelligence is loaded.
- Map markers may use **synthetic coordinates** for visualization when facts lack reported geolocation.
- Browser-local SQL.js persistence is useful for demos only — **not** a secure operational records system.
- Cyber emulation distinguishes **simulation**, **in-process simulation**, **lab executed**, and **lab unavailable** execution modes honestly.

## Architecture

Deterministic pipeline (preserved end-to-end):

```
facts → bounded packet → LLM interpretation → deterministic grounding → solver → logistics → effects → scoring → ranking → UI
```

Key modules:

| Layer | Entry |
|-------|-------|
| Intel | `src/intel/pipeline.ts` |
| COA | `src/coa/pipeline.ts` |
| Store | `src/coa/store.ts` |
| Operator COA | `src/coa/operatorCoaActions.ts` |

## Setup

```bash
npm ci
cp .env.example .env
```

## Environment variables

### Client-safe (`VITE_*`)

| Variable | Purpose |
|----------|---------|
| `VITE_LLM_PROVIDER` | `stub`, `ollama`, or `openai` |
| `VITE_OLLAMA_BASE_URL` | Local Ollama base URL |
| `VITE_LLM_MODEL` | Model name |
| `VITE_CYBER_LAB_HARNESS_URL` | Direct external cyber lab harness URL (legacy) |
| `VITE_CYBER_LAB_USE_SERVER_PROXY` | Route lab harness through `/api/cyber-lab` (recommended) |
| `VITE_CYBER_ALLOW_IN_PROCESS_LAB` | Dev-only in-process cyber fallback |
| `VITE_INTEL_RETAIN_RAW_MODEL_TEXT` | Opt-in persistence of raw LLM text (default off) |
| `VITE_INTEL_DEBUG_LLM` | Dev-only console logging of raw LLM responses |

### Server-only (never `VITE_` prefix)

| Variable | Purpose |
|----------|---------|
| `LLM_ENDPOINT` | Remote OpenAI-compatible endpoint for `/api/llm` proxy |
| `LLM_API_KEY` | Remote provider API key (server-side only) |
| `LLM_PROXY_TIMEOUT_MS` | Proxy timeout (default 60000) |
| `CYBER_LAB_HARNESS_URL` | Upstream lab executor for `/api/cyber-lab` proxy |
| `CYBER_LAB_HARNESS_TIMEOUT_MS` | Lab harness proxy timeout (default 30000) |

**Never put remote API keys in `VITE_*` variables** — they are bundled into the browser.

On startup, CODA2 hydrates intel and COA state from browser-local SQLite snapshots (import restores state without a full page reload).

## How to run

### Local startup paths

| Mode | Configuration |
|------|---------------|
| **Stub** | `VITE_LLM_PROVIDER=stub` — no Ollama required |
| **Local Ollama** | `VITE_LLM_PROVIDER=ollama` + running Ollama |
| **Remote proxy** | `VITE_LLM_PROVIDER=openai` + server `LLM_ENDPOINT` / `LLM_API_KEY` |

```bash
npm run start          # helper script (run.sh)
npm run dev            # Vite dev server only
npm run typecheck
npm test
npm run build
npm run preview        # serves build + /api/llm proxy middleware
```

Optional model pull when using `run.sh`:

```bash
OLLAMA_PULL_MODEL=1 npm run start
```

## Packaging

Create a clean source archive (excludes `node_modules`, `dist`, macOS metadata):

```bash
npm run package:source
tar -xzf coda2-source.tar.gz
cd coda2-source
npm ci
npm run build
```

GitHub Actions CI runs typecheck, tests, build, and uploads `coda2-source.tar.gz` as an artifact on every push and pull request.

## Known limitations

- Scheduler semantics are deterministic heuristics, not a full SMT solver.
- Logistics dependency typing is prototype-level (`requires-completion`, `uses-live-feed`, `shares-evidence`).
- Remote LLM calls require the Vite `/api/llm` proxy (dev and preview).
- Cyber lab harness calls should use the `/api/cyber-lab` proxy with server-side `CYBER_LAB_HARNESS_URL`.

## Security notes

- Remote LLM API keys must only be set as `LLM_API_KEY` (server-side).
- Cyber lab execution requires explicit human approval and lab confirmation for non-simulated providers.
- Demo/scenario data and placeholder COAs are labeled in the UI.

## Tests and checks

```bash
npm run typecheck
npm test
npm run build
npm audit
npm audit --omit=dev
```
