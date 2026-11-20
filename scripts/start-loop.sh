#!/usr/bin/env bash
# Start the image-token-saver Sandcastle loop once. Safe to call many times at the same moment.
# Box operators can also use /workspace/bin/image-token-saver-start-loop.sh (fixed log path).
# Do not build an image in this script. Do not delete images. Do not run podman reset.
# Prefer reusing an existing Node-based Sandcastle image or node:22-bookworm when disk is low.
set -euo pipefail
umask 077

NAME=image-token-saver
DIR="${ITS_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
LOCK="/tmp/${NAME}-loop.lock"
PIDFILE="/tmp/${NAME}-loop.pid"
LOG_DIR=/workspace
PRIMARY_IMAGE=localhost/sandcastle:image-token-saver
FALLBACK_IMAGE=sandcastle:image-token-saver
PROC_PATTERN="${DIR}/.sandcastle/main.mts|${DIR}/node_modules/.bin/tsx .sandcastle/main.mts"

sandcastle_image_exists() {
  podman image exists "$PRIMARY_IMAGE" || podman image exists "$FALLBACK_IMAGE"
}

next_log_path() {
  local n
  n=$(ls "${LOG_DIR}/${NAME}-loop"[0-9]*.log 2>/dev/null \
    | sed -E "s/.*${NAME}-loop([0-9]+)\.log/\1/" | sort -n | tail -1 || true)
  echo "${LOG_DIR}/${NAME}-loop$(( ${n:-0} + 1 )).log"
}

exec 9>"$LOCK"
flock -n 9 || { echo "locked: another start is in progress"; exit 0; }

if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "running: pid $(cat "$PIDFILE")"
  exit 0
fi
if pgrep -f "$PROC_PATTERN" >/dev/null 2>&1; then
  echo "running: pgrep matched an existing loop"
  exit 0
fi
if ! sandcastle_image_exists; then
  echo "image missing: ${PRIMARY_IMAGE}"
  exit 1
fi

LOG=$(next_log_path)
set -o noclobber
: >"$LOG"
set +o noclobber
chmod 600 "$LOG"
setsid nohup bash -c "cd '$DIR' && exec npm run sandcastle" >>"$LOG" 2>&1 9>&- &
echo $! >"$PIDFILE"
chmod 600 "$PIDFILE"
sleep 5
echo "started: pid $(cat "$PIDFILE") log $LOG"
