#!/usr/bin/env bash
# CODA2 — local startup helper (stub, local Ollama, or remote LLM proxy modes).

if [[ -z "${BASH_VERSION:-}" ]]; then
  exec bash "$0" "$@"
fi

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

OLLAMA_BASE_URL="${VITE_OLLAMA_BASE_URL:-http://localhost:11434}"
OLLAMA_HOST="${OLLAMA_BASE_URL#http://}"
OLLAMA_HOST="${OLLAMA_HOST#https://}"
OLLAMA_PID=""
STARTED_OLLAMA=0
PORT="${PORT:-5173}"
APP_ORIGIN_PRIMARY="http://localhost:${PORT}"
APP_ORIGIN_SECONDARY="http://127.0.0.1:${PORT}"
APP_ORIGIN_FALLBACK_PRIMARY="http://localhost:$((PORT + 1))"
APP_ORIGIN_FALLBACK_SECONDARY="http://127.0.0.1:$((PORT + 1))"
DEFAULT_OLLAMA_ORIGINS="${APP_ORIGIN_PRIMARY},${APP_ORIGIN_SECONDARY},${APP_ORIGIN_FALLBACK_PRIMARY},${APP_ORIGIN_FALLBACK_SECONDARY}"
RESTART_OLLAMA_WITH_ORIGINS="${RESTART_OLLAMA_WITH_ORIGINS:-0}"
OLLAMA_PULL_MODEL="${OLLAMA_PULL_MODEL:-0}"

info()  { printf '\033[36m→\033[0m %s\n' "$*"; }
ok()    { printf '\033[32m✓\033[0m %s\n' "$*"; }
warn()  { printf '\033[33m!\033[0m %s\n' "$*" >&2; }
die()   { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

append_origin_if_missing() {
  local list="$1"
  local origin="$2"
  if [[ ",$list," == *",$origin,"* ]]; then
    echo "$list"
  else
    echo "${list},${origin}"
  fi
}

build_default_ollama_origins() {
  local origins="$DEFAULT_OLLAMA_ORIGINS"
  if ! command -v ifconfig >/dev/null 2>&1; then
    echo "$origins"
    return
  fi
  local ip
  while IFS= read -r ip; do
    if [[ -z "$ip" || "$ip" == "127.0.0.1" ]]; then
      continue
    fi
    origins="$(append_origin_if_missing "$origins" "http://${ip}:${PORT}")"
    origins="$(append_origin_if_missing "$origins" "http://${ip}:$((PORT + 1))")"
  done < <(ifconfig | awk '/inet / {print $2}' | sort -u)
  echo "$origins"
}

OLLAMA_ORIGINS="${OLLAMA_ORIGINS:-$(build_default_ollama_origins)}"

cleanup() {
  if [[ "$STARTED_OLLAMA" -eq 1 && -n "$OLLAMA_PID" ]]; then
    info "Stopping Ollama started by this script (pid $OLLAMA_PID)…"
    kill "$OLLAMA_PID" 2>/dev/null || true
    wait "$OLLAMA_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

ollama_ready() {
  curl -sf "${OLLAMA_BASE_URL}/api/tags" >/dev/null 2>&1
}

wait_for_ollama() {
  for i in $(seq 1 30); do
    if ollama_ready; then
      return 0
    fi
    sleep 1
    if [[ "$i" -eq 30 ]]; then
      return 1
    fi
  done
}

start_ollama_serve() {
  info "Starting Ollama with OLLAMA_ORIGINS=${OLLAMA_ORIGINS}"
  OLLAMA_ORIGINS="${OLLAMA_ORIGINS}" ollama serve >/dev/null 2>&1 &
  OLLAMA_PID=$!
  STARTED_OLLAMA=1
  if ! wait_for_ollama; then
    die "Ollama did not become ready within 30s. Try: OLLAMA_ORIGINS=${OLLAMA_ORIGINS} ollama serve"
  fi
}

ollama_cors_ready() {
  local origin="$1"
  local headers lower origin_lc
  headers="$(curl -sS -D - -o /dev/null -H "Origin: ${origin}" "${OLLAMA_BASE_URL}/api/tags" 2>/dev/null || true)"
  lower="$(printf "%s" "$headers" | tr '[:upper:]' '[:lower:]')"
  origin_lc="$(printf "%s" "$origin" | tr '[:upper:]' '[:lower:]')"
  [[ "$lower" == *"access-control-allow-origin: *"* || "$lower" == *"access-control-allow-origin: ${origin_lc}"* ]]
}

ensure_ollama_cors_all() {
  local all_ready=1
  local origin

  IFS=',' read -r -a origins <<< "$OLLAMA_ORIGINS"
  for origin in "${origins[@]}"; do
    origin="$(printf "%s" "$origin" | xargs)"
    if [[ -z "$origin" ]]; then
      continue
    fi
    if ollama_cors_ready "$origin"; then
      ok "Ollama CORS allows ${origin}"
    else
      all_ready=0
      warn "Ollama CORS missing origin ${origin}"
    fi
  done

  if [[ "$all_ready" -eq 1 ]]; then
    return
  fi

  if [[ "$STARTED_OLLAMA" -eq 1 && -n "$OLLAMA_PID" ]]; then
    warn "Restarting Ollama started by this script to apply OLLAMA_ORIGINS..."
    kill "$OLLAMA_PID" 2>/dev/null || true
    wait "$OLLAMA_PID" 2>/dev/null || true
    STARTED_OLLAMA=0
    OLLAMA_PID=""
    start_ollama_serve
  else
    warn "Ollama CORS incomplete. Restart manually with: OLLAMA_ORIGINS=${OLLAMA_ORIGINS} ollama serve"
    return
  fi

  all_ready=1
  IFS=',' read -r -a origins <<< "$OLLAMA_ORIGINS"
  for origin in "${origins[@]}"; do
    origin="$(printf "%s" "$origin" | xargs)"
    if [[ -z "$origin" ]]; then
      continue
    fi
    if ! ollama_cors_ready "$origin"; then
      all_ready=0
      warn "CORS still missing origin ${origin}"
    fi
  done

  if [[ "$all_ready" -ne 1 ]]; then
    warn "Ollama CORS still incomplete after restart."
  else
    ok "Ollama CORS configured for required origins"
  fi
}

read_env_model() {
  if [[ -f .env ]]; then
    local line
    line="$(grep -E '^VITE_LLM_MODEL=' .env | tail -1 || true)"
    if [[ -n "$line" ]]; then
      echo "${line#VITE_LLM_MODEL=}" | tr -d '"' | tr -d "'"
      return
    fi
  fi
  echo "llama3.2"
}

model_available() {
  local model="$1"
  curl -sf "${OLLAMA_BASE_URL}/api/tags" | grep -q "\"name\":\"${model}" ||
    curl -sf "${OLLAMA_BASE_URL}/api/tags" | grep -q "\"name\":\"${model}:"
}

info "CODA2 startup"

command -v node >/dev/null 2>&1 || die "Node.js not found. Install from https://nodejs.org/"
command -v npm  >/dev/null 2>&1 || die "npm not found."
command -v curl >/dev/null 2>&1 || die "curl not found."

if [[ ! -f .env ]]; then
  if [[ -f .env.example ]]; then
    warn ".env missing — copying from .env.example"
    cp .env.example .env
  else
    warn ".env missing — creating default stub config"
    cat > .env <<'EOF'
VITE_LLM_PROVIDER=stub
EOF
  fi
fi

set -a
load_vite_env() {
  if [[ ! -f .env ]]; then
    return
  fi
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ "$line" =~ ^VITE_[A-Za-z0-9_]+= ]]; then
      export "$line"
    fi
  done < .env
}
load_vite_env
set +a

MODEL="$(read_env_model)"
LLM_PROVIDER="${VITE_LLM_PROVIDER:-stub}"
OLLAMA_BASE_URL="${VITE_OLLAMA_BASE_URL:-$OLLAMA_BASE_URL}"

ok "LLM provider: ${LLM_PROVIDER}"
ok "Model: $MODEL"
ok "App origin(s): ${APP_ORIGIN_PRIMARY}, ${APP_ORIGIN_SECONDARY}"

if [[ ! -d node_modules ]]; then
  info "Installing npm dependencies…"
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
else
  ok "node_modules present"
fi

if [[ "$LLM_PROVIDER" == "stub" ]]; then
  warn "Stub mode — skipping Ollama checks"
elif [[ "$LLM_PROVIDER" == "openai" ]]; then
  warn "Remote proxy mode — configure server-side LLM_ENDPOINT and LLM_API_KEY before using /api/llm"
else
  command -v ollama >/dev/null 2>&1 || die "Ollama not found. Install: https://ollama.com/download or set VITE_LLM_PROVIDER=stub"

  if ollama_ready; then
    ok "Ollama is running"
    if [[ "$RESTART_OLLAMA_WITH_ORIGINS" == "1" ]]; then
      warn "RESTART_OLLAMA_WITH_ORIGINS=1 set — this script will not kill unrelated Ollama processes."
      warn "Stop your existing Ollama instance manually if CORS origins must change."
    fi
  else
    info "Ollama not responding — starting 'ollama serve'…"
    start_ollama_serve
    ok "Ollama ready (started by this script)"
  fi

  if [[ "$STARTED_OLLAMA" -eq 1 ]]; then
    ensure_ollama_cors_all
  fi

  if model_available "$MODEL"; then
    ok "Model '$MODEL' is available"
  elif [[ "$OLLAMA_PULL_MODEL" == "1" ]]; then
    info "Pulling model '$MODEL' (OLLAMA_PULL_MODEL=1)…"
    ollama pull "$MODEL"
    ok "Model '$MODEL' pulled"
  else
    warn "Model '$MODEL' is not available locally. Set OLLAMA_PULL_MODEL=1 to pull automatically."
  fi
fi

info "Starting dev server at http://localhost:${PORT}"
info "Press Ctrl+C to stop"

npm run dev -- --port "$PORT" --host 127.0.0.1
