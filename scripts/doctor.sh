#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

required_failures=0
warnings=0

ok() {
  echo "[doctor] ok: $1"
}

warn() {
  warnings=$((warnings + 1))
  echo "[doctor] warn: $1"
}

fail() {
  required_failures=$((required_failures + 1))
  echo "[doctor] fail: $1"
}

check_required_cmd() {
  local cmd="$1"
  if command -v "$cmd" >/dev/null 2>&1; then
    ok "command '$cmd' -> $(command -v "$cmd")"
  else
    fail "required command '$cmd' is not installed"
  fi
}

check_optional_cmd() {
  local cmd="$1"
  local why="$2"
  if command -v "$cmd" >/dev/null 2>&1; then
    ok "command '$cmd' -> $(command -v "$cmd")"
  else
    warn "optional command '$cmd' is not installed ($why)"
  fi
}

get_env_value() {
  local key="$1"
  local file="$2"
  local line value
  line="$(grep -E "^${key}=" "$file" | tail -n 1 || true)"
  if [ -z "$line" ]; then
    echo ""
    return
  fi
  value="${line#*=}"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  echo "$value"
}

echo "[doctor] project root: $ROOT_DIR"

check_required_cmd "node"
check_required_cmd "npm"
check_required_cmd "uv"

if command -v node >/dev/null 2>&1; then
  node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo "0")"
  if [ "$node_major" -ge 20 ]; then
    ok "Node.js major version is $node_major (>=20)"
  else
    fail "Node.js major version is $node_major (<20). Upgrade Node.js."
  fi
fi

if [ -f ".env.example" ]; then
  ok "found .env.example"
else
  fail ".env.example is missing"
fi

if [ -f "asr-worker/pyproject.toml" ] && [ -f "asr-worker/uv.lock" ]; then
  ok "found asr-worker dependency files"
else
  fail "asr-worker/pyproject.toml or asr-worker/uv.lock is missing"
fi

if [ -f ".env" ]; then
  ok "found .env"
  gguf_path="$(get_env_value "NEMOTRON_GGUF_PATH" ".env")"
  if [ -z "$gguf_path" ]; then
    warn "NEMOTRON_GGUF_PATH is empty in .env"
  elif [ -f "$gguf_path" ]; then
    ok "NEMOTRON_GGUF_PATH points to an existing file"
  else
    warn "NEMOTRON_GGUF_PATH does not exist: $gguf_path"
  fi
  else
    warn ".env is missing (run npm run setup)"
fi

if [ -f ".env" ]; then
  tts_backend="$(get_env_value "TTS_BACKEND" ".env")"
  tts_endpoint="$(get_env_value "TTS_ENDPOINT_URL" ".env")"
  if [ "$tts_backend" = "http_audio" ]; then
    if [ -z "$tts_endpoint" ]; then
      warn "TTS_BACKEND=http_audio but TTS_ENDPOINT_URL is empty"
    else
      ok "TTS_ENDPOINT_URL is set for http_audio backend"
    fi
  fi
fi

check_optional_cmd "ffmpeg" "ASR fallback decode for webm/ogg/mp4"
check_optional_cmd "agent-browser" "automatic URL article extraction"
check_optional_cmd "gemini" "Gemini provider via gemini -p"
check_optional_cmd "nvidia-smi" "GPU diagnostics / local Nemotron"

if command -v llama-server >/dev/null 2>&1; then
  ok "command 'llama-server' -> $(command -v llama-server)"
elif [ -x ".local/llama.cpp/build/bin/llama-server" ]; then
  ok "found local llama-server at .local/llama.cpp/build/bin/llama-server"
else
  warn "llama-server not found on PATH (set NEMOTRON_LLAMA_SERVER_BIN if needed)"
fi

echo "[doctor] summary: failures=$required_failures warnings=$warnings"
if [ "$required_failures" -gt 0 ]; then
  exit 1
fi
