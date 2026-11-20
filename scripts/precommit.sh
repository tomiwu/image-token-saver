#!/usr/bin/env bash
# Run format, lint, typecheck, tests, and the CRAP gate. Fail if a tool is not wired yet.
set -euo pipefail

cd "$(dirname "$0")/.."

fail=0

if git ls-files --error-unmatch .sandcastle/.env >/dev/null 2>&1; then
  echo "precommit: .sandcastle/.env is tracked." >&2
  exit 1
fi

for step in format lint typecheck test crap; do
  if node -e "process.exit(require('./package.json').scripts?.['$step'] ? 0 : 1)"; then
    echo "precommit: running $step"
    npm run --silent "$step" || fail=1
  else
    echo "precommit: script '$step' is not wired in package.json yet." >&2
    fail=1
  fi
done

exit "$fail"
