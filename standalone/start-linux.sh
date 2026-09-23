#!/usr/bin/env bash

set -euo pipefail

APP_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_ROOT"

PYTHON_BIN="${PYTHON_BIN:-python3}"

if [[ -x "$APP_ROOT/.venv/bin/python" ]]; then
  PYTHON="$APP_ROOT/.venv/bin/python"
else
  "$PYTHON_BIN" -m venv "$APP_ROOT/.venv"
  PYTHON="$APP_ROOT/.venv/bin/python"
  "$PYTHON" -m pip install --disable-pip-version-check -r "$APP_ROOT/requirements.txt"
fi

if [[ -n "${PS_LLAMA_SERVER:-}" || -n "${PS_MODEL_ROOT:-}" || -n "${PS_MODEL:-}" || -n "${PS_PROJECTOR:-}" ]]; then
  PS_APP_ROOT="$APP_ROOT" "$PYTHON" - <<'PY'
import json
import os
from pathlib import Path

root = Path(os.environ["PS_APP_ROOT"])
path = root / "data" / "managed_gguf.json"

try:
    config = json.loads(path.read_text(encoding="utf-8"))
except (OSError, ValueError):
    config = {}

if not isinstance(config, dict):
    config = {}

server = os.environ.get("PS_LLAMA_SERVER", "").strip()
model_root = os.environ.get("PS_MODEL_ROOT", "").strip()
model = os.environ.get("PS_MODEL", "").strip()
projector = os.environ.get("PS_PROJECTOR", "").strip()

if server:
    config["server_path"] = server

if model_root:
    roots = config.get("model_roots")
    if not isinstance(roots, list):
        roots = []
    if model_root not in roots:
        roots.append(model_root)
    config["model_roots"] = roots

if model:
    config["selected_model"] = model

if projector:
    config["selected_projector"] = projector

path.parent.mkdir(parents=True, exist_ok=True)
temporary = path.with_suffix(".tmp")
temporary.write_text(json.dumps(config, indent=2), encoding="utf-8")
os.replace(temporary, path)
PY
fi

exec "$PYTHON" -m prompt_studio "$@"
