#!/usr/bin/env bash
# Copy the app's runtime files into a stage folder (used by build.sh and by tests/build-stage-complete.test.js).
# Usage: ./stage-app.sh <dest>
# The app is staged BY PATTERN: every file and folder under app/ is copied (app/lib, app/public with public/sections, app/api, any new
# folder a batch adds, every app/*.js module) EXCEPT the explicit exclude list below. A new folder can no longer be forgotten.
# tests/build-stage-folders.test.js checks the result (build.sh runs it right after staging) and keeps its own copy of the exclude list.
#   NOT staged: app/config.json, app/config.dev.json (dev config), app/logs, app/journal (runtime data), app/tests, app/node_modules,
#               any *.test.js, any fake-api folder (tests/fake-api is outside app/ and is never staged).
#   Secrets guard, at any depth: *.local.json, *.bak, *.log, *.env, and any file or folder whose name contains secret, token or password (any case).
# AIRMAX_TEST_BUILD=1 (test installers only): blanks "updateFeedUrl" in the STAGED update.json, so a test build never auto-updates.
#   app/update.json in git is never changed by this script.
set -euo pipefail
D="${1:?dest folder}"; cd "$(dirname "$0")"
mkdir -p "$D"
# 1. the base set (one line: several tests read it to see that app/*.js and the shared json files are shipped)
cp -r app/lib app/public app/*.js app/shortcuts.json app/update.json app/config.customer.json "$D"/
# 2. everything else directly under app/ (api, and any folder or file a batch adds later), unless it is on the exclude list
EXCLUDE_TOP=" config.json config.dev.json logs journal tests node_modules "
for p in app/*; do
  [ -e "$p" ] || continue
  n="${p#app/}"
  case "$EXCLUDE_TOP" in *" $n "*) continue ;; esac
  [ -e "$D/$n" ] || cp -r "$p" "$D"/
done
# 3. excluded at any depth: test files and fake AIR POS plugins that sit inside a staged folder, and the secrets guard (local settings,
#    backups, logs, env files, and anything named secret / token / password in any case)
find "$D" \( -name '*.test.js' -o -name fake-api -o -name '*.local.json' -o -name '*.bak' -o -name '*.log' -o -name '*.env' \
  -o -iname '*secret*' -o -iname '*token*' -o -iname '*password*' \) -prune -exec rm -rf {} +
# 4. test build: no auto-update (staged copy only)
if [ "${AIRMAX_TEST_BUILD:-}" = 1 ]; then
  node -e "const fs=require('fs'),f=process.argv[1],j=JSON.parse(fs.readFileSync(f,'utf8'));j.updateFeedUrl='';fs.writeFileSync(f,JSON.stringify(j,null,2)+'\n')" "$D/update.json"
fi
