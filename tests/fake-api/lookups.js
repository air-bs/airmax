// Fake AIR POS answers for AirMax batch 1 (calls 11, 14-19). Made-up data only. Shapes copied from TestShop replies (bare arrays / objects, no success wrapper).
// 14 RetailTaxKindSelect is already answered by tests/fake-server.js (bare array); it is only wrapped here (call counter + the failure switch).
// Hook /lookups-fail?on=1 makes all of these answer a network error (off=0). Hook /lookups-state -> { calls: { <path>: n }, regionBodies: [...] }  (what the register asked, never a reply).
module.exports = ({ handlers, hooks, fake, J }) => {
  const st = fake.lookups = { calls: {}, regionBodies: [] };
  const count = (path, fn) => { handlers[path] = p => { st.calls[path] = (st.calls[path] || 0) + 1; if (st.fail) return { success: false, message: 'Network error: ETIMEDOUT (test)', unreachable: true }; return fn(p || {}); }; };
  { const tk = handlers['/Commons/RetailTaxKindSelect']; count('/Commons/RetailTaxKindSelect', p => tk(p)); }
  // the terminal record is kept in memory so a save can be read back (call 12 saves; call 11 reads what was saved)
  const term0 = () => ({ id: 'tc-1', corpId: 'corp-1', shopId: 'shop', saleStationId: '00000000-0000-0000-0000-000000000000',
    checkoutAutoPrint: true, returnAutoPrint: true, autoOpenCashDrawer: true, useVirtualKeyboard: false, cashCheckoutConfirm: false,
    soundAlerts: true, printerName: 'Made-up Receipt Printer', enableShortcut: false, shortcuts: '' });
  let term = term0();
  count('/Commons/RetailTerminalConfigGet', () => process.env.FAKE_TERMCFG_EMPTY === '1' ? null : JSON.parse(JSON.stringify(term)));
  // call 12: what the register sent is recorded (never logged), then applied to the in-memory record. FAKE_TERMSAVE_FAIL=1 makes AIR POS refuse.
  handlers['/Commons/RetailTerminalConfigSave'] = p => { st.saveCalls = (st.saveCalls || 0) + 1; const body = J(p, 'submit'); st.saves = (st.saves || []).concat([body]);
    if (process.env.FAKE_TERMSAVE_FAIL === '1') return { success: false, message: 'AIR POS refused (test)' };
    if (!body || body.id !== term.id) return { success: false, message: 'Unknown terminal (test)' };
    for (const k of Object.keys(body)) if (k !== 'id') term[k] = body[k]; return { success: true, value: null, message: 'Saved' }; };
    count('/Commons/RetailConfigGet', p => ({ basicSetting: { loginByFingerPrint: false, cashBoxOpenNeedVerify: false, onlyManagerReturnAble: true, secretKeyText: 'x' }, priceSetting: { shopDiscountRateLimit: 20, discountMarkRate: 10 },
    inventorySetting: { useWmsStock: false, retailOrderStockCheck: true, managerAuthorizationRequired: true }, reportSetting: { useShopName: true, autoGenerateZRead: true }, pointSetting: { pointExpiredDays: 100, pointByShop: true },
    receiptSetting: { corpName: 'Fake Shop', corpAddress: '1 Made-up Way', closingLine: 'Thank you!', remarks: '', corpTaxId: 'TAX-SECRET' }, paymentSetting: { stripeKey: 'sk_SECRET' }, apiKeys: { a: 'SECRET' }, extraChargeSetting: [] }));
  // the real servers answer HTTP 404 (not JSON) for this one; the client turns that into { success:false, message:'Non-JSON reply (HTTP 404)', uncertain:true }
  count('/Commons/RetailOrderPaymentTypeSelect', () => process.env.FAKE_PAYTYPES === 'yes' ? [{ key: '10', name: 'Cash' }, { key: '20', name: 'Card' }] : { success: false, message: 'Non-JSON reply (HTTP 404)', uncertain: true });
  count('/Commons/RetailOrderSubPaymentTypeSelect', () => process.env.FAKE_SUBPAY === 'yes' ? { 10: [], 20: [{ key: 'visa', name: 'Visa' }, { key: 'mc', name: 'Mastercard' }], 30: [] } : { 10: [], 20: [], 30: [] });
  count('/Commons/ProductOriginSelect', () => [{ key: 'AA001', name: 'Anguilla', code: '' }, { key: 'AA002', name: 'Argentina', code: 'AR' }, { key: 'AA003', name: 'Brazil', code: 'BR' }]);
  count('/Categories/CategorySelectAsTreeNode', () => [
    { sort: 0, imagePath: '', id: 'c-1', parentId: null, value: '00AA', label: 'Made-up Toys', disable: false, childs: [
      { id: 'c-1a', parentId: 'c-1', value: '00AA0001', label: 'Cars', disable: false, childs: [] },
      { id: 'c-1b', parentId: 'c-1', value: '00AA0002', label: 'Dolls', disable: true, childs: [{ id: 'c-1b1', parentId: 'c-1b', value: '00AA000201', label: 'Doll clothes', disable: false, childs: [] }] }] },
    { sort: 1, imagePath: '', id: 'c-2', parentId: null, value: '00AB', label: 'Made-up School', disable: false, childs: [] }]);
  count('/Regions/RegionSelect', p => { st.regionBodies.push({ type: p.type, countryCode: p.countryCode }); return String(p.countryCode) === 'US' && String(p.type) === '2'
    ? [{ name: 'Alabama', code: 'AL', phoneCode: '1', countryCode: 'US', stateCode: 'AL' }, { name: 'Alaska', code: 'AK', phoneCode: '1', countryCode: 'US', stateCode: 'AK' }, { name: 'New York', code: 'NY', phoneCode: '1', countryCode: 'US', stateCode: 'NY' }]
    : []; });
  hooks['/lookups-fail'] = (u, res, f) => { f.lookups.fail = u.searchParams.get('on') === '1'; res.end('{"ok":true}'); };
  hooks['/lookups-reset'] = (u, res, f) => { term = term0(); f.lookups.saves = []; f.lookups.saveCalls = 0; res.end('{"ok":true}'); };
  hooks['/lookups-state'] = (u, res, f) => res.end(JSON.stringify({ calls: f.lookups.calls, regionBodies: f.lookups.regionBodies, saveCalls: f.lookups.saveCalls || 0, saves: f.lookups.saves || [] }));
};
