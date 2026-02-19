#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'EOF'
Usage: bash scripts/setup.sh [options]

Options:
  --ci            Use npm ci instead of npm install
  --skip-node     Skip Node.js dependency installation
  --skip-python   Skip asr-worker dependency sync (uv)
  --with-tts      Also sync tts-worker dependencies (uv)
  --skip-env      Do not create .env from .env.example
  --skip-doctor   Do not run setup doctor checks at the end
  -h, --help      Show this help

Examples:
  bash scripts/setup.sh
  bash scripts/setup.sh --ci
  bash scripts/setup.sh --skip-python
  bash scripts/setup.sh --with-tts
EOF
}

need_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[setup] error: required command not found: $cmd" >&2
    exit 1
  fi
}

warn_missing_cmd() {
  local cmd="$1"
  local why="$2"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[setup] warning: optional command not found: $cmd ($why)"
  fi
}

ci_mode=false
skip_node=false
skip_python=false
with_tts=false
skip_env=false
skip_doctor=false

while (($# > 0)); do
  case "$1" in
    --ci)
      ci_mode=true
      ;;
    --skip-node)
      skip_node=true
      ;;
    --skip-python)
      skip_python=true
      ;;
    --with-tts)
      with_tts=true
      ;;
    --skip-env)
      skip_env=true
      ;;
    --skip-doctor)
      skip_doctor=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[setup] error: unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
  shift
done

echo "[setup] project root: $ROOT_DIR"

if [ "$skip_node" = false ]; then
  need_cmd "npm"
fi

if [ "$skip_python" = false ]; then
  need_cmd "uv"
fi

warn_missing_cmd "ffmpeg" "needed for webm/ogg/mp4 ASR decode fallback"
warn_missing_cmd "agent-browser" "needed for automatic URL article extraction"
warn_missing_cmd "gemini" "needed when using Gemini provider via gemini -p"
warn_missing_cmd "nvidia-smi" "needed for local GPU diagnostics"

if [ "$skip_env" = false ]; then
  if [ -f ".env" ]; then
    echo "[setup] .env already exists; keeping current values"
  else
    cp ".env.example" ".env"
    echo "[setup] created .env from .env.example"
  fi
fi

if [ "$skip_node" = false ]; then
  if [ "$ci_mode" = true ]; then
    echo "[setup] running npm ci"
    npm ci
  else
    echo "[setup] running npm install"
    npm install
  fi
fi

if [ "$skip_python" = false ]; then
  echo "[setup] syncing asr-worker dependencies via uv"
  uv sync --project asr-worker --locked

  if [ "$with_tts" = true ]; then
    echo "[setup] syncing tts-worker dependencies via uv"
    uv sync --project tts-worker
  else
    echo "[setup] skip tts-worker sync (use --with-tts when TTS_BACKEND=http_audio)"
  fi
fi

if [ "$skip_doctor" = false ]; then
  echo "[setup] running setup doctor checks"
  bash scripts/doctor.sh
fi

cat <<'EOF'

[setup] done.
Next steps:
  1) Edit .env and set NEMOTRON_GGUF_PATH
  2) Optional: npm run article:auth
  3) Optional (TTS_BACKEND=http_audio): bash scripts/setup.sh --with-tts
  4) Start all services: npm run dev:all
EOF
