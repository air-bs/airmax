#!/bin/bash
# Test runner for Air Register (AIR POS look). Own ports only: fake AIR POS 5180 (+hook 5181), cashier fake 5182 (+5183),
# Chrome DevTools 9433 (profile /tmp/chr-look). Kills ONLY the processes it started (never Coach's 5068-5075 / 9333).
# 1.0.10: ports / Chrome / log names can be moved with env (defaults above unchanged), e.g. the ui-1010 worktree run:
#   LOOK_FP=5187 LOOK_CP=5189 LOOK_CP_HOOK=off LOOK_CHROME=9434 LOOK_CHDIR=/tmp/chr-ui1010 LOOK_LOG=/tmp/ui1010- \
#   LOOK_PARITY_OURS_HOOK=off LOOK_PARITY_STORE=5188 LOGO_PORT=5187 PIC_PORT=5187 bash tests/run-all-look.sh
#   (fake 5187 + hook 5188, cashier 5189 with no hook, parity: ours 5187 no hook, store copy 5188 + its hook 5189)
cd "$(dirname "$0")/.."
FP=${LOOK_FP:-5221}; CP=${LOOK_CP:-5220}; CHP=${LOOK_CHROME:-9452}; CHDIR=${LOOK_CHDIR:-/tmp/chr-look-b2}; LOGP=${LOOK_LOG:-/tmp/look-b2-}
CPH=${LOOK_CP_HOOK:+FAKE_HOOK_PORT=$LOOK_CP_HOOK}; PSP=${LOOK_PARITY_STORE:-5226}; POH=${LOOK_PARITY_OURS_HOOK:+FAKE_HOOK_PORT=$LOOK_PARITY_OURS_HOOK}
export NODE_PATH=/workspace/air-register-styles-work/tests/node_modules CHROME_URL=http://127.0.0.1:$CHP
PIDS=(); CHR=
stopf() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done; PIDS=(); sleep 1; }
start() { stopf; for p in "$@"; do if [ "$p" = "$CP" ]; then env $CPH FAKE_PORT=$CP FAKE_CASHIER=1 node tests/look-fake.js >${LOGP}f$p.log 2>&1 & else env $FENV FAKE_PORT=$p node tests/look-fake.js >${LOGP}f$p.log 2>&1 & fi; PIDS+=($!); done; sleep 3; }
chrome() { [ -n "$CHR" ] && kill $CHR 2>/dev/null; sleep 1; rm -rf "$CHDIR"; google-chrome --headless=new --no-sandbox --remote-debugging-port=$CHP --user-data-dir="$CHDIR" about:blank >${LOGP}chr.log 2>&1 & CHR=$!; sleep 3; }
# local.9 (Stress Tester local.7): each group runs in its own process group; on timeout (or after it ends) the WHOLE group is
# stopped, so a timed-out group (dblpay-109 starts its own fake servers on 5184/5186) leaves nothing listening. rc 124 = timeout.
# dblpay-109 gets ${LOOK_DBL_TIMEOUT:-1200} s (it needs ~10 min under full-suite load), every other group ${LOOK_TIMEOUT:-600} s.
run() { name=$1; shift; local T=${LOOK_TIMEOUT:-600}; [ "$name" = dblpay-109 ] && T=${LOOK_DBL_TIMEOUT:-1200}; echo "===== $name"
  setsid env "$@" > ${LOGP}$name.log 2>&1 & local pg=$!
  ( trap 'kill $s 2>/dev/null; exit 0' TERM; sleep $T & s=$!; wait $s || exit 0; echo "TIMEOUT after $T s (group stopped)" >> ${LOGP}$name.log; kill -TERM -- -$pg 2>/dev/null; sleep 5; kill -KILL -- -$pg 2>/dev/null ) & local w=$!
  wait $pg; rc=$?; kill $w 2>/dev/null; wait $w 2>/dev/null   # stop the watchdog: its TERM trap ends its sleep and exits WITHOUT writing TIMEOUT (the old pkill-sleep-first order let it write a false TIMEOUT)
  if grep -q "^TIMEOUT after" ${LOGP}$name.log; then rc=124; fi
  kill -TERM -- -$pg 2>/dev/null; sleep 0.3; kill -KILL -- -$pg 2>/dev/null
  grep -E "FAIL|passed|failed|Error|SKIPPED|TIMEOUT" ${LOGP}$name.log | grep -vE "^PASS" | tail -8; echo "exit $rc"; }
# per-batch tests, picked up by glob (a batch only adds its files): `bash tests/run-all-look.sh api` runs just these two globs
api_unit() { for t in tests/api-*.test.js; do [ -f "$t" ] && run "$(basename "${t%.js}")" node "$t"; done; }
api_e2e() { for t in tests/e2e-api-*.js; do [ -f "$t" ] && { FENV="$(sed -n '1,15s#^// run-env: ##p' "$t" | head -1)"; chrome; start $FP; run "$(basename "${t%.js}")" FAKE_PORT=$FP node "$t"; FENV=; }; done; }
ONLY="${1:-all}"
if [ "$ONLY" = api ]; then api_unit; api_e2e; stopf; [ -n "$CHR" ] && kill $CHR 2>/dev/null; echo ALLDONE; exit 0; fi
if [ "$ONLY" = all ] || [ "$ONLY" = unit ]; then
for t in identity.test.js updater-identity.test.js backend-frozen.test.js stress7-109.test.js stress9-hold-110.test.js stress10-holddiff-109.test.js stress7-keyed-109.test.js sola-cof-109.test.js keys-unique.test.js stage-guard.test.js cart-arrows.test.js pay-arrows.test.js drawer-star.test.js drawer-paths.test.js receipt-variety.test.js print-speed.test.js split-card.test.js logout-stock.test.js f4-price.test.js card-refund.test.js customer-display.test.js customer-welcome-logo.test.js printcmd.test.js printing.test.js recovered-notice.test.js tax-off-manager.test.js v120.test.js fgh.test.js gift-receipt.test.js onp.test.js printer-background.test.js receipt-darkness.test.js receipt-driveronly.test.js star-futureprnt.test.js checkprinters.test.js hwfit.test.js hebrew-label.test.js hebrew-raster.test.js stockwarn.test.js stuck-stock-1011.test.js stuck-sale-discount-1011.test.js autoprint.test.js receipt-speed.test.js receipt-steps.test.js return-account.test.js side-panel.test.js bulkfolders-105.test.js total-check.test.js money-109.test.js small-bugs-109.test.js custmsg-109.test.js update-tap.test.js screenpics-1010.test.js print-label.test.js gift-pick.test.js reprint-nodrawer-15.test.js label-layouts.test.js add-speed-1011.test.js add-speed-1011-equiv.test.js multigift-1011.test.js m1-keep-1011.test.js taxtemp-1011.test.js sales-equiv-1011.test.js card-mock.js absent-local.js orders-tab.test.js quote-26.test.js card-slip-12.test.js disc-line-18.test.js card-poll-1011.test.js drawer-rules-1011.test.js f4-multibuy-1011.test.js f4-multibuy-edge.test.js instant-scan.test.js gift-receipt-19.test.js build-stage-complete.test.js; do
  [ -f tests/$t ] && run ${t%.js} node tests/$t
done
# 1.0.11-speed.1 adding items: the real server + fake AIR POS with a slow total check / product search (own port, no hook)
[ -f tests/add-speed-1011-server.js ] && run add-speed-1011-server ADD_PORT=${LOOK_ADD_PORT:-5191} node tests/add-speed-1011-server.js
# 1.0.11 review of instant scan / receipt prefetch: the repros of the reviewed commits (history) and the fixed tree (must all pass)
[ -f tests/review-instant-prefetch.test.js ] && run review-instant-prefetch REVIEW_PORT=${LOOK_REVIEW_PORT:-5262} node tests/review-instant-prefetch.test.js
[ -f tests/instant-fixes-1011.test.js ] && run instant-fixes-1011 INSTANT_FIX_PORT=${LOOK_FIX_PORT:-5263} node tests/instant-fixes-1011.test.js
# AirMax API batches (Step 0): every tests/api-*.test.js runs here (a batch only adds its file; these start their own fake server on their own port)
api_unit
# 1.0.9-local.2 double charge/refund fault injection (vendored stress-tester harness, own ports 5184 app + 5186 fake AIR POS)
[ -f tests/dblpay-109.js ] && run dblpay-109 node tests/dblpay-109.js
fi
if [ "$ONLY" = all ] || [ "$ONLY" = e2e ]; then
chrome; start $FP; run e2e-120 FAKE_PORT=$FP node tests/e2e-120.js
chrome; FENV=FAKE_STRICT_COMPLETE=1 start $FP; run e2e-account-one-enter FAKE_PORT=$FP node tests/e2e-account-one-enter.js
chrome; start $FP; run e2e-qr FAKE_PORT=$FP node tests/e2e-qr.js
chrome; start $FP; run e2e-icon FAKE_PORT=$FP node tests/e2e-icon.js
chrome; start $FP $CP; run e2e-settings FAKE_PORT=$FP CASHIER_PORT=$CP node tests/e2e-settings.js
chrome; start $FP $CP; run e2e-customer FAKE_PORT=$FP CASHIER_PORT=$CP node tests/e2e-customer.js
chrome; start $FP; run e2e-cart-arrows FAKE_PORT=$FP node tests/e2e-cart-arrows.js
chrome; FENV=FAKE_STRICT_COMPLETE=1 start $FP; run e2e-account-enter-3 FAKE_PORT=$FP node tests/e2e-account-enter-3.js # store request #3: Put on Account, one Enter, never twice (regression test only, no code change)
chrome; start $FP; run e2e-lost-conn-14 FAKE_PORT=$FP node tests/e2e-lost-conn-14.js # store request #14: waiting banner, plain message, sale kept
chrome; FENV=FAKE_ORDER_SUBS=1 start $FP; run e2e-receipt-panel-17 FAKE_PORT=$FP node tests/e2e-receipt-panel-17.js # store request #17: Last receipt screen stays open
chrome; start $FP; run e2e-order-disc-18 FAKE_PORT=$FP node tests/e2e-order-disc-18.js # store request #18: order discount % on every line
chrome; start $FP; run e2e-quote-26 FAKE_PORT=$FP node tests/e2e-quote-26.js # store request #26: Print Quote (not a sale)
chrome; FENV=FAKE_MEMBER_NOTE=1 start $FP; run e2e-member-note-21 FAKE_PORT=$FP FAKE_LOG=${LOGP}f$FP.log node tests/e2e-member-note-21.js # store request #21: customer note pop-up
chrome; start $FP; run e2e-price-change-23 FAKE_PORT=$FP node tests/e2e-price-change-23.js # store request #23: left Price Change button
chrome; start $FP $CP; run e2e-price-mgr-23 FAKE_PORT=$FP CASHIER_PORT=$CP node tests/e2e-price-mgr-23.js # store request #23: Price Change is manager-only
# AirMax Step 0: newest scanned line at the bottom (line 1 at the top); Qty / Delete / F4 / Edit tax / return lines hit the right line; top bar tabs
chrome; start $FP; run e2e-sale-line-order FAKE_PORT=$FP node tests/e2e-sale-line-order.js
# AirMax Step 0: nothing comes off Checkout (Gift Card, Multiple Gift Cards, Gift Card Balance, Customer add F3, Items, Checkout F12, every button and shortcut of master); named mount slots, Back Office tab, store name, section permission check
chrome; start $FP; run e2e-checkout-intact FAKE_PORT=$FP node tests/e2e-checkout-intact.js
chrome; start $FP; run e2e-mounts FAKE_PORT=$FP node tests/e2e-mounts.js
# AirMax batches: every tests/e2e-api-*.js (browser test of one batch) runs here, each on a fresh fake AIR POS on $FP with a fresh headless Chrome (CHROME_URL set).
# A batch only adds its file. Optional first-lines comment `// run-env: FAKE_HELD=1 FAKE_STRICT_COMPLETE=1` = extra env for the fake AIR POS (like FENV above).
api_e2e
chrome; start $FP; run e2e-pay-arrows FAKE_PORT=$FP node tests/e2e-pay-arrows.js
# 1.2.3 tests (Coach), on our ports; FENV = extra env for the fake AIR POS only
chrome; start $FP; run e2e-side-panel FAKE_PORT=$FP node tests/e2e-side-panel.js
chrome; start $FP; run e2e-refund-panel FAKE_PORT=$FP node tests/e2e-refund-panel.js
# AirMax 1.0.2: payment/refund panels fit 1024x768, 1280x720, 1366x768 (+1280x800); key labels kept
chrome; start $FP; run e2e-fit-102 FAKE_PORT=$FP node tests/e2e-fit-102.js
# AirMax 1.0.3: colour stripes look (stripe colours by group, no icons, dark totals bar, bigger scan box, all buttons + key labels kept)
chrome; start $FP; run e2e-stripes-103 FAKE_PORT=$FP node tests/e2e-stripes-103.js
# AirMax 1.0.4: RustDesk remote help ID (ID only) in the status bar + on the Reconnecting screen; runs its own fake servers (faked RustDesk status)
chrome; stopf; run e2e-rdid-104 FAKE_PORT=$FP node tests/e2e-rdid-104.js
# AirMax 1.0.5: bulk item folders (open/Back, Alt keys on the first 12 visible spots, Alt+Backspace, 24 spots scroll+tap, top after sale/new/hold/load hold, whole-save check, totals)
chrome; FENV="FAKE_HELD=1 FAKE_STRICT_COMPLETE=1" start $FP; run e2e-bulkfolders-105 FAKE_PORT=$FP node tests/e2e-bulkfolders-105.js
# AirMax 1.0.6: Coach's 1.2.3.1 hotfix (Back to sale (payments kept) + Esc, Check AIR POS again, red "Paid $X: sale not finished" bar, refusal log); screenshots 1366 + 1024
chrome; FENV=FAKE_STRICT_COMPLETE=1 start $FP; run e2e-stuck-106 FAKE_PORT=$FP node tests/e2e-stuck-106.js
# AirMax 1.0.11 (airmax-fix-stock): payment screen never freezes on a Complete failure - refusal, timeout, lost reply, HTTP 500; reason kept + logged, Finish sale retries safely (one card payment)
chrome; FENV=FAKE_STRICT_COMPLETE=1 start $FP; run e2e-stuck-stock-1011 FAKE_PORT=$FP node tests/e2e-stuck-stock-1011.js
# AirMax 1.0.11 (airmax-fix-stock, a live-store sale): order % discount then items added/removed/quantity changed: AIR POS due = card charge; mismatch blocks before the card
chrome; FENV=FAKE_STRICT_COMPLETE=1 start $FP; run e2e-stuck-discount-1011 FAKE_PORT=$FP node tests/e2e-stuck-discount-1011.js
# AirMax 1.0.6 Team Kit: History Resume asks before clearing a sale with items; Alt+letter labels readable on coloured window buttons
chrome; FENV="FAKE_HELD=1 FAKE_STRICT_COMPLETE=1" start $FP; run e2e-teamkit-106 FAKE_PORT=$FP node tests/e2e-teamkit-106.js
# 1.0.7 wide Customer add | Items | Checkout boxes + customer card (Ari OK 12:30 AM Oct 30, option A); made-up customers 5550100 / 5550101 in the fake
chrome; start $FP; run e2e-wide-customer-107 FAKE_PORT=$FP node tests/e2e-wide-customer-107.js
# 1.0.8 payment pop-up (payment, split, refund, stuck states; strict fake for the stuck part)
# 1.0.11-local.8 Temporary Item Taxable switch (on by default), F7 + left button, F5 Tax Off, Settings > Returns tax pick
chrome; start $FP; run e2e-taxtemp-1011 FAKE_PORT=$FP node tests/e2e-taxtemp-1011.js
chrome; FENV="FAKE_STRICT_COMPLETE=1" start $FP; run e2e-popup-108 FAKE_PORT=$FP node tests/e2e-popup-108.js
# 1.0.9 card on file (Ari OK 1:25 AM Oct 30; Stripe stores only; fake Stripe.js, made-up cards; fresh fake: keyed mode set before login; reads the fake log ${LOGP}f$FP.log for secrets)
chrome; FENV="FAKE_STRICT_COMPLETE=1" start $FP; run e2e-card-on-file-109 FAKE_LOG=${LOGP}f$FP.log FAKE_PORT=$FP node tests/e2e-card-on-file-109.js
# 1.0.9 Team Kit money fix (b): Clock In/Out read "1,250.00" / "$100" (were sent as $0); fix (a) is in money-109.test.js
# 1.0.9 Sola card on file (Ari OK 9:33 PM ET Oct 31, local only; off by default): fresh strict fake, reads the fake log for secrets
chrome; FENV="FAKE_STRICT_COMPLETE=1" start $FP; run e2e-sola-cof-109 FAKE_LOG=${LOGP}f$FP.log FAKE_PORT=$FP node tests/e2e-sola-cof-109.js
chrome; start $FP; run e2e-clock-amount-109 FAKE_PORT=$FP node tests/e2e-clock-amount-109.js
# local 1.0.9.1 low-risk UI fixes (Stress Tester): (a) Product Search late reply after Esc, (d) ask-price bulk 2nd tap
chrome; start $FP; run e2e-lowrisk-1091 FAKE_PORT=$FP node tests/e2e-lowrisk-1091.js
# Temporary Item (left column + rename) and product search prices (Ari 11:05 PM ET Oct 31); fake ProductPaged in the real AIR POS shape
chrome; FENV="FAKE_SEARCH_EXTRA=1" start $FP; run e2e-tempitem-search FAKE_PORT=$FP node tests/e2e-tempitem-search.js
chrome; start $FP; run e2e-stress7-ui-109 FAKE_PORT=$FP node tests/e2e-stress7-ui-109.js
chrome; start $FP; run e2e-stress9-cash2-110 FAKE_PORT=$FP node tests/e2e-stress9-cash2-110.js
chrome; start $FP; run e2e-gift-receipt FAKE_PORT=$FP node tests/e2e-gift-receipt.js
# 1.0.11-local.6g (Ari OK 6:06 PM ET Nov 1): pick-items gift receipt (F10 pick screen, Cancel, all ticked = old path)
chrome; start $FP; run e2e-gift-pick FAKE_PORT=$FP node tests/e2e-gift-pick.js
chrome; start $FP $CP; run e2e-fghi FAKE_PORT=$FP CASHIER_PORT=$CP node tests/e2e-fghi.js
# local.8 (Ari OK 8:29 PM Oct 31): Gift Card line, amount + Enter with no card -> gift card box, nothing paid; Enter in the box = Check
chrome; start $FP; run e2e-gc-enter FAKE_PORT=$FP node tests/e2e-gc-enter.js
chrome; FENV=FAKE_AUTOPRINT=1 start $FP; run e2e-kl FAKE_PORT=$FP node tests/e2e-kl.js
chrome; start $FP; run e2e-final FAKE_PORT=$FP node tests/e2e-final.js
# 1.0.10-local.2 (Ari 12:17 / 12:22 PM Nov 1): ONE Enter from Sale complete to the next sale; stock warning OFF = straight to pay, ON = Check first + Alt+T (fresh fake each)
chrome; start $FP; run e2e-one-enter FAKE_PORT=$FP node tests/e2e-one-enter.js
chrome; start $FP; run e2e-one-enter-stockon ONE_ENTER_STOCK=on FAKE_PORT=$FP node tests/e2e-one-enter.js
chrome; start $FP; run e2e-customer-enter FAKE_PORT=$FP node tests/e2e-customer-enter.js
chrome; start $FP; run e2e-split-card FAKE_PORT=$FP node tests/e2e-split-card.js
chrome; start $FP; run e2e-split-card-timing FAKE_PORT=$FP node tests/e2e-split-card-timing.js # 1.0.11-local.1: card approved at poll 1/4/12, cash once and only after
chrome; start $FP; run e2e-f4-price FAKE_PORT=$FP node tests/e2e-f4-price.js # 1.0.11-local.3: F4 % off / $ off / New price, prefilled, higher refused, equal = no discount
chrome; start $FP; run e2e-gift-list-due FAKE_PORT=$FP node tests/e2e-gift-list-due.js # 1.0.11-local.4g: Ctrl+Shift+B gift balance list (read only) + part-paid Due display
chrome; FENV=FAKE_STRICT_COMPLETE=1 start $FP; run e2e-total-check FAKE_PORT=$FP node tests/e2e-total-check.js
chrome; FENV=AIRREG_DEV_PROBE=1 start $FP; run e2e-update-tap FAKE_PORT=$FP node tests/e2e-update-tap.js
# 1.0.10 UI (Ari OK 11:12 AM Oct 30): welcome picture, register logo above the total, two-line Hold, "Please use the card reader"
chrome; start $FP; run e2e-ui-1010 FAKE_PORT=$FP node tests/e2e-ui-1010.js
# 1.0.9-local.5: Air Max name + per-shop customer screen messages + 4:20 PM display items (screens rename-*.png, custmsg-*.png at 1366)
chrome; start $FP $CP; run e2e-custmsg-109 FAKE_PORT=$FP CASHIER_PORT=$CP CHROME_URL=http://127.0.0.1:$CHP node tests/e2e-custmsg-109.js
# Print Label (Ctrl+Shift+P, left column) + Add Gift Receipt moved to the left column + Settings > Labels (Ari OK 2:30 PM Oct 30, "do it now"); dev sink stands in for the label printer
chrome; FENV="AIRREG_DEV_PROBE=1 AIRMAX_LABEL_SINK=/tmp/look-labels FAKE_SALE=1" start $FP; run e2e-print-label LABEL_SINK=/tmp/look-labels FAKE_PORT=$FP node tests/e2e-print-label.js
# 1.0.11-local.9 Print Labels with layouts (Ari OK 6:30 PM ET Nov 1): grid, layout per row, Label price (printout only), guard, defaults
chrome; FENV="AIRREG_DEV_PROBE=1 AIRMAX_LABEL_SINK=${LOGP}labels2 FAKE_SALE=1" start $FP; run e2e-print-labels LABEL_SINK=${LOGP}labels2 FAKE_PORT=$FP node tests/e2e-print-labels.js
# Orders tab phase 1 (PLAN-orders-tab.md; branch claude/orders-tab, needs Ari's OK): view and search only; fake with 130 made-up orders
chrome; FENV="FAKE_ORDERS=1" start $FP; run e2e-orders-tab FAKE_PORT=$FP node tests/e2e-orders-tab.js
# AirMax #18 (Ari, Nov 2 2026): "33% off -$9.90" under each discounted item, green on the screen + on the printed receipt (fake real-receipt PDFs, display / print only)
chrome; FENV="FAKE_REAL_RECEIPT=1" start $FP; run e2e-disc-line-18 FAKE_PORT=$FP node tests/e2e-disc-line-18.js
# #18 printed once (owner, Nov 3): each item discount exactly once on real fake receipts, 4 template styles x %/$/multi-buy/sale discount/return/reprint (no browser)
stopf; FENV="FAKE_REAL_RECEIPT=1" start $FP; run e2e-disc-once-18 FAKE_PORT=$FP node tests/e2e-disc-once-18.js
# #19 (owner review pending): gift card last 4 + balance on the main receipt's print copy; no separate slip when stamped, slip when not (no browser)
stopf; FENV="FAKE_REAL_RECEIPT=1 FAKE_PRINT_LOG=1" start $FP; run e2e-gift-receipt-19 FAKE_PORT=$FP node tests/e2e-gift-receipt-19.js
# 1.0.11 instant scan (the owner): setting OFF = same AIR POS calls as master; ON = list from the app opening, background check, Pay waits (fresh fake, no browser)
stopf; start $FP; run e2e-instant-scan FAKE_PORT=$FP node tests/e2e-instant-scan.js
chrome; start $FP; run e2e-instant-ui FAKE_PORT=$FP node tests/e2e-instant-ui.js
# 38,000 made-up products, 50 ms AIR POS round trip: paged startup download, disk, memory, scan and search times
stopf; FENV="AIRREG_DEV_PROBE=1 FAKE_PRODUCTS=38000 FAKE_LATENCY_MS=50" start $FP; run instant-38k FAKE_PORT=$FP node tests/instant-38k.js
# Gift card list (last 4 + balance), returns (full / partial / F4 typed price) and Tax Off; fake prints logged; cashier fake for the Tax Off note
chrome; FENV="FAKE_PRINT_LOG=1" start $FP $CP; run e2e-gift-returns-taxoff FAKE_PORT=$FP CASHIER_PORT=$CP node tests/e2e-gift-returns-taxoff.js
# 1.0.11 receipt prefetch: card approved -> receipt to the printer, by stage, 700 ms per AIR POS call; one receipt per sale, none when Complete is refused (no browser)
stopf; FENV="FAKE_STRICT_COMPLETE=1" start $FP; run e2e-receipt-prefetch FAKE_PORT=$FP node tests/e2e-receipt-prefetch.js
# 1.0.11 startup / search speed: app open -> ready to scan by stage, product + customer search (API and screen), 50-150 ms per AIR POS call; starts its own fake servers on $((FP+10))
chrome; stopf; run e2e-startup-search-speed STARTUP_PORT=$((FP+10)) node tests/e2e-startup-search-speed.js
[ -f tests/settings-parity.test.js ] && { stopf; run settings-parity $POH PARITY_OURS_PORT=$FP STORE_PARITY_PORT=$PSP node tests/settings-parity.test.js; }
[ -f tests/e2e-totals-parity.js ] && { chrome; stopf; run e2e-totals-parity $POH PARITY_OURS_PORT=$FP STORE_PARITY_PORT=$PSP node tests/e2e-totals-parity.js; }
[ -f tests/e2e-look.js ] && { chrome; start $FP; run e2e-look FAKE_PORT=$FP node tests/e2e-look.js; }
fi
stopf; [ -n "$CHR" ] && kill $CHR 2>/dev/null
echo ALLDONE
