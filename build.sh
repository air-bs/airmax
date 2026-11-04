#!/usr/bin/env bash
# Build the Air Register (AIR POS look) installer + update files.   Usage: ./build.sh 1.0.0
# Output: pkg/out/<version>/  ->  AirRegister-AirposLook-Setup-<v>.exe, .exe.blockmap, latest.yml, AirRegister-AirposLook-Setup.exe
# This is a SEPARATE app from the store Air Register. Its files must never be published to the store feed
# (ar-7e2b62e7c5c4) or behind is.gd/airbiz_dl; this script refuses to build if anything points there.
# Self-contained: everything it reads is inside this folder (hw/out is copied in; no ../ paths).
set -euo pipefail
V="${1:?version, e.g. 1.0.1}"
[[ "$V" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || { echo "version must be X.Y.Z or X.Y.Z-pre.N"; exit 1; }
cd "$(dirname "$0")"
[ "${AIRMAX_TEST_BUILD:-}" != 1 ] || [[ "$V" == *-test* ]] || { echo "AIRMAX_TEST_BUILD=1 is only for test versions (X.Y.Z-test.N)"; exit 1; }
node tests/identity.test.js || { echo "BUILD STOPPED: store-app identity found (this app must not share names/ports/feed with the store Air Register)"; exit 1; }
node tests/keys-unique.test.js || { echo "BUILD STOPPED: duplicate or wrong shortcut keys (owner rule: one key = one action)"; exit 1; }
node -e "const f='app/update.json',j=require('./'+f);j.version='$V';require('fs').writeFileSync(f,JSON.stringify(j,null,2)+'\n')"
# Ask AirMax how-to guide: update app/howto IN PLACE (hand-written topics kept; generated topics added/updated/removed; stamped with this version). Fails the build if a topic names a button or key that is not in the app.
node tools/build-howto.js || { echo "BUILD STOPPED: the how-to guide names a button, tab or key that is not in the app (see above)"; exit 1; }
S=pkg/stage/app; rm -rf "$S"; mkdir -p "$S"
# AIRMAX_TEST_BUILD=1 (test installers only, version must be X.Y.Z-test.N) blanks updateFeedUrl in the STAGED update.json: the test build never auto-updates, git is not changed
bash ./stage-app.sh "$S"   # every folder and file under app/ by pattern, minus dev config and tests (see stage-app.sh, tests/build-stage-complete.test.js)
node tests/build-stage-folders.test.js "$S" || { echo "BUILD STOPPED: the stage is missing a folder or file the app needs, or a -test version has an update feed (tests/build-stage-folders.test.js)"; exit 1; }
# built-in printer/drawer helper (replaces the AIR POS hardware service) + PDFium and its licenses
[ -f hw/out/AirRegisterHw.exe ] && [ -f hw/out/pdfium.dll ] || { echo "hw/out helper missing: build hw/ first"; exit 1; }
sed -e "1s/.*/Air Max $V/" -e 's/$/\r/' "pkg/Read Me.txt" > "pkg/stage/Read Me.txt"   # installer Read Me (source: pkg/Read Me.txt; CRLF for Notepad)
mkdir -p "$S/hw"; cp hw/out/AirRegisterHw.exe hw/out/AirRegisterHw.exe.config hw/out/pdfium.dll "$S/hw/"; cp -r hw/licenses "$S/hw/licenses"
# Remote Help (RustDesk) is NOT included: it is machine-wide and belongs to the store Air Register.
rm -rf pkg/stage/remote
node -e "const c=require('./app/config.customer.json'); if((c.blockedCompanies||[]).length||c.build!=='customer'){console.error('customer config must have blockedCompanies [] and build customer');process.exit(1)}"
# store-name guard (nostore1103): stops the build when the stage holds a store order number (RO + 5 digits), the test password variable name,
# or any live-store word from the private pattern file (tools/stage-guard.private, git-ignored; or $STAGE_GUARD_PRIVATE_FILE). Only the TestShop test order is allowed. Tests: tests/stage-guard.test.js.
bash tools/stage-guard.sh "$S" "pkg/stage/Read Me.txt" || { echo "dev/test strings found in stage"; exit 1; }
# "first choice": same check, except exactly these existing comment lines in the label code (1.0.11-local.9 Label Layouts),
# which name the First Choice label layouts; nothing on screen or printed. Exact file + whole line, so any new mention stops the build.
FC_OK="$(cat <<'EOF'
pkg/stage/app/labels.js:const LL = require('./public/labellayouts'); // 1.0.11-local.9 Label Layouts (First Choice layouts, label price, default layout)
pkg/stage/app/public/labellayouts.js:// Air Max 1.0.11-local.9 (Ari OK 6:30 PM ET Nov 1, test build): Label Layouts. The 12 First Choice label layouts Ari uses,
pkg/stage/app/public/labellayouts.js:  // First Choice wraps by filling the first line ("COMIC KINDER COMICS / MIDOSVILLE"); shrink only when it cannot fit
pkg/stage/app/public/labellayouts.js:  // id, First Choice name, size (w x h in), stickers per copy, matched to a sample?
pkg/stage/app/public/labellayouts.js:  // First Choice photo: the barcode 75720000814 went into the Price box and the label said $75,720. Here a price is at
pkg/stage/app/public/printlabels.js:// Air Max 1.0.11-local.9 (Ari OK 6:30 PM ET Nov 1, test build): Print Labels with layouts (First Choice "Printout" screen).
EOF
)"
FC=$(grep -raiE 'first ?choice' "$S" "pkg/stage/Read Me.txt" | grep -avxF -e "$FC_OK" || true)   # -a: a match in a binary still stops the build
if [ -n "$FC" ]; then echo "dev/test strings found in stage:"; echo "$FC" | cut -c1-200; exit 1; fi
if grep -rqiE 'ar-7e2b62e7c5c4|airbiz_dl' "$S/update.json" "pkg/stage/Read Me.txt" pkg/installer.nsi pkg/stage/AirRegister.ps1; then echo "store feed/link found: refusing to build"; exit 1; fi
O=pkg/out/$V; mkdir -p "$O"; EXE="AirRegister-AirposLook-Setup-$V.exe"
(cd pkg && makensis -V2 -DVERSION="$V" -DNUMVER="${V%%-*}" installer.nsi)
INFO=$(tools/app-builder blockmap -i "$O/$EXE" -o "$O/$EXE.blockmap")
SHA=$(node -e "console.log(JSON.parse(process.argv[1]).sha512)" "$INFO"); SIZE=$(stat -c%s "$O/$EXE")
cat > "$O/latest.yml" <<YML
version: $V
files:
  - url: $EXE
    sha512: $SHA
    size: $SIZE
path: $EXE
sha512: $SHA
releaseDate: '$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'
YML
cp "$O/$EXE" "$O/AirRegister-AirposLook-Setup.exe"   # stable name for this app's own download link (same bytes)
echo "Built $O:"; ls -la "$O"
