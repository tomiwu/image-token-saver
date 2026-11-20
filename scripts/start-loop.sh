#!/usr/bin/env bash
# Start the image-token-saver Sandcastle loop once. Safe to call many times at the same moment.
# Box operators can also use /workspace/bin/image-token-saver-start-loop.sh (fixed log path).
# Do not build an image now. Do not delete images. Do not run podman reset.
# Prefer an existing Node-based Sandcastle image or node:22-bookworm when disk is tight.
set -euo pipefail
umask 077
NAME=image-token-saver
DIR="${ITS_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
exec 9>"/tmp/${NAME}-loop.lock"
flock -n 9 || { echo "locked: another start is in progress"; exit 0; }
PIDFILE="/tmp/${NAME}-loop.pid"
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "running: pid $(cat "$PIDFILE")"; exit 0
fi
if pgrep -f "/workspace/repos/image-token-saver/.sandcastle/main.mts|/workspace/repos/image-token-saver/node_modules/.bin/tsx .sandcastle/main.mts" >/dev/null 2>&1; then
  echo "running: pgrep matched an existing loop"; exit 0
fi
podman image exists localhost/sandcastle:image-token-saver || podman image exists sandcastle:image-token-saver || {
  echo "image missing: localhost/sandcastle:image-token-saver"
  exit 1
}
n=$(ls /workspace/${NAME}-loop[0-9]*.log 2>/dev/null | sed -E "s/.*${NAME}-loop([0-9]+)\.log/\1/" | sort -n | tail -1 || true)
LOG="/workspace/${NAME}-loop$(( ${n:-0} + 1 )).log"
set -o noclobber
: >"$LOG"
set +o noclobber
chmod 600 "$LOG"
setsid nohup bash -c "cd '$DIR' && exec npm run sandcastle" >>"$LOG" 2>&1 9>&- &
echo $! >"$PIDFILE"
chmod 600 "$PIDFILE"
sleep 5
echo "started: pid $(cat "$PIDFILE") log $LOG"
