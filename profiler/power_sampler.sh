#!/usr/bin/env bash
# Sample CPU + GPU + ANE power every 200 ms and append it to data/power.log.
#
# Run it yourself, in its own terminal, from anywhere:
#     sudo profiler/power_sampler.sh
# Stop with Ctrl-C. Leave it running while you run baselines, benchmarks and tasks.
#
# Log lines (CSV, appended):  t_end_epoch,elapsed_ms,cpu_mw,gpu_mw,ane_mw,combined_mw
# Each run first appends a "# start ..." comment. profiler/energy.py reads this file.
#
# Env overrides: POWER_LOG (default data/power.log), INTERVAL_MS (default 200).
set -euo pipefail

cd "$(dirname "$0")/.."
LOG="${POWER_LOG:-data/power.log}"
INTERVAL_MS="${INTERVAL_MS:-200}"

if [ "$(id -u)" -ne 0 ]; then
  echo "powermetrics needs root. Run:  sudo $0" >&2
  exit 1
fi

mkdir -p "$(dirname "$LOG")"
touch "$LOG"
# keep the log owned by the real user so non-root tools can read/rotate it
[ -n "${SUDO_USER:-}" ] && chown "$SUDO_USER" "$LOG" "$(dirname "$LOG")" 2>/dev/null || true

echo "# start $(date -u +%Y-%m-%dT%H:%M:%SZ) interval_ms=${INTERVAL_MS} host=$(hostname -s)" >> "$LOG"
echo "power sampler -> $LOG (every ${INTERVAL_MS} ms). Ctrl-C to stop."

# `script -q /dev/null` gives powermetrics a pseudo-terminal, so it flushes every sample
# instead of buffering, keeping receive timestamps accurate. The parser is stdlib-only
# and runs under the system Python, which works under sudo.
script -q /dev/null powermetrics --samplers cpu_power,gpu_power -i "$INTERVAL_MS" -f text \
  | /usr/bin/python3 -u profiler/powermetrics_parse.py >> "$LOG"
