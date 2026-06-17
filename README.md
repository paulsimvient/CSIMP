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
| `KAFKA_BROKERS` | Comma-separated brokers (Redpanda/Kafka) for intel ingest consumer |
| `KAFKA_TOPIC` | Ingest topic (default `intel.raw`) |
| `KAFKA_INGEST_ENABLED` | Start stream consumer when brokers are set (default true if brokers set) |
| `INTEL_INGEST_API_KEY` | Optional bearer/API key for `POST /api/intel/ingest` |

### Intel ingest (optional)

Broker-agnostic **Kafka API** ingest with **Redpanda** for local development:

```text
producers → intel.raw topic → dev-server consumer → /api/intel/ingest store → browser poll → intel pipeline
```

```bash
docker compose -f docker-compose.redpanda.yml up -d   # or: npm run redpanda:up
# In .env: KAFKA_BROKERS=127.0.0.1:19092 KAFKA_INGEST_ENABLED=true VITE_INTEL_INGEST_SYNC=true
npm run dev
npm run redpanda:seed   # publish sample radar/AIS reports
```

Direct HTTP ingest (no broker):

```bash
curl -s -X POST http://127.0.0.1:5173/api/intel/ingest \
  -H 'Content-Type: application/json' \
  -d '{"reports":[{"reportId":"demo-1","source":"test","domain":"air","timestamp":"2026-06-04T12:00:00Z","text":"Test track"}]}'
```

### 100k throughput demo (Redpanda)

Prove broker + consumer throughput — **do not** load 100k facts into the browser UI.

```bash
# Terminal 1 — broker + app with ingest consumer (no browser sync)
REDPANDA_INGEST=1 npm run start
# In .env for bench: VITE_INTEL_INGEST_SYNC=false  (or omit; default is off)

# Terminal 2 — publish 100k synthetic reports
npm run redpanda:bench
# or: COUNT=100000 BATCH_SIZE=1000 npm run redpanda:bench

# Watch the Intel Ingest window in the app (or curl status)
# VITE_INTEL_FEED_WINDOW=true is set by REDPANDA_INGEST=1 ./run.sh
```

`store.acceptedTotal` and `stream.messagesConsumed` should approach 100000. The UI retains the latest 10k facts for map display; the LLM pipeline should stay disabled during the bench (`VITE_INTEL_INGEST_AUTO_RUN=false`).

Status: `GET /api/intel/ingest/status`

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
REDPANDA_INGEST=1 npm run start              # also start Redpanda + enable ingest sync
REDPANDA_INGEST=1 REDPANDA_SEED=1 npm run start   # publish sample intel reports
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
