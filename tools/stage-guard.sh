#!/usr/bin/env bash
# Stage guard (called by build.sh, tested by tests/stage-guard.test.js). Usage: tools/stage-guard.sh <file-or-folder>...
# Exit 1 and print the hits when anything in the stage names a real store or a test secret, in any case, binary files too:
#   1. built in: a store order number (letters "RO" + 5 digits) and the name of the test password variable.
#   2. private (NOT in this repo): the live store's name in every spelling, its town, street address and phone. They are read, one
#      extended regex per line (blank lines and lines starting with # are ignored), from the file named by $STAGE_GUARD_PRIVATE_FILE,
#      or else from tools/stage-guard.private (git-ignored). Without such a file the guard still runs part 1 and prints a warning.
# The one allowed mention is the TestShop test order "TestShop" + space + "RO" + "11052" (TestShop is the approved test store). Exact words only:
# a line that also holds another order number, or any private word, still stops the build. Binary files are scanned too.
# STAGE_GUARD_SKIP_ENVNAME=1 leaves out the password-variable-name check (for scanning the whole source tree, where the tests read that variable).
# The built-in patterns put one letter of each word in a [bracket], so this file never matches its own patterns.
set -uo pipefail
export LC_ALL=C
GUARD='R[O][0-9]{5}'
[ "${STAGE_GUARD_SKIP_ENVNAME:-}" = "1" ] || GUARD="$GUARD|AIRMAX_TES[T]_P[W]"
PRIV="${STAGE_GUARD_PRIVATE_FILE:-$(dirname "$0")/stage-guard.private}"
if [ -f "$PRIV" ]; then
  EXTRA=$(grep -vE '^[[:space:]]*(#|$)' "$PRIV" | paste -sd'|' -)
  [ -n "$EXTRA" ] && GUARD="$GUARD|$EXTRA"
else
  echo "stage-guard: WARNING private store-name patterns not loaded (no \$STAGE_GUARD_PRIVATE_FILE or tools/stage-guard.private): only order numbers and the test password name are checked" >&2
fi
HITS=$(grep -rnaioE ".{0,20}($GUARD)" "$@" 2>/dev/null | sed -E 's/TestShop R[O]11052/ /Ig' | grep -aiE "($GUARD)" | cat -v | cut -c1-200 | head -20)
if [ -n "$HITS" ]; then echo "$HITS"; exit 1; fi
exit 0
