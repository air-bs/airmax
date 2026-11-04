#!/usr/bin/env bash
# local.9: run-all-look.sh watchdog race check. Usage: bash tests/runner-watchdog.sh [runner]  (default tests/run-all-look.sh)
# A 0.2 s group must never be reported as TIMEOUT (30 tries), and a group longer than its limit must be.
R=${1:-tests/run-all-look.sh}
eval "$(grep -E '^run\(\) \{' -A6 "$R")"
LOGP=/tmp/runrace-; bad=0
for i in $(seq 30); do out=$(LOOK_TIMEOUT=30 run quick bash -c 'sleep 0.2; echo "1/1 passed"'); echo "$out" | grep -q "exit 124" && bad=$((bad+1)); done
echo "false timeouts: $bad/30"
out=$(LOOK_TIMEOUT=1 run slow bash -c 'sleep 5; echo "1/1 passed"'); echo "$out" | grep -q "exit 124" && echo "real timeout: caught" || echo "real timeout: MISSED"
[ "$bad" = 0 ] && echo "$out" | grep -q "exit 124"
