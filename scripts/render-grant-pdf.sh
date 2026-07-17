#!/usr/bin/env bash
set -euo pipefail

PDF_PYTHON="${CODEX_PDF_PYTHON:-python3}"
BUNDLED_PDF_PYTHON="${HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python"

if ! "${PDF_PYTHON}" -c 'import reportlab' >/dev/null 2>&1; then
  if [[ -x "${BUNDLED_PDF_PYTHON}" ]]; then
    PDF_PYTHON="${BUNDLED_PDF_PYTHON}"
  else
    echo "reportlab is required. Install it with: python3 -m pip install reportlab" >&2
    exit 1
  fi
fi

exec "${PDF_PYTHON}" scripts/render-grant-pdf.py
