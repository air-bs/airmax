// AirMax 1.0.11 instant scan (approved for 1.0.11): the Settings > "Instant scan" switch (OFF by default, this PC), a grey
// "checking" look on sale lines AIR POS has not confirmed yet, a quick refresh until they are, and AIR POS's corrections / removals as
// short notes. Everything else on the screen (labels, keys, buttons) is unchanged. Server side: app/instantscan.js.
'use strict';
(() => {
  let seen = null, timer = null;
  const prev = window.afterRefresh;
  window.afterRefresh = () => {
    if (prev) prev();
    const I = (typeof S !== 'undefined' && S && S.instant) || null; if (!I) return;
    document.querySelectorAll('#cart tr.row').forEach(tr => tr.classList.toggle('pend', S.mode === 'sale' && (I.pendingRows || []).includes(+tr.dataset.row)));
    const notes = I.notes || [];
    if (seen === null) seen = notes.length ? notes[notes.length - 1].id : 0; // notes from before this page was opened are not shown again
    for (const n of notes) if (n.id > seen) { seen = n.id; if (typeof softNote === 'function') softNote(n.message, n.kind === 'err' ? 'err' : 'warn'); }
    if (I.pending && !timer) timer = setTimeout(async () => { timer = null; if (typeof busy !== 'undefined' && !busy && typeof refresh === 'function') await refresh(); else window.afterRefresh(); }, 200);
  };
  const say = I => !I || !I.on ? 'Off (default): scanning and search work exactly as before.'
    : I.ready ? `On: ${I.count} products saved on this PC (${I.from === 'saved' ? 'saved list from ' + new Date(I.at).toLocaleString('en-US') : 'loaded when Air Max opened'}). A scanned item shows at once and AIR POS checks it right after; Pay waits until every line is checked.`
      : I.loading ? `On: loading the product list from AIR POS (${I.loading.done}${I.loading.total ? ' of ' + I.loading.total : ''})… until it is complete, scanning works as before.`
        : 'On: the product list is not loaded yet (it loads when Air Max opens). Until then, scanning works as before.';
  // the switch, under "Warn before selling below zero stock" in Settings > Printer & Drawer
  const mount = () => {
    const after = document.getElementById('seSWnote'); if (!after || document.getElementById('seIS')) return;
    const I = (typeof S !== 'undefined' && S && S.instant) || {};
    const w = document.createElement('div');
    w.innerHTML = `<label class="f chk" style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="seIS" style="width:20px;height:20px" ${I.on ? 'checked' : ''}> Instant scan</label><p class="note" id="seISnote"></p>`;
    after.after(...w.childNodes);
    const note = document.getElementById('seISnote'); note.textContent = say(I);
    document.getElementById('seIS').onchange = async e => { const x = await api('instant-scan', { on: e.target.checked }); note.textContent = x && x.ok ? x.message : 'Not changed: ' + ((x && x.message) || ''); if (!(x && x.ok)) e.target.checked = !e.target.checked; };
  };
  const root = document.getElementById('modalRoot'); if (root) new MutationObserver(mount).observe(root, { childList: true, subtree: true });
})();
