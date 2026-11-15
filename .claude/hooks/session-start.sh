#!/bin/bash
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# npm ci statt npm install: installiert exakt nach package-lock.json und verändert die Datei nie
# (npm install hat sie bei jedem Sitzungsstart umgeschrieben und so ungewollte Änderungen erzeugt).
npm ci --no-audit --no-fund
