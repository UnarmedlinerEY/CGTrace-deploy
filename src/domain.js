/* ═════════════════════════════════════════════════════════════════════════
   CostBase Pro — shared domain layer (Phase 1 extraction)
   Sources: australia_cgt_analyser_v6.html (v6.2 expert engine, verbatim)
            cgt-parcel-tracker-v6.jsx (corporate action engine, verbatim)
   Modifications M1–M5 per ENGINE-MAPPING-SPEC.md. Pure functions, no I/O.
   Not tax advice — calculation results only.
   ═════════════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';

/* ── RULESETS — rules-as-data (M1). Effective-dated; labels per validation doc ── */
const RULESETS = {
  'current-law': {
    id: 'current-law', label: 'Current law (pre-Bill)',
    status: 'CONFIRMED', effectiveFrom: '1985-09-20', effectiveTo: null,
    transDate: null,                    // no deemed disposal event
    precgtDate: '1985-09-20',
    discountRate: 0.5, discountRateSMSF: 1 / 3, affordableDiscount: null,
    minRate: 0,                         // no minimum tax
    frozenIndexationChoice: true,       // s.110-36 choice available (1985–99 assets)
    expenseIndexation: false,
    brackets: [[18200, 0], [45000, 0.16], [135000, 0.30], [190000, 0.37], [Infinity, 0.45]],
    medicare: 0.02,
    notes: 'Discount method vs frozen indexation (1999) choice; no deemed event; no min tax.'
  },
  'bill-2026': {
    id: 'bill-2026', label: 'Tax Reform (No. 1) Bill 2026',
    status: 'PENDING', // Bill introduced 28 May 2026, not yet law; Senate report due 22 Jun 2026
    effectiveFrom: '2027-07-01', effectiveTo: null,
    transDate: '2027-07-01',            // deemed disposal 30 Jun / reacquisition 1 Jul (s.112-155(2)) CONFIRMED
    precgtDate: '1985-09-20',
    discountRate: 0.5, discountRateSMSF: 1 / 3, affordableDiscount: 0.6, // s.115-125; criteria instrument PENDING
    minRate: 0.30,                      // minimum tax gap amount — CONFIRMED
    frozenIndexationChoice: false,      // s.110-36 choice removed — CONFIRMED
    expenseIndexation: true,            // per-expense quarterly factors, elements 1/2/4/5 — CONFIRMED
    brackets: [[18200, 0], [45000, 0.16], [135000, 0.30], [190000, 0.37], [Infinity, 0.45]], // 2024–25 proxy — ASSUMED
    medicare: 0.02,                     // flat proxy — ASSUMED
    notes: 'Seven-step s.102-5; quarantine steps 3–4; deferred gains excluded from min tax.'
  }
};

/* ── ASSET CLASS METADATA (Phase 7) — honesty register for asset-class coverage.
   Drives the calc engine's documentation of what is CONFIRMED vs PENDING per class. ── */
const ASSET_CLASS_META = {
  shares: {
    label: 'Shares', residential: false, billStatus: 'CONFIRMED',
    note: 'Listed/unlisted shares held by individuals/trusts: 50% discount → cost base indexation from 1 Jul 2027; transitional split (deferred 50%-disc component + post-2027 indexed component); prescribed loss ordering; 30% minimum tax on the post-2027 gain.'
  },
  etf: {
    label: 'ETF units', residential: false, billStatus: 'CONFIRMED',
    note: 'On-market disposal of ETF units is computed identically to shares (non-residential CGT asset; same indexation / discount / min-tax mechanics).',
    attribution: {
      status: 'PENDING',
      note: 'AMIT/AMMA attributed capital gains streamed to unit-holders (the four new gain categories + prescribed loss ordering flowing through trust distributions) — the interaction with the Div 276 AMIT rules is expressly left to a later legislative tranche per the EM. Distribution-side attribution is NOT modelled by calcS; only unit disposal is.'
    }
  }
};

/* ── helpers (verbatim from calculator v6) ── */
function days(d1, d2) { return (new Date(d2) - new Date(d1)) / 86400000; }
function idxCB(cb, fromDate, toDate, cpi) {
  const yrs = Math.max(0, (new Date(toDate) - new Date(fromDate)) / (365.25 * 86400000));
  return cb * Math.pow(1 + cpi, yrs);
}
function fmt(n) { return '$' + Math.round(n).toLocaleString('en-AU'); }
function pct(n) { return (n * 100).toFixed(1) + '%'; }

/* ── input factory (M2) — defaults matching calculator UI defaults ── */
function makeInput(o) {
  const base = {
    ac: 'shares', inv: 'individual',
    ledger: [], cb: 0,
    oDNR: 0, oDR: 0, oNR: 0, oR: 0, clCur: 0,
    pd: '2020-07-01', sp: 0, sd: '2030-07-01',
    mtr: 0.47, cpi: 0.028, cl: 0, pv: 0,
    nbc: 'auto', incsup: false, valMethod: 'actual', mv27: 0, nbt: 'standard',
    foreignRes: false, ft: 'linear', mtm: 'simple',
    otherInc: 0, otherDed: 0, qr: 0, pcUnder: 'nonres',
    k6: 'no', k6Gain: 0,
    mrSc: 'none', mrConvDate: '', mrConvVal: 0, mrAreaPct: 0, mrTimePct: 0,
    mr6Date: '', mr6SaleDate: ''
  };
  const inp = Object.assign(base, o || {});
  if (!o || o.cb === undefined) inp.cb = inp.ledger.reduce((a, r) => a + (parseFloat(r.amount) || 0), 0);
  return inp;
}

/* ── Main residence logic (M3: DOM writes → uiNotes) ── */
function calcMR(inp) {
  const sc = inp.mrSc;
  if (sc === 'full') return { exempt: true, taxableGain: 0, note: 'Full main residence exemption', uiNotes: [] };
  if (sc === 'sixyr') {
    const vacD = new Date(inp.mr6Date);
    const saleD = new Date(inp.mr6SaleDate);
    const yrs = (saleD - vacD) / (365.25 * 86400000);
    if (yrs <= 6) {
      return { exempt: true, taxableGain: 0, note: '6-year rule — full exemption',
        uiNotes: ['✓ Sold ' + yrs.toFixed(1) + 'yr after vacating — within 6-year window. Full exemption applies. Zero CGT.'] };
    } else {
      const ef = Math.min(6 / yrs, 1);
      const rg = Math.max(0, inp.sp - inp.cb);
      return { exempt: false, taxableGain: rg * (1 - ef), partialPct: (1 - ef), note: 'Partial 6-yr (' + yrs.toFixed(1) + 'yr absent)',
        uiNotes: ['⚠ ' + yrs.toFixed(1) + 'yr since vacating — exceeds 6-year limit. Partial exemption: ' + pct(1 - ef) + ' of gain taxable.'] };
    }
  }
  if (sc === 'partial_switch') {
    const totalD2 = days(inp.pd, inp.sd);
    const convD2 = days(inp.pd, inp.mrConvDate);
    const postPct2 = Math.max(0, Math.min(1, 1 - (convD2 / totalD2)));
    const rg = Math.max(0, inp.sp - inp.mrConvVal);
    return { exempt: false, taxableGain: rg * postPct2, partialPct: postPct2, adjustedCB: inp.mrConvVal, note: 'PPOR→investment at ' + inp.mrConvDate,
      uiNotes: ['ℹ Cost base reset to $' + Math.round(inp.mrConvVal).toLocaleString() + ' at conversion. Taxable portion: ' + Math.round(postPct2 * 100) + '% of post-conversion gain = ' + fmt(rg * postPct2) + '.'] };
  }
  if (sc === 'partial_income') {
    const fp = inp.mrAreaPct / 100; const tp = inp.mrTimePct / 100;
    const rg = Math.max(0, inp.sp - inp.cb);
    const tg = rg * fp * tp;
    return { exempt: false, taxableGain: tg, partialPct: fp * tp, note: 'Partial income use (' + pct(fp * tp) + ' taxable)', uiNotes: [] };
  }
  return { exempt: false, taxableGain: null, partialPct: 1, uiNotes: [] };
}

/* ── Core scenario calculation — v6 EXPERT engine (verbatim; M1 rules param) ──
   Grounding comments preserved from source: deemed disposal s.112-155(2);
   proceeds ss.112-175(3)/112-185; acquisition date preserved ss.112-160/112-170;
   per-expense quarterly indexation elements 1/2/4/5, Element 3 excluded;
   seven-step s.102-5 (DNR→DR→NR→R; quarantine steps 3–4); minimum tax gap amount
   on post-step-6 res+non-res only (deferred excluded); pre-CGT incl. companies,
   K6 deferred; 1985–99 s.110-36 choice removed. */
function calcS(inp, rules, ovCpi, ovMtr, ovSp) {
  rules = rules || RULESETS['bill-2026'];
  const TRANS = new Date(rules.transDate || '2027-07-01');
  const PRECGT_DATE = new Date(rules.precgtDate);
  const cpiR = ovCpi !== undefined ? ovCpi : inp.cpi;
  const mtr = ovMtr !== undefined ? ovMtr : inp.mtr;
  const sp = ovSp !== undefined ? ovSp : inp.sp;
  const noMin = inp.incsup || inp.inv === 'company';
  const minR = noMin ? 0 : rules.minRate;
  const baseDiscount = inp.inv === 'smsf' ? rules.discountRateSMSF : rules.discountRate; // M-SMSF (ASSUMED unaffected by Bill)
  const purchD = new Date(inp.pd);
  const saleD = new Date(inp.sd);
  const heldDays = days(inp.pd, inp.sd);
  const held12m = heldDays >= 365;
  const isPrecgt = purchD < PRECGT_DATE;
  const isNewBuild = inp.ac === 'property_new';
  const saleAfterTrans = saleD > TRANS;
  const isMR = inp.ac === 'main_res';
  const foreignDisqualified = inp.foreignRes && saleAfterTrans && !isMR;
  const is8599 = purchD >= PRECGT_DATE && purchD <= new Date('1999-09-21');

  function qNum(d) { const t = new Date(d); return t.getFullYear() * 4 + Math.floor(t.getMonth() / 3); }
  function qFactor(fromDate, toDate, cpi) {
    const dq = Math.max(0, qNum(toDate) - qNum(fromDate));
    return Math.pow(1 + cpi, dq / 4);
  }

  function bTax(ti) {
    ti = Math.max(0, ti); let t = 0, prev = 0;
    const br = rules.brackets;
    for (const [cap, rate] of br) { const amt = Math.min(ti, cap) - prev; if (amt > 0) t += amt * rate; prev = cap; if (ti <= cap) break; }
    return t + ti * rules.medicare;
  }
  const useFull = inp.mtm === 'full' && (inp.inv === 'individual' || inp.inv === 'trust');
  const tiBase = Math.max(0, (inp.otherInc || 0) - (inp.otherDed || 0));
  function comboTax(d, m) {
    d = Math.max(0, d); m = Math.max(0, m);
    if (!useFull) return d * mtr + Math.max(m * mtr, m * minR);
    const tiWith = tiBase + d + m;
    const taxWith = bTax(tiWith);
    const taxOnM = taxWith - bTax(tiWith - m);
    const additional = noMin ? 0 : Math.max(0, rules.minRate * m - taxOnM); // "minimum tax gap amount"
    return (taxWith - bTax(tiBase)) + additional;
  }

  const L = (inp.ledger || []).filter(e => e.amount > 0);
  const preCB = L.filter(e => new Date(e.date) < TRANS).reduce((a, e) => a + e.amount, 0);
  const cbAll = L.reduce((a, e) => a + e.amount, 0);
  function idxPostCB(base2027) {
    let icb = 0;
    const idxOK = held12m && !foreignDisqualified;
    if (base2027 != null) icb += idxOK ? base2027 * qFactor(rules.transDate || '2027-07-01', inp.sd, cpiR) : base2027;
    for (const e of L) {
      if (new Date(e.date) >= TRANS) {
        if (e.el === '3' || !idxOK) icb += e.amount;
        else icb += e.amount * qFactor(e.date, inp.sd, cpiR);
      }
    }
    return icb;
  }

  let effCB = inp.cb, mrResult = null, effPreCB = preCB, mrLedgerOverride = null;

  if (isMR) {
    mrResult = calcMR(inp);
    if (mrResult.exempt) return { oldTax: 0, newTax: 0, transTax: null, oldAT: sp, newAT: sp, transAT: null, rawGain: Math.max(0, sp - inp.cb), gainAL: 0, held12m, isPrecgt, isNewBuild, saleAfterTrans, isTransitional: false, oldEff: 0, newEff: 0, transEff: null, oldTG: 0, newTG: 0, newICB: inp.cb, oldDisc: 'Main residence exempt', newDisc: 'Main residence exempt', isMRExempt: true, mrNote: mrResult.note, mrUiNotes: mrResult.uiNotes, is8599: false, foreignDisqualified: false, lossPool: 0, qrUse: 0, useFull, isResidentialAsset: true, transF: null, transA: null, defLoss: 0, ms: null, msPort: null, formulaVal: 0, actualVal: 0, useVal: 0 };
    if (mrResult.adjustedCB) { effCB = mrResult.adjustedCB; effPreCB = mrResult.adjustedCB; mrLedgerOverride = true; }
  }

  const rawGain = Math.max(0, sp - inp.cb);
  const effGain = isMR && mrResult ? (mrResult.taxableGain || Math.max(0, sp - effCB)) : rawGain;
  const isResidentialAsset = ['property_est', 'property_new', 'main_res'].includes(inp.ac) || (inp.ac === 'precgt' && inp.pcUnder === 'res');
  const qrUse = isResidentialAsset ? (inp.qr || 0) : 0;
  const lossPool = inp.cl + inp.clCur + qrUse;
  const gainAL = Math.max(0, effGain - Math.min(effGain, inp.cl + inp.clCur));

  const baseForVal = mrLedgerOverride ? effCB : effPreCB;
  const totalD = days(inp.pd, inp.sd);
  const preD = Math.max(0, days(inp.pd, rules.transDate || '2027-07-01'));
  const prePct = totalD > 0 ? Math.min(1, preD / totalD) : 0;
  let formulaVal;
  if (inp.ft === 'compound' && baseForVal > 0 && sp > 0 && totalD > 0) {
    const totYrs = totalD / 365.25, preYrs = preD / 365.25;
    const cagr = Math.pow(sp / baseForVal, 1 / Math.max(totYrs, 0.0001)) - 1;
    formulaVal = baseForVal * Math.pow(1 + cagr, Math.min(preYrs, totYrs));
  } else {
    formulaVal = baseForVal + (sp - baseForVal) * prePct;
  }
  const actualVal = inp.mv27 > 0 ? inp.mv27 : formulaVal;
  const useVal = inp.valMethod === 'actual' ? actualVal : formulaVal;

  /* OLD LAW (current-law comparison column) */
  let oldTG, oldTax, oldDisc;
  if (isMR && mrResult && !mrResult.exempt) {
    oldTG = held12m && inp.inv !== 'company' ? gainAL * (1 - baseDiscount) : gainAL;
    oldTax = inp.inv === 'company' ? oldTG * mtr : comboTax(oldTG, 0); oldDisc = '50% disc on taxable portion';
  } else if (isPrecgt && !saleAfterTrans) {
    oldTG = 0; oldTax = 0; oldDisc = '100% exempt (pre-CGT, sold before 1 Jul 2027)';
  } else if (held12m && inp.inv !== 'company') {
    oldTG = gainAL * (1 - baseDiscount); oldTax = comboTax(oldTG, 0); oldDisc = (baseDiscount === 0.5 ? '50%' : '⅓') + ' CGT discount';
  } else {
    oldTG = gainAL; oldTax = inp.inv === 'company' ? gainAL * mtr : comboTax(gainAL, 0); oldDisc = 'No discount (<12m or company)';
  }
  const oldAT = sp - oldTax;
  const oldEff = rawGain > 0 ? oldTax / rawGain : 0;

  /* METHOD STATEMENT ENGINE (steps 1–7, new s.102-5) */
  function methodStatement(assetDef, assetPost, assetDefLoss, withOthers, discRateOverride) {
    const o = withOthers ? inp : { oDNR: 0, oDR: 0, oNR: 0, oR: 0 };
    const cat = {
      DNR: (o.oDNR || 0) + (isResidentialAsset ? 0 : assetDef),
      DR: (o.oDR || 0) + (isResidentialAsset ? assetDef : 0),
      NR: (o.oNR || 0) + (isResidentialAsset ? 0 : assetPost),
      R: (o.oR || 0) + (isResidentialAsset ? assetPost : 0)
    };
    const order = ['DNR', 'DR', 'NR', 'R'];
    const trail = { cat0: Object.assign({}, cat), step1: {}, step2: {}, step3: 0, step4: 0 };
    function drain(pool, store) {
      for (const k of order) { const t = Math.min(pool, cat[k]); cat[k] -= t; pool -= t; store[k] = t; if (pool <= 0) break; }
      return pool;
    }
    let cur = inp.clCur + assetDefLoss;
    trail.curTotal = cur; cur = drain(cur, trail.step1); trail.curUnused = cur;
    let cf = inp.cl; trail.cfTotal = cf; cf = drain(cf, trail.step2); trail.cfUnused = cf;
    let q = qrUse; const q3 = Math.min(q, cat.DR); cat.DR -= q3; q -= q3; trail.step3 = q3;
    const q4 = Math.min(q, cat.R); cat.R -= q4; q -= q4; trail.step4 = q4; trail.qrUnused = q;
    const dr = held12m ? (discRateOverride !== undefined ? discRateOverride : (1 - baseDiscount)) : 1;
    trail.DNRdisc = cat.DNR * dr; trail.DRdisc = cat.DR * dr;
    /* Step 6 — small business CGT concessions: retained by Bill, NOT modelled */
    trail.NRfinal = cat.NR; trail.Rfinal = cat.R;
    trail.net = trail.DNRdisc + trail.DRdisc + cat.NR + cat.R;
    trail.minTaxGain = cat.NR + cat.R;
    trail.discounted = trail.DNRdisc + trail.DRdisc;
    trail.tax = comboTax(trail.discounted, trail.minTaxGain);
    return trail;
  }

  /* NEW LAW pathway */
  let newTax, newTG, newDisc, newICB, defLoss = 0;
  let transFDetail = null, transADetail = null;
  let msAsset = null, msPort = null;

  function calcOneTrans(val2027, label) {
    const defRaw = val2027 - effPreCB;
    const dG = Math.max(0, defRaw), dL = Math.max(0, -defRaw);
    const idxFrom2027 = idxPostCB(val2027);
    const postReal = Math.max(0, sp - idxFrom2027);
    const t = methodStatement(dG, postReal, dL, false);
    const preTax2 = comboTax(t.discounted, 0);
    const ttax = t.tax;
    const postTax2 = ttax - preTax2;
    return { ttax, tat: sp - ttax, teff: rawGain > 0 ? ttax / rawGain : 0,
      tlabel: label + ' | Deferred: 50% disc→' + fmt(preTax2) + ' | Post: idx+30% min→' + fmt(postTax2),
      preGain: dG, defLoss: dL, preGainDisc: t.discounted,
      lossToPre: (t.step1.DNR || 0) + (t.step1.DR || 0) + (t.step2.DNR || 0) + (t.step2.DR || 0) + t.step3,
      lossRemainder: (t.step1.NR || 0) + (t.step1.R || 0) + (t.step2.NR || 0) + (t.step2.R || 0) + t.step4,
      preTax: preTax2, idxCB2027: idxFrom2027, postReal, postTax: postTax2, val2027, trail: t };
  }

  if (foreignDisqualified) {
    newTG = gainAL;
    newTax = comboTax(newTG, 0);
    newDisc = 'Foreign resident ≥1 day of holding — no indexation, no discount (Bill; part-year amendments ⚠ PENDING per EM)';
    newICB = effCB;
  } else if (isMR && mrResult && !mrResult.exempt) {
    const icbMR = saleAfterTrans ? idxPostCB(new Date(inp.mrConvDate || inp.pd) < TRANS ? useVal : null) : effCB;
    const igain = Math.max(0, (sp - icbMR) * ((mrResult.partialPct) || 1));
    newICB = icbMR; newTG = saleAfterTrans ? igain : gainAL * (1 - baseDiscount);
    newTax = saleAfterTrans ? comboTax(0, Math.max(0, igain - inp.cl - inp.clCur)) : comboTax(gainAL * (1 - baseDiscount), 0);
    newDisc = saleAfterTrans ? 'Indexation on taxable portion + 30% min' : '50% disc (sale pre-2027)';
  } else if (isPrecgt && !saleAfterTrans) {
    newTG = 0; newTax = 0; newDisc = 'Exempt (sale before 1 Jul 2027)'; newICB = effCB;
  } else if (isPrecgt && saleAfterTrans) {
    if (inp.pv <= 0) {
      newTG = 0; newTax = 0; newICB = 0;
      newDisc = '⚠ Enter market value at 1 Jul 2027 — required for pre-CGT assets (apportioning method exists in the Bill, instrument not yet made)';
    } else if (inp.inv === 'company') {
      newICB = inp.pv + L.filter(e => new Date(e.date) >= TRANS).reduce((a, e) => a + e.amount, 0);
      newTG = Math.max(0, sp - newICB - inp.cl - inp.clCur);
      newTax = newTG * 0.30;
      newDisc = 'Company pre-CGT (Bill): MV(1 Jul 2027) deemed cost base + post-2027 costs; no indexation; 30% company rate';
    } else {
      newICB = idxPostCB(inp.pv);
      const pg = Math.max(0, sp - newICB);
      msAsset = methodStatement(0, pg, 0, false);
      newTG = msAsset.minTaxGain;
      newTax = msAsset.tax;
      newDisc = 'Pre-CGT: deemed reacquisition at MV(1 Jul 2027); expense-by-expense indexation from 1 Jul 2027; 30% min';
    }
    if (inp.k6 === 'yes' && inp.k6Gain > 0) {
      const k6Tax = inp.inv === 'company' ? inp.k6Gain * 0.30 : comboTax(inp.k6Gain * (held12m ? (1 - baseDiscount) : 1), 0);
      newTax += k6Tax;
      newDisc += ' · + deferred K6 gain ' + fmt(inp.k6Gain) + ' crystallised 1 Jul 2027 (s.104-230; ⚠ discount treatment assumed)';
    }
  } else if (isNewBuild) {
    const discRate = inp.nbt === 'affordable' ? rules.affordableDiscount : rules.discountRate;
    const discGain = Math.max(0, gainAL) * (1 - discRate);
    const discTax = comboTax(discGain, 0);
    let idxRes = null;
    if (saleAfterTrans && purchD < TRANS) {
      idxRes = calcOneTrans(useVal, 'NB idx');
    }
    const idxTax = idxRes ? idxRes.ttax : (saleAfterTrans ? methodStatement(0, Math.max(0, sp - idxPostCB(null)), 0, false).tax : comboTax(gainAL, 0));
    const discLbl = 'New build: ' + (discRate * 100) + '% disc' + (inp.nbt === 'affordable' ? ' (affordable — s.115-125, criteria instrument ⚠ pending)' : '') + ' — deemed sale & 30% min do not apply';
    if (inp.nbc === 'discount') { newTG = discGain; newTax = discTax; newDisc = discLbl + ' (chosen)'; newICB = effCB; }
    else if (inp.nbc === 'indexation') { newTG = idxRes ? idxRes.postReal : Math.max(0, sp - idxPostCB(null)); newTax = idxTax; newICB = idxRes ? idxRes.idxCB2027 : idxPostCB(null); newDisc = 'New build: indexation (chosen)'; }
    else if (discTax <= idxTax) { newTG = discGain; newTax = discTax; newDisc = discLbl + ' (auto — better)'; newICB = effCB; }
    else { newTG = idxRes ? idxRes.postReal : Math.max(0, sp - idxPostCB(null)); newTax = idxTax; newICB = idxRes ? idxRes.idxCB2027 : idxPostCB(null); newDisc = 'New build: indexation (auto — better)'; }
  } else if (!held12m || inp.inv === 'company') {
    newTG = gainAL; newTax = inp.inv === 'company' ? gainAL * mtr : comboTax(gainAL, 0); newDisc = 'No discount/indexation (<12m or company)'; newICB = effCB;
  } else if (!saleAfterTrans) {
    newTG = gainAL * (1 - baseDiscount); newTax = comboTax(newTG, 0); newDisc = '50% disc (sale before 1 Jul 2027)'; newICB = effCB;
  } else if (purchD >= TRANS) {
    newICB = idxPostCB(null);
    const pg = Math.max(0, sp - newICB);
    msAsset = methodStatement(0, pg, 0, false);
    newTG = msAsset.minTaxGain;
    newTax = msAsset.tax;
    newDisc = 'Expense-by-expense CPI indexation (quarterly) + 30% min tax';
  } else {
    const t = calcOneTrans(useVal, 'New law');
    newICB = t.idxCB2027; newTG = t.postReal; newTax = t.ttax;
    newDisc = 'Deemed sale at 1 Jul 2027 + quarterly indexation + 30% min';
  }
  const newAT = sp - newTax;
  const newEff = rawGain > 0 ? newTax / rawGain : 0;

  /* DEFERRED (transitional) columns */
  let transTax = null, transAT = null, transEff = null, transLabel = null;
  let transActTax = null, transActAT = null, transActEff = null, transActLabel = null;
  const isTransitional = saleAfterTrans && purchD < TRANS && !isPrecgt && !isNewBuild && held12m && inp.inv !== 'company' && !isMR && !foreignDisqualified;

  if (isTransitional) {
    const fRes = calcOneTrans(formulaVal, 'Formula val=' + fmt(formulaVal));
    const aRes = calcOneTrans(actualVal, 'MV val=' + fmt(actualVal));
    transTax = fRes.ttax; transAT = fRes.tat; transEff = fRes.teff; transLabel = fRes.tlabel;
    transActTax = aRes.ttax; transActAT = aRes.tat; transActEff = aRes.teff; transActLabel = aRes.tlabel;
    Object.assign(fRes, { isFormula: true }); Object.assign(aRes, { isActual: true });
    transFDetail = fRes; transADetail = aRes;
    defLoss = (inp.valMethod === 'actual' ? aRes.defLoss : fRes.defLoss) || 0;
    msAsset = (inp.valMethod === 'actual' ? aRes.trail : fRes.trail);
  }

  /* PORTFOLIO view (steps 1–7 with "other gains") */
  if (saleAfterTrans && !isMR) {
    if (isTransitional) {
      const D = (inp.valMethod === 'actual' && transADetail) ? transADetail : transFDetail;
      msPort = methodStatement(D.preGain, D.postReal, D.defLoss, true);
    } else if (isPrecgt && inp.pv > 0 && inp.inv !== 'company') {
      msPort = methodStatement(0, Math.max(0, sp - newICB), 0, true);
    } else if (purchD >= TRANS && !isNewBuild && held12m && inp.inv !== 'company' && !foreignDisqualified) {
      msPort = methodStatement(0, Math.max(0, sp - newICB), 0, true);
    }
  }

  return { rawGain, gainAL, held12m, isPrecgt, isNewBuild, saleAfterTrans, isTransitional,
    oldTax, oldTG, oldAT, oldEff, oldDisc,
    newTax, newTG, newAT, newEff, newDisc, newICB: newICB || effCB,
    transTax, transAT, transEff, transLabel,
    transActTax, transActAT, transActEff, transActLabel,
    transF: transFDetail, transA: transADetail,
    is8599, foreignDisqualified, isResidentialAsset, lossPool, qrUse, useFull, defLoss,
    ms: msAsset, msPort, preCB: effPreCB, cbAll,
    isMRExempt: false,
    formulaVal, actualVal, useVal,
    rulesetId: rules.id };
}

/* ═════════════════════════════════════════════════════════════════════════
   CORPORATE ACTION ENGINE — verbatim from cgt-parcel-tracker-v6.jsx
   M4: discountEligible/holdingDays take explicit asOf date (CGT event date).
   ═════════════════════════════════════════════════════════════════════════ */
const holdingDaysAt = (d, asOf) => Math.floor(((asOf ? new Date(asOf) : new Date()) - new Date(d)) / 86400000);
const discountEligibleAt = (d, asOf) => holdingDaysAt(d, asOf) >= 365;
const uid = () => 'id_' + Math.random().toString(36).slice(2, 10);
const fmtN = (n, dp = 2) => n == null ? '—' : n.toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp });

function getEffectiveCostBase(parcel, adjustments) {
  const adjs = adjustments.filter(a => a.parcelId === parcel.id);
  const adjTotal = adjs.reduce((s, a) => s + (a.type === 'increase' ? a.amount : -Math.abs(a.amount)), 0);
  return parcel.totalCost + adjTotal;
}
function getParcelAdjustments(parcelId, adjustments) {
  return adjustments.filter(a => a.parcelId === parcelId);
}

function applyShareSplit(holding, params) {
  const { splitRatio, recordDate } = params;
  const actionId = uid();
  const impacted = [];
  const updatedParcels = holding.parcels.map(p => {
    if (p.status !== 'active') return p;
    impacted.push(p.id);
    return Object.assign({}, p, {
      qty: p.qty * splitRatio,
      costPerUnit: parseFloat((p.costPerUnit / splitRatio).toFixed(6)),
      totalCost: p.totalCost, // preserved exactly
      sourceActionId: actionId,
      notes: p.notes + ' [Split ' + splitRatio + ':1 applied ' + recordDate + ']'
    });
  });
  const action = { id: actionId, actionType: 'SPLIT', announcementDate: recordDate, recordDate, effectiveDate: recordDate,
    parameters: params, parcelsImpacted: impacted, parcelsCreated: [], parcelsCancelled: [], adjustmentsCreated: [], cgtEvents: [], notes: splitRatio + ':1 split applied to all active parcels', status: 'applied' };
  return Object.assign({}, holding, { parcels: updatedParcels, actions: holding.actions.concat([action]) });
}

function applyConsolidation(holding, params) {
  const { consolidationRatio, recordDate, effectiveDate, classRulingRef, rolloverAvailable } = params;
  const actionId = uid();
  const activeParcels = holding.parcels.filter(p => p.status === 'active');
  const pooledCost = activeParcels.reduce((s, p) => s + getEffectiveCostBase(p, holding.adjustments), 0);
  const pooledQty = activeParcels.reduce((s, p) => s + p.qty, 0);
  const newQty = Math.floor(pooledQty / consolidationRatio);
  const newParcelId = uid();
  const earliestDate = activeParcels.reduce((e, p) => p.acquisitionDate < e ? p.acquisitionDate : e, activeParcels[0].acquisitionDate);
  const newParcel = {
    id: newParcelId, origin: 'CONSOLIDATION',
    acquisitionDate: rolloverAvailable ? earliestDate : effectiveDate,
    qty: newQty, costPerUnit: parseFloat((pooledCost / newQty).toFixed(6)),
    totalCost: parseFloat(pooledCost.toFixed(2)),
    status: 'active', sourceActionId: actionId, sourceRightsId: null,
    replacesParcelId: activeParcels.map(p => p.id).join(','),
    notes: 'Replacement parcel — consolidation ' + consolidationRatio + ':1. Pooled cost base from ' + activeParcels.length + ' parcels.' + (rolloverAvailable ? ' Acq. date inherited (rollover).' : '')
  };
  const cancelledIds = activeParcels.map(p => p.id);
  const cancelledParcels = holding.parcels.map(p => cancelledIds.includes(p.id) ? Object.assign({}, p, { status: 'cancelled', sourceActionId: actionId }) : p);
  const cgtEvents = [];
  if (!rolloverAvailable) {
    activeParcels.forEach(p => {
      cgtEvents.push({ id: uid(), holdingId: holding.id, rightsRecordId: null, actionId,
        eventType: 'C2', eventDate: effectiveDate,
        costBase: getEffectiveCostBase(p, holding.adjustments), proceeds: 0,
        capitalGain: 0, capitalLoss: getEffectiveCostBase(p, holding.adjustments),
        discountEligible: discountEligibleAt(p.acquisitionDate, effectiveDate), discountMethod: null, discountedGain: 0,
        rolloverApplied: false, rolloverType: null, notes: 'C2 — cancellation of parcel ' + p.id });
    });
  }
  const action = { id: actionId, actionType: 'CONSOLIDATION', announcementDate: recordDate, recordDate, effectiveDate,
    parameters: params, parcelsImpacted: cancelledIds, parcelsCreated: [newParcelId], parcelsCancelled: cancelledIds,
    adjustmentsCreated: [], cgtEvents: cgtEvents.map(e => e.id), classRulingRef: classRulingRef || '', notes: consolidationRatio + ':1 consolidation', status: 'applied' };
  return Object.assign({}, holding, { parcels: cancelledParcels.concat([newParcel]), actions: holding.actions.concat([action]), cgtEvents: holding.cgtEvents.concat(cgtEvents) });
}

function applyCapitalReturn(holding, params) {
  const { returnPerShare, recordDate, paymentDate } = params;
  const actionId = uid();
  const activeParcels = holding.parcels.filter(p => p.status === 'active' && p.acquisitionDate <= recordDate);
  const newAdjs = [];
  const newCgtEvents = [];
  activeParcels.forEach(p => {
    const adjAmount = returnPerShare * p.qty;
    const currentEffCB = getEffectiveCostBase(p, holding.adjustments);
    const adjId = uid();
    newAdjs.push({ id: adjId, parcelId: p.id, sourceActionId: actionId,
      type: 'decrease', amount: adjAmount, amountPerUnit: returnPerShare,
      effectiveDate: paymentDate, origin: 'CAPITAL_RETURN',
      notes: 'Capital return $' + returnPerShare + '/unit × ' + p.qty + ' units' });
    const newEffCB = currentEffCB - adjAmount;
    if (newEffCB < 0) {
      const g1Id = uid();
      const resetAdjId = uid();
      newCgtEvents.push({ id: g1Id, holdingId: holding.id, rightsRecordId: null, actionId,
        eventType: 'G1', eventDate: paymentDate,
        costBase: 0, proceeds: Math.abs(newEffCB), capitalGain: Math.abs(newEffCB), capitalLoss: 0,
        discountEligible: false, discountMethod: null, discountedGain: Math.abs(newEffCB),
        rolloverApplied: false, rolloverType: null,
        notes: 'G1 — cost base of parcel ' + p.id + ' went below $0 by $' + fmtN(Math.abs(newEffCB)) });
      newAdjs.push({ id: resetAdjId, parcelId: p.id, sourceActionId: actionId,
        type: 'increase', amount: Math.abs(newEffCB), amountPerUnit: Math.abs(newEffCB) / p.qty,
        effectiveDate: paymentDate, origin: 'CAPITAL_RETURN',
        notes: 'G1 reset — cost base restored to $0 after event' });
    }
  });
  const action = { id: actionId, actionType: 'CAPITAL_RETURN', announcementDate: recordDate, recordDate, effectiveDate: paymentDate,
    parameters: params, parcelsImpacted: activeParcels.map(p => p.id), parcelsCreated: [], parcelsCancelled: [],
    adjustmentsCreated: newAdjs.map(a => a.id), cgtEvents: newCgtEvents.map(e => e.id), classRulingRef: '',
    notes: 'Capital return $' + returnPerShare + '/share — applied to ' + activeParcels.length + ' parcels at record date', status: 'applied' };
  return Object.assign({}, holding, { adjustments: holding.adjustments.concat(newAdjs), actions: holding.actions.concat([action]), cgtEvents: holding.cgtEvents.concat(newCgtEvents) });
}

function applyDemerger(holding, params, allHoldings) {
  const { demergedTicker, demergedEntityName, apportionmentPct, demergerShareRatio, rolloverElected, effectiveDate, recordDate, classRulingRef } = params;
  const actionId = uid();
  const activeParcels = holding.parcels.filter(p => p.status === 'active' && p.acquisitionDate <= recordDate);
  const newAdjs = [];
  const newCgtEvents = [];
  const demergedParcels = [];

  activeParcels.forEach(p => {
    const effCB = getEffectiveCostBase(p, holding.adjustments);
    const demergedCost = parseFloat((effCB * apportionmentPct).toFixed(2));
    const adjId = uid();
    newAdjs.push({ id: adjId, parcelId: p.id, sourceActionId: actionId,
      type: 'decrease', amount: demergedCost, amountPerUnit: parseFloat((demergedCost / p.qty).toFixed(6)),
      effectiveDate, origin: 'DEMERGER',
      notes: 'Demerger — ' + (apportionmentPct * 100).toFixed(0) + '% of cost base transferred to ' + demergedTicker });
    const ratio = demergerShareRatio ? parseFloat(demergerShareRatio.split(':')[0]) : 1;
    const newQty = Math.round(p.qty * ratio);
    /* No-rollover demerger is a CGT event A1 on the original shares: proceeds =
       market value of the demerged shares received (s.116-20 MV substitution),
       and those new shares are acquired afresh at that same market value.
       demergedMVPerShare comes from the ATO class ruling. With rollover (Div 125)
       cost base is carried over and conserved (no CGT event). */
    const mvPerShare = parseFloat(params.demergedMVPerShare) || 0;
    const noRolloverMV = !rolloverElected && mvPerShare > 0;
    const demergedParcelCB = noRolloverMV ? parseFloat((mvPerShare * newQty).toFixed(2)) : demergedCost;
    const newParcelId = uid();
    demergedParcels.push({
      id: newParcelId, origin: 'DEMERGER',
      acquisitionDate: rolloverElected ? p.acquisitionDate : effectiveDate,
      qty: newQty, costPerUnit: parseFloat((demergedParcelCB / newQty).toFixed(6)),
      totalCost: demergedParcelCB, status: 'active',
      sourceActionId: actionId, sourceRightsId: null, replacesParcelId: p.id,
      notes: 'Demerged from ' + holding.ticker + ' parcel ' + p.id + '. ' + (rolloverElected ? 'Acq. date inherited (Div 125 rollover).' : 'New acq. date (no rollover).' + (noRolloverMV ? ' Cost base = MV at demerger.' : '')) + ' Ref: ' + (classRulingRef || 'no ruling')
    });
    if (!rolloverElected) {
      /* Proceeds = MV of demerged shares (correct treatment). Falls back to the
         apportioned cost base (zero gain) only when no MV is supplied. */
      const proceeds = mvPerShare > 0 ? parseFloat((mvPerShare * newQty).toFixed(2)) : demergedCost;
      const rawGain = parseFloat((proceeds - demergedCost).toFixed(2));
      newCgtEvents.push({ id: uid(), holdingId: holding.id, rightsRecordId: null, actionId,
        eventType: 'A1', eventDate: effectiveDate,
        costBase: demergedCost, proceeds,
        capitalGain: rawGain > 0 ? rawGain : 0,
        capitalLoss: rawGain < 0 ? -rawGain : 0,
        discountEligible: discountEligibleAt(p.acquisitionDate, effectiveDate), discountMethod: null, discountedGain: 0,
        mvSubstituted: mvPerShare > 0,
        rolloverApplied: false, rolloverType: null,
        notes: 'A1 — demerger disposal without rollover, parcel ' + p.id +
          (mvPerShare > 0 ? ' · proceeds = MV $' + mvPerShare + '/sh × ' + newQty + ' = $' + proceeds : ' · MV not supplied — proceeds defaulted to cost base (zero gain)') });
    }
  });

  const existingDemerged = allHoldings[demergedTicker];
  const demergedHolding = existingDemerged
    ? Object.assign({}, existingDemerged, { parcels: existingDemerged.parcels.concat(demergedParcels) })
    : { id: uid(), ticker: demergedTicker, name: demergedEntityName, type: 'Share',
        parcels: demergedParcels, adjustments: [], actions: [], cgtEvents: [] };

  const action = { id: actionId, actionType: 'DEMERGER', announcementDate: recordDate, recordDate, effectiveDate,
    parameters: params, parcelsImpacted: activeParcels.map(p => p.id),
    parcelsCreated: demergedParcels.map(p => p.id), parcelsCancelled: [],
    adjustmentsCreated: newAdjs.map(a => a.id), cgtEvents: newCgtEvents.map(e => e.id),
    classRulingRef: classRulingRef || '',
    notes: 'Demerger — ' + demergedTicker + '. ' + (apportionmentPct * 100).toFixed(0) + '% apportioned. Rollover: ' + (rolloverElected ? 'yes' : 'no'), status: 'applied' };

  const updatedOriginal = Object.assign({}, holding, { adjustments: holding.adjustments.concat(newAdjs), actions: holding.actions.concat([action]), cgtEvents: holding.cgtEvents.concat(newCgtEvents) });
  return { updatedOriginal, demergedHolding };
}

function applyTakeover(holding, params) {
  const { acquirerTicker, acquirerEntityName, exchangeRatio, cashPerShare, acquirerSharePrice, effectiveDate, recordDate, parcelRolloverElections } = params;
  const actionId = uid();
  const activeParcels = holding.parcels.filter(p => p.status === 'active' && p.acquisitionDate <= recordDate);
  const newCgtEvents = [];
  const acquirerParcels = [];

  activeParcels.forEach(p => {
    const effCB = getEffectiveCostBase(p, holding.adjustments);
    const rollover = parcelRolloverElections && parcelRolloverElections[p.id] !== undefined ? parcelRolloverElections[p.id] : true;
    const acquirerQty = parseFloat((p.qty * exchangeRatio).toFixed(0));
    const cashProceeds = p.qty * cashPerShare;
    const scripProceeds = acquirerQty * acquirerSharePrice;
    const totalProceeds = cashProceeds + scripProceeds;
    const cashProportion = cashPerShare > 0 ? cashProceeds / totalProceeds : 0;
    const cashCostBase = effCB * cashProportion;
    const scripCostBase = effCB - cashCostBase;
    const newParcelId = uid();
    const de = discountEligibleAt(p.acquisitionDate, effectiveDate);

    if (rollover) {
      acquirerParcels.push({ id: newParcelId, origin: 'TAKEOVER',
        acquisitionDate: p.acquisitionDate, // INHERITED
        qty: acquirerQty, costPerUnit: parseFloat((scripCostBase / acquirerQty).toFixed(6)),
        totalCost: parseFloat(scripCostBase.toFixed(2)), status: 'active',
        sourceActionId: actionId, sourceRightsId: null, replacesParcelId: p.id,
        notes: 'Rollover from ' + holding.ticker + ' parcel ' + p.id + '. Acq. date inherited. Cost base carried over.' });
      if (cashPerShare > 0) {
        newCgtEvents.push({ id: uid(), holdingId: holding.id, rightsRecordId: null, actionId,
          eventType: 'A1', eventDate: effectiveDate,
          costBase: parseFloat(cashCostBase.toFixed(2)), proceeds: parseFloat(cashProceeds.toFixed(2)),
          capitalGain: Math.max(0, cashProceeds - cashCostBase), capitalLoss: Math.max(0, cashCostBase - cashProceeds),
          discountEligible: de, discountMethod: de ? '50_PERCENT' : null,
          discountedGain: de ? Math.max(0, (cashProceeds - cashCostBase) * 0.5) : Math.max(0, cashProceeds - cashCostBase),
          rolloverApplied: true, rolloverType: 'S124_780_SCRIP',
          notes: 'A1 — cash component only. Scrip component rolled. Parcel ' + p.id });
      }
    } else {
      acquirerParcels.push({ id: newParcelId, origin: 'TAKEOVER',
        acquisitionDate: effectiveDate, // new date — no rollover
        qty: acquirerQty, costPerUnit: acquirerSharePrice,
        totalCost: parseFloat(scripProceeds.toFixed(2)), status: 'active',
        sourceActionId: actionId, sourceRightsId: null, replacesParcelId: p.id,
        notes: 'No rollover — parcel ' + p.id + '. New cost base = market value of acquirer shares.' });
      const gain = totalProceeds - effCB;
      newCgtEvents.push({ id: uid(), holdingId: holding.id, rightsRecordId: null, actionId,
        eventType: 'A1', eventDate: effectiveDate,
        costBase: parseFloat(effCB.toFixed(2)), proceeds: parseFloat(totalProceeds.toFixed(2)),
        capitalGain: Math.max(0, gain), capitalLoss: Math.max(0, -gain),
        discountEligible: de, discountMethod: de ? '50_PERCENT' : null,
        discountedGain: de ? Math.max(0, gain * 0.5) : Math.max(0, gain),
        rolloverApplied: false, rolloverType: null,
        notes: 'A1 — full disposal, no rollover. Parcel ' + p.id });
    }
  });

  const cancelledIds = activeParcels.map(p => p.id);
  const cancelledParcels = holding.parcels.map(p => cancelledIds.includes(p.id) ? Object.assign({}, p, { status: 'disposed', disposalDate: effectiveDate, sourceActionId: actionId }) : p);
  const action = { id: actionId, actionType: 'TAKEOVER', announcementDate: recordDate, recordDate, effectiveDate,
    parameters: params, parcelsImpacted: cancelledIds, parcelsCreated: acquirerParcels.map(p => p.id), parcelsCancelled: cancelledIds,
    adjustmentsCreated: [], cgtEvents: newCgtEvents.map(e => e.id), classRulingRef: '',
    notes: 'Scrip-for-scrip takeover by ' + acquirerTicker + '. ' + acquirerParcels.length + ' acquirer parcels created.', status: 'applied' };

  return { updatedHolding: Object.assign({}, holding, { parcels: cancelledParcels, actions: holding.actions.concat([action]), cgtEvents: holding.cgtEvents.concat(newCgtEvents) }), acquirerParcels, acquirerTicker, acquirerEntityName };
}

/* ── CRYPTO FIFO (verbatim from tracker v6) ── */
function calcCryptoFIFO(transactions) {
  const assets = {};
  const disposals = [];
  const sorted = transactions.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
  sorted.forEach(tx => {
    if (!assets[tx.asset]) assets[tx.asset] = [];
    if (tx.type === 'buy') {
      assets[tx.asset].push({ date: tx.date, qty: tx.quantity, costPerUnit: tx.price + (tx.fees || 0) / Math.max(tx.quantity, 0.000001) });
    } else if (tx.type === 'sell') {
      let remaining = tx.quantity;
      let totalCost = 0;
      const pool = assets[tx.asset] || [];
      while (remaining > 0 && pool.length > 0) {
        const lot = pool[0];
        const used = Math.min(lot.qty, remaining);
        totalCost += used * lot.costPerUnit;
        lot.qty -= used; remaining -= used;
        if (lot.qty <= 0) pool.shift();
      }
      const proceeds = tx.quantity * tx.price - (tx.fees || 0);
      const gain = proceeds - totalCost;
      const buyRef = sorted.find(t => t.asset === tx.asset && t.type === 'buy');
      const buyDate = buyRef ? new Date(buyRef.date) : new Date(tx.date);
      const heldDays = Math.floor((new Date(tx.date) - buyDate) / 86400000);
      disposals.push({ id: tx.id, date: tx.date, asset: tx.asset, quantity: tx.quantity,
        proceeds, costBasis: totalCost, gain, longTerm: heldDays >= 365, heldDays, wallet: tx.wallet || '' });
    }
  });
  return disposals;
}

/* ── parcel → calcS input adapter (per mapping spec) ── */
function parcelToInput(parcel, holding, disposal, opts) {
  opts = opts || {};
  const adjs = getParcelAdjustments(parcel.id, holding.adjustments);
  const transDate = new Date((opts.rules || RULESETS['bill-2026']).transDate || '2027-07-01');
  let baseCB = parcel.totalCost;
  const ledger = [];
  adjs.forEach(a => {
    const amt = a.type === 'increase' ? a.amount : -Math.abs(a.amount);
    if (new Date(a.effectiveDate) < transDate) baseCB += amt;          // pre-2027: net into base entry
    else if (amt > 0) ledger.push({ date: a.effectiveDate, amount: amt, el: a.element || '4' });
    else baseCB += amt;                                                 // post-2027 decrease: conservative net-down
  });
  ledger.unshift({ date: parcel.acquisitionDate, amount: Math.max(0, baseCB), el: '1' });
  const acMap = { Share: 'shares', ETF: 'etf', Property: 'property_est', Crypto: 'shares' };
  return makeInput(Object.assign({
    ac: opts.ac || acMap[holding.type] || 'shares',
    inv: opts.inv || 'individual',
    ledger,
    pd: parcel.acquisitionDate,
    sp: disposal.salePrice,
    sd: disposal.saleDate,
    mv27: disposal.mv2027 || 0
  }, opts.overrides || {}));
}

const CBPDomain = {
  VERSION: 'phase1-2026-06-12',
  RULESETS, ASSET_CLASS_META, makeInput, calcS, calcMR, parcelToInput,
  getEffectiveCostBase, getParcelAdjustments,
  applyShareSplit, applyConsolidation, applyCapitalReturn, applyDemerger, applyTakeover,
  calcCryptoFIFO,
  helpers: { days, idxCB, fmt, pct, uid, discountEligibleAt, holdingDaysAt }
};

if (typeof module !== 'undefined' && module.exports) module.exports = CBPDomain;
else global.CBPDomain = CBPDomain;

})(typeof window !== 'undefined' ? window : globalThis);
