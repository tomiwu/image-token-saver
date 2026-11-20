#!/usr/bin/env bash
# Run the same checks as the CI jobs. Stop at the first failure.
set -euo pipefail
cd "$(dirname "$0")/.."

npm run format
npm run lint
npm run typecheck
npm test
