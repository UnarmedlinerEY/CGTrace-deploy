/* CostBase Pro — validation vectors (Phase 1)
   Shared by tests/run-node.js and test-runner.html.
   Sources: cgt_v6_bill_validation.md §3 (Bill ss.112-155(2)/102-5/Div 119 worked example,
   Cowell Clarke + engine vectors) and tracker seven-dimension conservation checks. */
(function (global) {
'use strict';

const D = typeof module !== 'undefined' ? require('../src/domain.js') : global.CBPDomain;
const BILL = D.RULESETS['bill-2026'];
const CURRENT = D.RULESETS['current-law'];

const approx = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 0.01 : tol);

const VECTORS = [];
function vec(name, source, fn) { VECTORS.push({ name, source, fn }); }

/* ── 1. Bill ss.112-155(2)/102-5/Div 119 worked example (Cowell Clarke, exact) ── */
const ccCpi = Math.pow(1.3, 1 / 5) - 1; // calibrated so indexed CB = $6.5m per the worked example
const ccInp = D.makeInput({
  ac: 'shares', // commercial (non-residential) proxy
  ledger: [{ date: '2001-07-01', amount: 1000000, el: '1' }],
  pd: '2001-07-01', sd: '2032-07-01', sp: 8000000,
  mv27: 5000000, valMethod: 'actual', cpi: ccCpi
});
const cc = D.calcS(ccInp, BILL);
vec('CC-1 deferred non-residential gain $4.0m', 'Bill ss.112-155(2)/102-5/Div 119 worked example (Cowell Clarke, 3 Jun 2026)', () => approx(cc.transA.preGain, 4000000));
vec('CC-2 discounted deferred gain (Step 5) $2.0m', 'Bill ss.112-155(2)/102-5/Div 119 worked example (Cowell Clarke, 3 Jun 2026)', () => approx(cc.transA.trail.discounted, 2000000));
vec('CC-3 indexed CB at sale $6.5m', 'Bill ss.112-155(2)/102-5/Div 119 worked example (Cowell Clarke, 3 Jun 2026)', () => approx(cc.transA.idxCB2027, 6500000, 1));
vec('CC-4 post-2027 gain $1.5m', 'Bill ss.112-155(2)/102-5/Div 119 worked example (Cowell Clarke, 3 Jun 2026)', () => approx(cc.transA.postReal, 1500000, 1));
vec('CC-5 net capital gain (Step 7) $3.5m', 'Bill ss.112-155(2)/102-5/Div 119 worked example (Cowell Clarke, 3 Jun 2026)', () => approx(cc.transA.trail.net, 3500000, 1));
vec('CC-6 minimum tax gain excludes deferred — $1.5m', 'Bill ss.112-155(2)/102-5/Div 119 worked example (Cowell Clarke, 3 Jun 2026)', () => approx(cc.transA.trail.minTaxGain, 1500000, 1));

/* ── 2–3. Expense-by-expense quarterly indexation ──────────────────────── */
const e3Inp = D.makeInput({ ledger: [{ date: '2028-01-01', amount: 100000, el: '1' }, { date: '2029-01-01', amount: 10000, el: '3' }],
  pd: '2028-01-01', sd: '2031-01-01', sp: 200000, cpi: 0.04 });
const e3 = D.calcS(e3Inp, BILL);
vec('IDX-1 Element 3 never indexed', 'validation doc §3', () => approx(e3.newICB, 100000 * Math.pow(1.04, 3) + 10000, 0.5));
const e4Inp = D.makeInput({ ledger: [{ date: '2028-01-01', amount: 100000, el: '1' }, { date: '2029-01-01', amount: 10000, el: '4' }],
  pd: '2028-01-01', sd: '2031-01-01', sp: 200000, cpi: 0.04 });
const e4 = D.calcS(e4Inp, BILL);
vec('IDX-2 Element 4 indexed from its own quarter', 'validation doc §3', () => approx(e4.newICB, 100000 * Math.pow(1.04, 3) + 10000 * Math.pow(1.04, 2), 0.5));

/* ── 4. Deferred LOSS crystallises into Step 1 ─────────────────────────── */
const dlInp = D.makeInput({ ledger: [{ date: '2020-01-01', amount: 500000, el: '1' }],
  pd: '2020-01-01', sd: '2030-01-01', sp: 800000, mv27: 400000, valMethod: 'actual' });
const dl = D.calcS(dlInp, BILL);
vec('LOSS-1 deemed event crystallises $100k deferred loss', 'validation doc §3', () => approx(dl.transA.defLoss, 100000));
vec('LOSS-2 deferred loss enters Step 1 against NR', 'validation doc §3', () => approx(dl.transA.trail.step1.NR || 0, 100000));

/* ── 5. Step-1 drain order DNR → DR → NR → R ───────────────────────────── */
const doInp = D.makeInput({ ledger: [{ date: '2028-01-01', amount: 100000, el: '1' }],
  pd: '2028-01-01', sd: '2030-07-01', sp: 120000,
  oDNR: 1000, oDR: 1000, oNR: 1000, oR: 1000, clCur: 2500 });
const dor = D.calcS(doInp, BILL);
vec('ORD-1 losses drain DNR first', 'validation doc §3', () => approx(dor.msPort.step1.DNR, 1000));
vec('ORD-2 then DR', 'validation doc §3', () => approx(dor.msPort.step1.DR, 1000));
vec('ORD-3 then NR partially', 'validation doc §3', () => approx(dor.msPort.step1.NR, 500));
vec('ORD-4 R untouched at Step 1', 'validation doc §3', () => approx(dor.msPort.step1.R || 0, 0));

/* ── 6. Quarantined amounts: Steps 3–4, never non-residential ──────────── */
const qInp = D.makeInput({ ac: 'property_est',
  ledger: [{ date: '2020-01-01', amount: 100000, el: '1' }],
  pd: '2020-01-01', sd: '2030-07-01', sp: 250000, mv27: 150000, valMethod: 'actual', qr: 60000 });
const q = D.calcS(qInp, BILL);
vec('QR-1 Step 3 → deferred residential ($50k)', 'validation doc §3', () => approx(q.transA.trail.step3, 50000));
vec('QR-2 Step 4 remainder → residential ($10k)', 'validation doc §3', () => approx(q.transA.trail.step4, 10000));
vec('QR-3 quarantine never touches NR', 'validation doc §3', () => approx(q.transA.trail.NRfinal, 0) && approx(q.transA.trail.qrUnused, 0));

/* ── 7. Minimum tax floor (simple mode, low MTR) ───────────────────────── */
const mtInp = D.makeInput({ ledger: [{ date: '2028-01-01', amount: 100000, el: '1' }],
  pd: '2028-01-01', sd: '2030-07-01', sp: 160000, mtr: 0.16 });
const mt = D.calcS(mtInp, BILL);
vec('MIN-1 30% floor binds at 16% MTR', 'validation doc §3', () => approx(mt.newTax, mt.ms.minTaxGain * 0.30, 0.5) && mt.newTax > mt.ms.minTaxGain * 0.16);
const isInp = D.makeInput({ ledger: [{ date: '2028-01-01', amount: 100000, el: '1' }],
  pd: '2028-01-01', sd: '2030-07-01', sp: 160000, mtr: 0.16, incsup: true });
const is = D.calcS(isInp, BILL);
vec('MIN-2 income-support exemption disapplies floor', 'validation doc §3', () => approx(is.newTax, is.ms.minTaxGain * 0.16, 0.5));

/* ── 8. Foreign resident ≥1 day: no indexation, no discount ────────────── */
const frInp = D.makeInput({ ledger: [{ date: '2020-01-01', amount: 100000, el: '1' }],
  pd: '2020-01-01', sd: '2030-07-01', sp: 200000, foreignRes: true });
const fr = D.calcS(frInp, BILL);
vec('FR-1 foreign resident: taxable gain = nominal gain', 'validation doc §3', () => approx(fr.newTG, fr.gainAL) && fr.foreignDisqualified);

/* ── 9. Pre-CGT company pathway ────────────────────────────────────────── */
const pcInp = D.makeInput({ inv: 'company', pv: 1000000,
  ledger: [{ date: '1980-01-01', amount: 200000, el: '1' }, { date: '2028-01-01', amount: 50000, el: '1' }],
  pd: '1980-01-01', sd: '2030-07-01', sp: 2000000 });
const pc = D.calcS(pcInp, BILL);
vec('PCGT-1 company: MV + post-2027 costs, no indexation', 'validation doc §3', () => approx(pc.newICB, 1050000));
vec('PCGT-2 company: 30% on gain', 'validation doc §3', () => approx(pc.newTax, (2000000 - 1050000) * 0.30, 0.5));

/* ── 10. K6 deferred gain crystallisation ──────────────────────────────── */
const k6Base = D.makeInput({ pv: 1000000, ledger: [{ date: '1980-01-01', amount: 200000, el: '1' }],
  pd: '1980-01-01', sd: '2030-07-01', sp: 1500000 });
const k6Off = D.calcS(k6Base, BILL);
const k6On = D.calcS(Object.assign({}, k6Base, { k6: 'yes', k6Gain: 100000 }), BILL);
vec('K6-1 deferred K6 gain adds 50%-disc tax (ASSUMED)', 'validation doc §4', () => approx(k6On.newTax - k6Off.newTax, 100000 * 0.5 * 0.47, 0.5));

/* ── 11. New build: affordable 60% discount, no min tax ────────────────── */
const nbInp = D.makeInput({ ac: 'property_new', nbt: 'affordable', nbc: 'discount',
  ledger: [{ date: '2020-01-01', amount: 500000, el: '1' }],
  pd: '2020-01-01', sd: '2030-07-01', sp: 800000 });
const nb = D.calcS(nbInp, BILL);
vec('NB-1 affordable 60% discount pathway', 'validation doc §3', () => approx(nb.newTG, 300000 * 0.4, 0.5) && approx(nb.newTax, 300000 * 0.4 * 0.47, 0.5));

/* ── 12. 12-month gate ─────────────────────────────────────────────────── */
const sgInp = D.makeInput({ ledger: [{ date: '2030-01-01', amount: 100000, el: '1' }],
  pd: '2030-01-01', sd: '2030-06-01', sp: 120000 });
const sg = D.calcS(sgInp, BILL);
vec('GATE-1 <12m: no discount, no indexation', 'validation doc §3', () => approx(sg.newTG, sg.gainAL) && !sg.held12m);

/* ── 13. SMSF ⅓ discount (M-SMSF, ASSUMED unaffected) ──────────────────── */
const smsfInp = D.makeInput({ inv: 'smsf', ledger: [{ date: '2020-01-01', amount: 100000, el: '1' }],
  pd: '2020-01-01', sd: '2026-06-01', sp: 160000 });
const smsf = D.calcS(smsfInp, BILL);
vec('SMSF-1 one-third discount pre-2027 sale', 'mapping spec M-SMSF', () => approx(smsf.newTG, 60000 * (2 / 3), 0.5));

/* ── 14. Ruleset switch: current-law has no 30% floor ──────────────────── */
const rsInp = D.makeInput({ ledger: [{ date: '2028-01-01', amount: 100000, el: '1' }],
  pd: '2028-01-01', sd: '2030-07-01', sp: 160000, mtr: 0.16 });
const rsCur = D.calcS(rsInp, CURRENT);
vec('RULE-1 current-law ruleset: no minimum tax floor', 'rules-as-data M1', () => approx(rsCur.newTax, rsCur.ms.minTaxGain * 0.16, 0.5));

/* ── 15–19. Corporate action conservation checks ───────────────────────── */
function mkHolding() {
  return { id: 'h1', ticker: 'TST', name: 'Test Co', type: 'Share',
    parcels: [
      { id: 'p1', origin: 'PURCHASE', acquisitionDate: '2015-03-01', qty: 1000, costPerUnit: 10, totalCost: 10000, status: 'active', sourceActionId: null, sourceRightsId: null, replacesParcelId: null, notes: '' },
      { id: 'p2', origin: 'DRP', acquisitionDate: '2018-09-01', qty: 500, costPerUnit: 12, totalCost: 6000, status: 'active', sourceActionId: null, sourceRightsId: null, replacesParcelId: null, notes: '' }
    ], adjustments: [], actions: [], cgtEvents: [] };
}
const sp1 = D.applyShareSplit(mkHolding(), { splitRatio: 2, recordDate: '2024-01-01' });
vec('CA-1 split: totalCost preserved exactly, qty × ratio', 'tracker dim spec', () =>
  approx(sp1.parcels[0].totalCost, 10000) && approx(sp1.parcels[0].qty, 2000) && approx(sp1.parcels[0].costPerUnit, 5, 0.0001));

const co1 = D.applyConsolidation(mkHolding(), { consolidationRatio: 5, recordDate: '2024-01-01', effectiveDate: '2024-01-02', rolloverAvailable: true });
const coNew = co1.parcels.find(p => p.origin === 'CONSOLIDATION');
vec('CA-2 consolidation: pooled cost conserved, earliest date inherited', 'tracker dim spec', () =>
  approx(coNew.totalCost, 16000) && coNew.acquisitionDate === '2015-03-01' && approx(coNew.qty, 300));

const cr1 = D.applyCapitalReturn(mkHolding(), { returnPerShare: 11, recordDate: '2024-01-01', paymentDate: '2024-01-15' });
const p1eff = D.getEffectiveCostBase(cr1.parcels.find(p => p.id === 'p1'), cr1.adjustments);
const g1 = cr1.cgtEvents.find(e => e.eventType === 'G1');
vec('CA-3 capital return: G1 fires when CB < 0, resets to $0', 'tracker dim spec', () =>
  approx(p1eff, 0) && g1 && approx(g1.capitalGain, 1000));

const dm1 = D.applyDemerger(mkHolding(), { demergedTicker: 'NEW', demergedEntityName: 'NewCo', apportionmentPct: 0.3, demergerShareRatio: '1:1', rolloverElected: true, effectiveDate: '2024-02-01', recordDate: '2024-01-20', classRulingRef: 'CR 2024/1' }, {});
const dmCost = dm1.demergedHolding.parcels.reduce((s, p) => s + p.totalCost, 0);
const dmDec = dm1.updatedOriginal.adjustments.reduce((s, a) => s + a.amount, 0);
vec('CA-4 demerger: cost base conserved across entities (±$0.01)', 'v2 PRD conservation check', () =>
  approx(dmCost, 16000 * 0.3, 0.011) && approx(dmDec, dmCost, 0.011) && dm1.demergedHolding.parcels[0].acquisitionDate === '2015-03-01');

/* No-rollover demerger: A1 proceeds = MV of demerged shares (s.116-20), gain taxed,
   demerged shares acquired afresh at MV. MV $5/sh: p1 1000sh CB 3000→proc 5000 (gain 2000);
   p2 500sh CB 1800→proc 2500 (gain 700). Total A1 gain 2700; demerged CB 5000+2500=7500. */
const dm2 = D.applyDemerger(mkHolding(), { demergedTicker: 'NEW', demergedEntityName: 'NewCo', apportionmentPct: 0.3, demergerShareRatio: '1:1', rolloverElected: false, demergedMVPerShare: 5, effectiveDate: '2024-02-01', recordDate: '2024-01-20', classRulingRef: 'CR 2024/1' }, {});
const dm2Gain = dm2.updatedOriginal.cgtEvents.filter(e => e.eventType === 'A1').reduce((s, e) => s + e.capitalGain, 0);
const dm2DemCB = dm2.demergedHolding.parcels.reduce((s, p) => s + p.totalCost, 0);
vec('CA-4b demerger no-rollover: A1 proceeds = MV, gain taxed, new CB = MV', 'demerger MV fix', () =>
  approx(dm2Gain, 2700, 0.011) && approx(dm2DemCB, 7500, 0.011) && dm2.demergedHolding.parcels[0].acquisitionDate === '2024-02-01');

const tk1 = D.applyTakeover(mkHolding(), { acquirerTicker: 'ACQ', acquirerEntityName: 'Acquirer', exchangeRatio: 0.5, cashPerShare: 0, acquirerSharePrice: 30, effectiveDate: '2024-03-01', recordDate: '2024-02-20', parcelRolloverElections: null });
const tkCost = tk1.acquirerParcels.reduce((s, p) => s + p.totalCost, 0);
vec('CA-5 takeover rollover: cost base carried, dates inherited', 'tracker dim spec', () =>
  approx(tkCost, 16000, 0.011) && tk1.acquirerParcels[0].acquisitionDate === '2015-03-01');

/* ── 20. Crypto FIFO ───────────────────────────────────────────────────── */
const fifo = D.calcCryptoFIFO([
  { id: 't1', type: 'buy', asset: 'BTC', date: '2023-01-01', quantity: 1, price: 30000, fees: 0 },
  { id: 't2', type: 'buy', asset: 'BTC', date: '2023-06-01', quantity: 1, price: 50000, fees: 0 },
  { id: 't3', type: 'sell', asset: 'BTC', date: '2024-08-01', quantity: 1.5, price: 80000, fees: 0 }
]);
vec('FIFO-1 lots consumed in order: cost = 30k + 25k', 'crypto engine', () =>
  approx(fifo[0].costBasis, 55000) && approx(fifo[0].gain, 120000 - 55000));

/* ── 21. parcel → calcS adapter ────────────────────────────────────────── */
const adH = mkHolding();
adH.adjustments.push({ id: 'a1', parcelId: 'p1', type: 'decrease', amount: 2000, effectiveDate: '2020-01-01', origin: 'CAPITAL_RETURN', notes: '' });
const adInp = D.parcelToInput(adH.parcels[0], adH, { salePrice: 50000, saleDate: '2030-07-01', mv2027: 20000 });
const ad = D.calcS(adInp, BILL);
vec('ADP-1 adapter: pre-2027 adjustment nets into base entry', 'mapping spec', () =>
  approx(adInp.ledger[0].amount, 8000) && approx(ad.transA.preGain, 12000));

/* ── 22. Share: discount-vs-indexation crossover (Bill, post-2027 acquisition) ──
   $100k→$300k share held 12yr. The lost 50%-discount tax (oldTax column) is CPI-
   invariant at $47k; indexation + 30% min (newTax) falls as inflation lifts the
   indexed cost base. Crossover ≈ cpi 5%: discount cheaper below, indexation above. */
const shLow = D.calcS(D.makeInput({ ac: 'shares', ledger: [{ date: '2028-01-01', amount: 100000, el: '1' }], pd: '2028-01-01', sd: '2040-01-01', sp: 300000, cpi: 0.02 }), BILL);
const shHigh = D.calcS(D.makeInput({ ac: 'shares', ledger: [{ date: '2028-01-01', amount: 100000, el: '1' }], pd: '2028-01-01', sd: '2040-01-01', sp: 300000, cpi: 0.08 }), BILL);
vec('SHARE-1 low CPI: lost 50% discount beats indexation', 'Bill discount→indexation', () => approx(shLow.oldTax, 47000, 1) && shLow.newTax > shLow.oldTax);
vec('SHARE-2 high CPI: indexation beats lost 50% discount', 'Bill discount→indexation', () => approx(shHigh.oldTax, 47000, 1) && shHigh.newTax < shHigh.oldTax);

/* ── 23. Share loss ordering: capital loss forced onto the deferred (discount) gain
   before the indexed gain — the prescribed s.102-5 order removes the current-law
   choice. Transitional share: deferred gain $50k (DNR) + post-2027 indexed gain;
   $80k carry-forward loss fully drains the discountable bucket, then $30k into the
   indexed bucket, leaving the fully-taxed indexed gain exposed (unfavourable). */
const sl = D.calcS(D.makeInput({ ac: 'shares', ledger: [{ date: '2020-01-01', amount: 100000, el: '1' }], pd: '2020-01-01', sd: '2035-01-01', sp: 250000, mv27: 150000, valMethod: 'actual', cl: 80000 }), BILL);
vec('SHARE-3 loss hits deferred(discount) bucket before indexed', 'Bill prescribed loss ordering', () =>
  approx(sl.transA.trail.step2.DNR, 50000) && approx(sl.transA.trail.step2.NR, 30000) && sl.transA.trail.NRfinal > 0);

/* ── 24. ETF: on-market unit disposal == share treatment (CONFIRMED); the AMIT/AMMA
   attributed-gain path streamed through distributions is left to a later tranche per
   the EM and is marked PENDING in the asset-class honesty register. */
const etfMk = ac => D.calcS(D.makeInput({ ac, ledger: [{ date: '2020-01-01', amount: 100000, el: '1' }], pd: '2020-01-01', sd: '2035-01-01', sp: 250000, mv27: 150000, valMethod: 'actual' }), BILL);
const etfR = etfMk('etf'), shR = etfMk('shares');
vec('ETF-1 unit disposal matches share treatment', 'asset-class parity', () =>
  approx(etfR.newTax, shR.newTax) && approx(etfR.newTG, shR.newTG) && etfR.isResidentialAsset === false);
vec('ETF-2 AMIT/AMMA attribution path marked PENDING', 'honesty register', () =>
  D.ASSET_CLASS_META.etf.attribution.status === 'PENDING' && D.ASSET_CLASS_META.shares.billStatus === 'CONFIRMED' && D.ASSET_CLASS_META.etf.billStatus === 'CONFIRMED');

const RESULTS = VECTORS.map(v => { let pass = false, err = null; try { pass = !!v.fn(); } catch (e) { err = e.message; } return { name: v.name, source: v.source, pass, err }; });

if (typeof module !== 'undefined' && module.exports) module.exports = { VECTORS, RESULTS };
else { global.CBPVectors = { VECTORS, RESULTS }; }

})(typeof window !== 'undefined' ? window : globalThis);
