#!/usr/bin/env sh
set -e
# skill 目录：<repo>/skills/vision-bridge/scripts -> 仓库根在上两层
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
CLI="$REPO_ROOT/vision-bridge.js"
if [ ! -f "$CLI" ]; then
    echo '{"code":"NO_RUNTIME","nextSteps":"vision-bridge.js not found under the repo root; keep the skills/vision-bridge layout inside the repository, or run node vision-bridge.js directly with the full path."}' >&2
    exit 78
fi
if ! command -v node >/dev/null 2>&1; then
    echo '{"code":"NO_RUNTIME","nextSteps":"node not found on PATH; install Node.js >= 20 from https://nodejs.org"}' >&2
    exit 78
fi
exec node "$CLI" "$@"
