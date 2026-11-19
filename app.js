/* Rumo ao Milhão — personal investment tracker (web app).
   All data lives only on this device, encrypted with your PIN (AES-GCM, key from PBKDF2).
   The only network calls are price lookups (ticker names only, never amounts). */
'use strict';

const APP_ID = 'rumo-ao-milhao';
const APP_VERSION = '7.7';
document.addEventListener('touchstart', () => {}, { passive: true }); // lets iPhone show the pressed state
const K_META = 'rumo.meta.v1';   // { salt }
const K_DATA = 'rumo.data.v1';   // { iv, ct }  (encrypted app data)
const AUTOLOCK_MS = 2 * 60 * 1000;
const COINS = [
  { k: 'BTC', id: 'bitcoin', dec: 8 },
  { k: 'ETH', id: 'ethereum', dec: 6 },
  { k: 'XRP', id: 'ripple', dec: 4 },
  { k: 'SOL', id: 'solana', dec: 4 },
];
const CLASSES = [
  { k: 'acoes', n: 'Ações', c: 'var(--c1)', hex: '#2563EB' },
  { k: 'fiis', n: 'FIIs', c: 'var(--c2)', hex: '#0EA5A4' },
  { k: 'rf', n: 'Renda fixa', c: 'var(--c3)', hex: '#F59E0B' },
  { k: 'stocks', n: 'Stocks', c: 'var(--c4)', hex: '#8B5CF6' },
  { k: 'crypto', n: 'Crypto', c: 'var(--c5)', hex: '#EC4899' },
];
const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const MON3 = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

let DB = null, KEY = null, hiddenAt = 0, charts = [];
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

/* ---------------- helpers ---------------- */
const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brl = (v, d = 0) => 'R$ ' + (d ? nf2 : nf0).format(v || 0);
const gbp = (v, d = 0) => '£ ' + (d ? nf2 : nf0).format(v || 0);
const usd = (v, d = 0) => 'US$ ' + (d ? nf2 : nf0).format(v || 0);
const pct = (v) => (v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';   // all percentages: 2 decimals
const pctS = (v) => (v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';   // daily moves: always 2 decimals (−0,04%, +1,23%)
const signed = (s, v) => (v > 0 ? '+' : v < 0 ? '−' : '') + s(Math.abs(v));
const num = (x) => (typeof x === 'number' && isFinite(x) ? x : 0);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function parseNum(s) {
  if (s === null || s === undefined) return null;
  s = String(s).trim().replace(/\s|R\$|£|US\$|\$/g, '');
  if (!s) return null;
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc > -1 && ld > -1) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (lc > -1) s = s.replace(',', '.');
  const v = Number(s);
  return isFinite(v) ? v : null;
}
const ym = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
const ymLabel = (m) => { const [y, mo] = m.split('-').map(Number); return MON3[mo - 1] + '/' + String(y).slice(2); };
const ymLong = (m) => { const [y, mo] = m.split('-').map(Number); return MONTHS[mo - 1] + ' ' + y; };
const ymAdd = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 1 + n, 1); return ym(d); };
const ymDiff = (a, b) => { const [y1, m1] = a.split('-').map(Number), [y2, m2] = b.split('-').map(Number); return (y2 - y1) * 12 + (m2 - m1); };
const fmtDate = (iso) => { if (!iso) return '–'; const d = new Date(iso); return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}
// while a sheet is open the page behind it is pinned, so swiping a long list never scrolls the page underneath (iPhone ignores overflow:hidden)
let SHEET_Y = null;
function lockPage() { if (SHEET_Y !== null) return; SHEET_Y = window.scrollY; Object.assign(document.body.style, { position: 'fixed', top: -SHEET_Y + 'px', left: '0', right: '0' }); }
function unlockPage() { if (SHEET_Y === null) return; const y = SHEET_Y; SHEET_Y = null; Object.assign(document.body.style, { position: '', top: '', left: '', right: '' }); window.scrollTo(0, y); }
function openSheet(html, onMount) {
  const X = '<div class="sh-top"><button class="sh-x" aria-label="Fechar" onclick="closeSheet()"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>';
  clearTimeout(SHEET_T); const md = $('#modal');
  $('#sheet').innerHTML = X + html; $('#sheet').scrollTop = 0; const was = !md.classList.contains('hidden') && md.classList.contains('show');
  md.classList.remove('hidden'); lockPage(); if (!was) { md.classList.remove('show'); void md.offsetWidth; requestAnimationFrame(() => md.classList.add('show')); }
  // long lists: a close button appears pinned at the top once you scroll down
  const sh = $('#sheet'); sh.classList.remove('scrolled'); sh.onscroll = () => sh.classList.toggle('scrolled', sh.scrollTop > 120);
  if (onMount) onMount($('#sheet'));
}
// Sim / Não dialog in Portuguese (the iPhone's own confirm box always says OK / Cancel in the phone's language)
function ask(msg, { yes = 'Sim', no = 'Não', danger = false } = {}) {
  return new Promise((done) => {
    const w = document.createElement('div'); w.className = 'ask';
    w.innerHTML = `<div class="ask-box"><p></p><div class="ask-b"><button class="btn" data-a="0"></button><button class="btn ${danger ? 'danger' : 'primary'}" data-a="1"></button></div></div>`;
    $('p', w).textContent = msg; w.querySelector('[data-a="0"]').textContent = no; w.querySelector('[data-a="1"]').textContent = yes;
    w.onclick = (e) => { const b = e.target.closest('[data-a]'); if (!b) return; w.remove(); done(b.dataset.a === '1'); };
    document.body.appendChild(w);
  });
}
let SHEET_T = null;
function closeSheet() { const md = $('#modal'); md.classList.remove('show'); unlockPage(); clearTimeout(SHEET_T);
  SHEET_T = setTimeout(() => { md.classList.add('hidden'); $('#sheet').innerHTML = ''; }, 260); }
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeSheet(); });

/* ---------------- crypto (encryption) ---------------- */
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function deriveKey(secret, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function encryptObj(obj, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return { iv: b64(iv), ct: b64(ct) };
}
async function decryptObj(box, key) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.ct));
  return JSON.parse(dec.decode(pt));
}

/* ---------------- data model ---------------- */
function emptyDB() {
  return {
    app: APP_ID, version: 1,
    settings: { meta: 1000000, targets: { acoes: .2, fiis: .2, rf: .2, stocks: .2, crypto: .2 }, aportePlanGBP: 0, retornoAnual: .07, lastBackup: null },
    balances: { acoes: 0, fiis: 0, pieStocks: 0, pieReits: 0, pieEtfs: 0, t212cash: 0, rfBrasil: 0, caixa: 0 },
    prices: { gbpbrl: 0, usdbrl: 0, BTC: 0, ETH: 0, XRP: 0, SOL: 0, updatedAt: null, source: '' },
    draft: { month: ym(), divFII: null, divAcoes: null, divStocks: null, aporteGBP: null },
    crypto: { people: ['Eu'], pre: {}, fees: {}, log: [] },
    assets: [],
    history: [],
    daily: [],
    divLog: [],
    apLog: [],
  };
}
function normalize(d) {
  const e = emptyDB();
  d = Object.assign(e, d || {});
  for (const k of ['settings', 'balances', 'prices', 'draft', 'crypto']) d[k] = Object.assign(emptyDB()[k], d[k] || {});
  d.settings.targets = Object.assign(emptyDB().settings.targets, d.settings.targets || {});
  d.settings.auto = Object.assign({ acoes: false, fiis: false, stocks: false }, d.settings.auto || {});
  d.settings.keys = Object.assign({ brapi: '', finnhub: '', alpha: '', sheet: '' }, d.settings.keys || {});
  delete d.settings.keys.hg; if (d.settings.keyStatus) delete d.settings.keyStatus.hg;
  for (const a of d.assets || []) {
    if (a.market === 'HG') a.market = 'GS'; // HG Brasil removed (free plan has no quotes)
    if (!a.avgCur) a.avgCur = a.cls === 'stocks' ? 'GBP' : 'ASSET'; // Exterior: average price in £, as Trading 212 shows it
  }
  d.settings.keyStatus = d.settings.keyStatus || {};
  d.assets = (d.assets || []).map((a) => ({ id: a.id || uid(), ...a }));
  d.history = (d.history || []).filter((h) => h && h.month).sort((a, b) => a.month.localeCompare(b.month));
  d.apLog = (d.apLog || []).filter((x) => x && x.date && typeof x.gbp === 'number');
  d.divLog = (d.divLog || []).filter((x) => x && x.date && typeof x.amount === 'number');
  d.mvLog = (d.mvLog || []).filter((x) => x && x.date && typeof x.amt === 'number');
  d.daily = (d.daily || []).filter((x) => x && x.d && typeof x.v === 'number').sort((a, b) => a.d.localeCompare(b.d));
  d.crypto.log = (d.crypto.log || []).map((x) => ({ id: x.id || uid(), ...x })).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return d;
}
let SAVE_ERR = null;
async function save() {
  if (!DB || !KEY) return;
  const data = JSON.stringify(await encryptObj(DB, KEY));
  try { localStorage.setItem(K_DATA, data); if (SAVE_ERR) { SAVE_ERR = null; render(); } }
  catch (e) { console.error('save', e); const first = !SAVE_ERR; SAVE_ERR = String(e?.name || e); toast('⚠ Não consegui salvar neste aparelho. Faça um backup agora (Ajustes → Backup).', 8000); if (first) render(); }
}

/* ---------------- calculations ---------------- */
function cryptoSummary() {
  const c = DB.crypto, p = DB.prices, people = c.people;
  const coins = COINS.map((co) => {
    const per = {}, got = {};
    for (const who of people) {
      const pre = num(c.pre?.[co.k]?.[who]), ops = c.log.filter((x) => x.coin === co.k && x.name === who);
      per[who] = pre + ops.reduce((s, x) => s + (x.op === 'Sold' ? -1 : 1) * num(x.qty), 0);
      got[who] = pre + ops.filter((x) => x.op !== 'Sold').reduce((s, x) => s + num(x.qty), 0);
    }
    const fee = num(c.fees?.[co.k]);
    // transfer fees are shared by how much each person ever received (doesn't change when someone sells)
    const gotT = Object.values(got).reduce((a, b) => a + b, 0), net = {};
    for (const who of people) { const v = per[who] - (gotT ? fee * got[who] / gotT : 0); net[who] = Math.abs(v) < 1e-9 ? 0 : v; }
    const units = Object.values(per).reduce((a, b) => a + b, 0) - fee;
    const valUSD = units * num(p[co.k]);
    return { ...co, per, net, fee, units, valUSD, valBRL: valUSD * num(p.usdbrl) };
  });
  const totalUSD = coins.reduce((s, x) => s + x.valUSD, 0);
  // BTC profit per person: Buy rows of the log, plus coins received at no cost
  // average-cost method: a sale removes coins at the average price paid, so a full sale leaves 0
  const pos = (who) => { let qty = 0, cost = 0;
    for (const x of c.log) { if (x.coin !== 'BTC' || x.name !== who) continue;
      if (x.op === 'Buy') { qty += num(x.qty); cost += num(x.value); }
      else if (x.op === 'Received') qty += num(x.qty);   // rewards: coins with no cost
      else if (x.op === 'Sold' && qty > 0) { const q = Math.min(qty, num(x.qty)); cost -= cost * q / qty; qty -= q; } }
    return { qty: qty > 1e-12 ? qty : 0, cost: qty > 1e-12 ? cost : 0 }; };
  const pl = (who) => {
    const ps = (who ? [who] : people).map(pos);
    const qty = ps.reduce((s, x) => s + x.qty, 0), cost = ps.reduce((s, x) => s + x.cost, 0);
    const now = qty * num(p.BTC);
    return { qty, cost, avg: qty ? cost / qty : 0, now, pl: now - cost, plPct: cost ? (now - cost) / cost : 0 };
  };
  // profit since purchase, per coin: an optional starting point you type (quantity + average price on a date), then the log from that date on.
  // Buy adds coins and cost · Sold removes coins at the average (the average stays) · Received adds coins with no cost (rewards count as profit)
  const basis = c.basis || {};
  const cost = (k) => { const st = basis[k]; let q = st ? num(st.qty) : 0, cst = st ? num(st.qty) * num(st.avg) : 0, r = 0;
    const after = (x) => { const d = x.date || ''; return d > st.d || (d === st.d && Array.isArray(st.ids) && !st.ids.includes(x.id)); };
    for (const x of [...c.log].filter((x) => x.coin === k && (!st || after(x))).sort((a, b) => (a.date || '').localeCompare(b.date || ''))) {
      if (x.op === 'Buy') { q += num(x.qty); cst += num(x.value); }
      else if (x.op === 'Sold') { const k2 = Math.min(q, num(x.qty)); if (q > 0) { cst -= cst * k2 / q; q -= k2; } }
      else if (x.op === 'Received') r += num(x.qty); }
    if (q <= 1e-12) return null; const now = (q + r) * num(p[k]);
    return { qty: q, rec: r, cost: cst, avg: cst / q, now, pl: now - cst, plPct: cst ? now / cst - 1 : 0, start: !!st }; };
  coins.forEach((co) => { co.pl = cost(co.k); });
  const W = coins.filter((x) => x.pl), plTot = W.length ? { cost: W.reduce((t, x) => t + x.pl.cost, 0), now: W.reduce((t, x) => t + x.pl.now, 0) } : null;
  if (plTot) { plTot.pl = plTot.now - plTot.cost; plTot.plPct = plTot.cost ? plTot.now / plTot.cost - 1 : 0; plTot.n = W.length; }
  return { coins, totalUSD, totalBRL: totalUSD * num(p.usdbrl), plTot, btcPL: pl(null), btcPLby: Object.fromEntries(people.map((w) => [w, pl(w)])) };
}
function portfolio() {
  const b = DB.balances, p = DB.prices, cs = cryptoSummary();
  const au = DB.settings.auto || {};
  const v = {
    acoes: au.acoes ? classTotal('acoes') : num(b.acoes), fiis: au.fiis ? classTotal('fiis') : num(b.fiis),
    rf: num(b.t212cash) * num(p.gbpbrl) + num(b.rfBrasil),
    stocks: au.stocks ? classTotal('stocks') : (num(b.pieStocks) + num(b.pieReits) + num(b.pieEtfs)) * num(p.gbpbrl),
    crypto: cs.totalBRL,
  };
  const invested = Object.values(v).reduce((a, c) => a + c, 0);
  const total = invested + num(b.caixa);
  const t = DB.settings.targets;
  const alloc = CLASSES.map((c) => ({ ...c, v: v[c.k], cur: invested ? v[c.k] / invested : 0, tgt: num(t[c.k]), gap: invested * num(t[c.k]) - v[c.k] }));
  const next = alloc.reduce((a, c) => (c.gap > a.gap ? c : a), alloc[0]);
  return { v, invested, total, alloc, next, cs };
}
// a month's dividends in R$: logged payments keep the R$ value of the day they were paid; typed totals use the month's saved rate
const divTotal = (h) => {
  const L = (DB.divLog || []).filter((e) => e.date.slice(0, 7) === h.month), byF = {};
  for (const e of L) { const f = DTYPES[e.type].f; byF[f] = (byF[f] || 0) + divInField(e, 'divFII'); }
  const part = (f, typed) => (f in byF ? byF[f] : typed);
  return part('divFII', num(h.divFII)) + part('divAcoes', num(h.divAcoes)) + part('divStocks', h.fx ? num(h.divStocks) * h.fx : 0);
};
// history with the current month replaced by today's live figures (the 1st of next month saves the real close)
function histLive() {
  const m = ym(), H = DB.history, prev = H.filter((h) => typeof h.pat === 'number' && h.month < m).slice(-1)[0];
  if (!prev) return H;
  const P = portfolio(); if (!(P.total > 0)) return H;
  const saved = H.find((h) => h.month === m) || {}, src = DB.draft.month === m ? DB.draft : saved, a = apSum(m);
  const row = { ...saved, month: m, pat: P.total, aporteGBP: a !== null ? a : src.aporteGBP ?? null, fx: DB.prices.gbpbrl || saved.fx || null, usd: DB.prices.usdbrl || saved.usd || null, live: true };
  for (const f of DIV_FIELDS) if ((row[f] === null || row[f] === undefined) && src[f] !== null && src[f] !== undefined) row[f] = src[f];
  return [...H.filter((h) => h.month !== m), row];
}
function historyStats() {
  const H = histLive(), withPat = H.filter((h) => typeof h.pat === 'number');
  const last = withPat[withPat.length - 1] || null;
  let cresc12 = null;
  if (last) {
    const prev = withPat.find((h) => h.month === ymAdd(last.month, -12));
    if (prev) cresc12 = (last.pat - prev.pat) / 12;
  }
  const year = last ? last.month.slice(0, 4) : String(new Date().getFullYear());
  const inYear = H.filter((h) => h.month.startsWith(year));
  const divYear = inYear.reduce((s, h) => s + divTotal(h), 0);
  const monthsWithDiv = inYear.filter((h) => divTotal(h) > 0).length;
  const divLife = H.reduce((s, h) => s + divTotal(h), 0);
  return { last, cresc12, year, divYear, monthsWithDiv, divLife };
}
function milestones() {
  const meta = num(DB.settings.meta), step = meta / 10, H = DB.history.filter((h) => typeof h.pat === 'number');
  return Array.from({ length: 10 }, (_, i) => {
    const v = step * (i + 1);
    let hit = null;
    for (let j = 0; j < H.length - 1; j++) {
      if (H[j].pat >= v && H[j + 1].pat >= v && ymDiff(H[j].month, H[j + 1].month) === 1) { hit = H[j].month; break; }
    }
    return { v, hit };
  });
}
function projections(total) {
  const st = historyStats(), s = DB.settings, meta = num(s.meta), base = ym();   // total is today's live value, so count from this month
  const falta = Math.max(0, meta - total);
  let ritmo = null, cenario = null;
  if (falta === 0) ritmo = cenario = base;
  else {
    if (st.cresc12 > 0) ritmo = ymAdd(base, Math.ceil(falta / st.cresc12));
    const r = Math.pow(1 + num(s.retornoAnual), 1 / 12) - 1, pmt = num(s.aportePlanGBP) * num(DB.prices.gbpbrl);
    let n = null;
    if (r > 0) { const a = (meta * r + pmt) / (total * r + pmt); if (a > 0) n = Math.log(a) / Math.log(1 + r); }
    else if (pmt > 0) n = falta / pmt;
    if (n !== null && isFinite(n) && n < 1200) cenario = ymAdd(base, Math.ceil(n));
  }
  return { falta, ritmo, cenario };
}

/* ---------------- prices ---------------- */
async function fetchJSON1(url) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
  try { const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' }); if (!r.ok) { const e = new Error(r.status); e.status = r.status; throw e; } return await r.json(); }
  finally { clearTimeout(t); }
}
async function fetchJSON(url) {
  try { return await fetchJSON1(url); }
  catch (e) { if (e.status && e.status !== 429 && e.status < 500) throw e; await new Promise((r) => setTimeout(r, e.status === 429 ? 2500 : 1200)); return fetchJSON1(url); }
}
// the ⟳ button spins while prices load, so a tap always shows something happening
async function refreshPrices(silent, fromPull) {
  const b = fromPull ? null : document.getElementById('btn-refresh'); b?.classList.add('spin'); document.body.classList.add('loading'); const u0 = DB?.prices?.updatedAt;
  try { const r = await refreshPricesNow(silent); if (PREVIEW && !silent) await new Promise((z) => setTimeout(z, 900)); return r; }
  finally { setTimeout(() => { b?.classList.remove('spin'); document.body.classList.remove('loading'); const el = document.getElementById('top-sub'); if (el && DB?.prices?.updatedAt && DB.prices.updatedAt !== u0) { el.classList.remove('justnow'); void el.offsetWidth; el.classList.add('justnow'); } }, 400); }
}
const PREVIEW = !!window.RUMO_PREVIEW;
async function refreshPricesNow(silent) {
  if (PREVIEW) { if (!silent) toast('Na prévia os preços não são buscados — valores de exemplo'); return false; }
  if (!navigator.onLine) { if (!silent) toast('Sem internet — usando os últimos preços salvos'); return false; }
  const p = DB.prices; let ok = 0;
  const assetsP = refreshAssetPrices(!silent).catch((e) => { console.warn('assets', e); return null; });
  // live exchange rates from the Google Sheet (rows CURRENCY:GBPBRL, CURRENCY:USDBRL, CURRENCY:EURBRL), at most every 10 min
  // crypto price at 00:00 today (once a day), so "hoje" starts from zero at midnight
  const cmidGo = () => (!p.cmid || p.cmid.d !== today()) && navigator.onLine ? (async () => {
    const mid = new Date(); mid.setHours(0, 0, 0, 0); const o = { d: today() };
    for (const c of COINS) { await new Promise((r) => setTimeout(r, 1200)); try { const j = await fetchJSON1(`https://api.coingecko.com/api/v3/coins/${c.id}/market_chart?vs_currency=usd&days=1`);
      const pt = (j?.prices || []).find((x) => x[0] >= mid.getTime()); if (pt && pt[0] - mid.getTime() < 2 * 3600 * 1000) o[c.k] = pt[1]; } catch (e) { console.warn('cg midnight', c.k, e); } }
    if (COINS.some((c) => o[c.k])) p.cmid = o; })().catch(() => null) : null;
  let cmidP = null;
  // live exchange rates with no setup: AwesomeAPI (Brazil) first, Coinbase second
  const liveFxP = navigator.onLine ? (async () => {
    try { const j = await fetchJSON('https://economia.awesomeapi.com.br/json/last/GBP-BRL,USD-BRL,EUR-BRL');
      const g = parseFloat(j?.GBPBRL?.bid), u = parseFloat(j?.USDBRL?.bid), e = parseFloat(j?.EURBRL?.bid); if (g > 0 && u > 0) return { g, u, e: e > 0 ? e : null, src: 'ao vivo' }; } catch (e) { console.warn('fx awesome', e); }
    try { const j = await fetchJSON('https://api.coinbase.com/v2/exchange-rates?currency=GBP'), r = j?.data?.rates || {};
      const g = parseFloat(r.BRL), us = parseFloat(r.USD), eu = parseFloat(r.EUR); if (g > 0 && us > 0) return { g, u: g / us, e: eu > 0 ? g / eu : null, src: 'ao vivo' }; } catch (e) { console.warn('fx coinbase', e); }
    return null; })() : null;
  const ks = DB.settings.keys || {}, sfOld = !p.sheetFx || Date.now() - new Date(p.sheetFx.at) > 10 * 60 * 1000;
  const sheetFxP = ks.sheet && sfOld && navigator.onLine ? (async () => { const keep = LASTERR.sheet; const q = await sheetQuotes(FX_SHEET, ks.sheet); LASTERR.sheet = keep;
    if (q[FX_SHEET[0]]) p.sheetFx = { g: q[FX_SHEET[0]], u: q[FX_SHEET[1]] || null, e: q[FX_SHEET[2]] || null, at: new Date().toISOString() }; })().catch(() => null) : null;   // shares run at the same time as crypto + FX
  try {
    const j = await fetchJSON('https://api.coingecko.com/api/v3/simple/price?ids=' + COINS.map((c) => c.id).join(',') + '&vs_currencies=usd&include_24hr_change=true');
    for (const c of COINS) if (j[c.id]?.usd) { p[c.k] = j[c.id].usd; p[c.k + '_24h'] = j[c.id].usd_24h_change ?? null; ok++; }
  } catch (e) { console.warn('crypto price', e); }
  cmidP = cmidGo();
  let fx = false;
  if (!p.ecb || Date.now() - new Date(p.ecb.at) > 6 * 3600 * 1000) {   // the ECB rate changes once a day: backup and sanity check only
    const put = (j) => { if (j?.rates?.BRL && j.rates?.USD) p.ecb = { g: j.rates.BRL, u: j.rates.BRL / j.rates.USD, e: j.rates.EUR ? j.rates.BRL / j.rates.EUR : null, at: new Date().toISOString() }; };
    try { let j; try { j = await fetchJSON('https://api.frankfurter.dev/v1/latest?base=GBP&symbols=BRL,USD,EUR'); } catch { j = await fetchJSON('https://api.frankfurter.app/latest?from=GBP&to=BRL,USD,EUR'); } put(j); } catch (e) { console.warn('fx frankfurter', e); }
    if (!p.ecb || Date.now() - new Date(p.ecb.at) > 6 * 3600 * 1000) { try { put(await fetchJSON('https://open.er-api.com/v6/latest/GBP')); } catch (e) { console.warn('fx er-api', e); } }
  }
  if (p.ecb) { p.gbpbrl = p.ecb.g; p.usdbrl = p.ecb.u; if (p.ecb.e) p.eurbrl = p.ecb.e; fx = true; }
  const ar = await assetsP; await sheetFxP; const lv = await liveFxP; await cmidP;
  // live rate first (moves during the day); the ECB rate is set once a day and stays as the backup and sanity check
  const near = (a, b) => !b || (a / b > 0.8 && a / b < 1.25);
  const sf = lv && near(lv.g, fx ? p.gbpbrl : null) ? { ...lv, at: new Date().toISOString() } : p.sheetFx;
  if (sf && sf.g && Date.now() - new Date(sf.at) < 40 * 60 * 1000 && near(sf.g, fx ? p.gbpbrl : null)) {
    const ecbG = p.gbpbrl, ecbU = p.usdbrl; p.gbpbrl = sf.g;
    p.usdbrl = sf.u && near(sf.u, ecbU) ? sf.u : ecbU && ecbG ? ecbU * (sf.g / ecbG) : p.usdbrl;
    if (sf.e && near(sf.e, p.eurbrl)) p.eurbrl = sf.e; p.fxSrc = 'planilha'; p.fxAt = sf.at; fx = true;
  } else if (fx) p.fxSrc = 'BCE';
  if (ok || fx || ar) {
    p.updatedAt = new Date().toISOString(); await save(); render(); dailySnap();
    const miss = [ok < COINS.length ? 'cripto' : '', fx ? '' : 'câmbio', ...(ar?.fail || [])].filter(Boolean);
    if (miss.length) retrySoon(); else RETRY.n = 0;
    if (!silent) toast(miss.length ? `Não atualizou: ${miss.slice(0, 6).join(', ')}${miss.length > 6 ? '…' : ''} — tento de novo em 20 s` : 'Preços atualizados', miss.length ? 4500 : 2200);
    return true;
  }
  retrySoon();
  if (!silent) toast('Não consegui buscar preços agora — tento de novo em 20 s');
  return false;
}
// after a failed or partial refresh: try again quietly (twice at most)
const RETRY = { n: 0, t: null };
function retrySoon() { if (RETRY.t || RETRY.n >= 2) return; RETRY.n++; RETRY.t = setTimeout(() => { RETRY.t = null; if (DB && !document.hidden && navigator.onLine) { if (DB.prices.assetsAt) DB.prices.assetsAt = null; refreshPrices(true); } }, 20000); }

/* ---------------- keys: one random data key, unlocked by PIN, Face ID or recovery code ---------------- */
let DKRAW = null; // raw data key while unlocked
const rnd = (n) => crypto.getRandomValues(new Uint8Array(n));
const getMeta = () => { try { return JSON.parse(localStorage.getItem(K_META)); } catch { return null; } };
const setMeta = (m) => localStorage.setItem(K_META, JSON.stringify(m));
const rawToKey = (raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
async function wrapRaw(kek, raw) { const iv = rnd(12); return { iv: b64(iv), ct: b64(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, raw)) }; }
async function unwrapRaw(kek, box) { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, kek, unb64(box.ct))); }
async function wrapWithSecret(secret) { const salt = rnd(16); return { salt: b64(salt), ...(await wrapRaw(await deriveKey(secret, salt), DKRAW)) }; }
async function unwrapWithSecret(secret, w) { return unwrapRaw(await deriveKey(secret, unb64(w.salt)), w); }
async function prfKey(out) {
  const base = await crypto.subtle.importKey('raw', out, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode('rumo-faceid') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const RC_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newRecoveryCode() { const b = rnd(20); let s = ''; for (let i = 0; i < 20; i++) { s += RC_ALPHA[b[i] % 32]; if (i % 4 === 3 && i < 19) s += '-'; } return s; }
const normCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(.{4})(?=.)/g, '$1-');
async function openWithRaw(raw) { DKRAW = raw; KEY = await rawToKey(raw); DB = normalize(await decryptObj(JSON.parse(localStorage.getItem(K_DATA)), KEY)); }

/* Face ID (passkey + PRF extension: the iPhone releases a secret only after Face ID) */
async function faceGetSecret(credId, salt) {
  const a = await navigator.credentials.get({ publicKey: { challenge: rnd(32), rpId: location.hostname, allowCredentials: [{ type: 'public-key', id: credId }],
    userVerification: 'required', timeout: 60000, extensions: { prf: { eval: { first: salt } } } } });
  const r = a.getClientExtensionResults()?.prf?.results?.first;
  if (!r) throw new Error('noprf');
  return r;
}
async function enableFaceID() {
  if (!window.PublicKeyCredential || !navigator.credentials?.create) throw new Error('unsupported');
  const prfSalt = rnd(32);
  const cred = await navigator.credentials.create({ publicKey: {
    challenge: rnd(32), rp: { name: 'Rumo ao Milhão', id: location.hostname },
    user: { id: rnd(16), name: 'Rumo ao Milhão', displayName: 'Rumo ao Milhão' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' },
    timeout: 60000, extensions: { prf: { eval: { first: prfSalt } } } } });
  const ext = cred.getClientExtensionResults()?.prf;
  if (!ext || ext.enabled === false) throw new Error('noprf');
  let out = ext.results?.first;
  if (!out) out = await faceGetSecret(cred.rawId, prfSalt);
  const meta = getMeta();
  meta.face = { credId: b64(cred.rawId), prfSalt: b64(prfSalt), ...(await wrapRaw(await prfKey(out), DKRAW)) };
  setMeta(meta);
}
async function unlockWithFace() {
  const f = getMeta()?.face; if (!f) return false;
  const out = await faceGetSecret(unb64(f.credId), unb64(f.prfSalt));
  await openWithRaw(await unwrapRaw(await prfKey(out), f));
  return true;
}

/* recovery code sheet */
function showRecovery(code, then) {
  openSheet(`<h3>🔑 Código de recuperação</h3>
    <p class="small">Se esquecer o PIN, este código abre o app. <b>Anote num lugar seguro</b> (papel, gerenciador de senhas). Ele só aparece agora.</p>
    <div class="code-box" id="rc">${code}</div>
    <button class="btn block" id="rc-copy">Copiar</button>
    <button class="btn primary block" id="rc-ok">Já anotei</button>`, (el) => {
    $('#rc-copy', el).onclick = () => navigator.clipboard?.writeText(code).then(() => toast('Copiado'), () => toast('Selecione e copie o código'));
    $('#rc-ok', el).onclick = () => { closeSheet(); then && then(); };
  });
}

/* ---------------- lock screen ---------------- */
function showLock(mode) {
  // mode: 'unlock' | 'setup' (new PIN; when DKRAW exists it only changes the PIN)
  $('#app').classList.add('hidden'); $('#welcome').classList.add('hidden'); $('#lock').classList.remove('hidden');
  let pin = '', first = '', confirming = false;
  const meta = getMeta();
  PG_I = 0;
  const msg = $('#lock-msg'), dots = $('#dots'), foot = $('#lock-foot');
  { const h = new Date().getHours(), g = h < 5 ? 'Boa noite' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'; const hi = $('#lock-hi'); if (hi) hi.textContent = g; }
  const changing = mode === 'setup' && !!DKRAW;
  const setMsg = () => {
    msg.textContent = mode === 'unlock' ? 'Digite seu PIN' : confirming ? 'Confirme o PIN' : changing ? 'Crie o novo PIN' : 'Crie um PIN de 6 dígitos';
    foot.innerHTML = mode === 'unlock'
      ? (meta?.rec || meta?.salt ? '<button class="link" id="forgot">Esqueci o PIN</button>' : '')
      : changing ? '<button class="link" id="cancel-pin">Cancelar</button>' : 'Você também vai receber um código de recuperação, caso esqueça o PIN.';
    $('#forgot') && ($('#forgot').onclick = forgotPin);
    $('#cancel-pin') && ($('#cancel-pin').onclick = () => enterApp());
  };
  const draw = () => $$('#dots i').forEach((d, i) => d.classList.toggle('on', i < pin.length));
  const fail = (m) => { msg.textContent = m; dots.classList.add('shake'); setTimeout(() => dots.classList.remove('shake'), 400); pin = ''; draw(); };
  setMsg(); draw();
  const fb = $('#face-btn');
  fb.classList.toggle('hidden', !(mode === 'unlock' && meta?.face));
  fb.onclick = async () => {
    try { msg.textContent = 'Abrindo…'; if (await unlockWithFace()) enterApp(); }
    catch (e) { setMsg(); if (e.name !== 'NotAllowedError') toast('Face ID não funcionou — use o PIN'); }
  };
  if (mode === 'unlock' && meta?.face && showLock.auto !== false) { showLock.auto = false; setTimeout(() => fb.click(), 300); }
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
  $('#pad').innerHTML = keys.map((k) => `<button class="${k === '' ? 'blank' : ''}" data-k="${k}">${k}</button>`).join('');
  $('#pad').onclick = async (e) => {
    const k = e.target.dataset?.k; if (k === undefined || k === '') return;
    if (k === '⌫') { pin = pin.slice(0, -1); draw(); return; }
    if (pin.length >= 6) return;
    pin += k; draw();
    if (pin.length < 6) return;
    if (mode === 'setup') {
      if (!confirming) { first = pin; pin = ''; confirming = true; setMsg(); draw(); return; }
      if (pin !== first) { confirming = false; first = ''; setMsg(); fail('Os PINs não batem — tente de novo'); return; }
      if (changing) {
        const m = getMeta(); const was = !!m.open; m.pin = await wrapWithSecret(pin); delete m.open; setMeta(m); toast(was ? '🔒 O app agora pede PIN ao abrir' : 'PIN alterado'); enterApp(); return;
      }
      // first run: new data key + recovery code
      DKRAW = rnd(32); KEY = await rawToKey(DKRAW);
      const code = newRecoveryCode();
      setMeta({ v: 2, pin: await wrapWithSecret(pin), rec: await wrapWithSecret(code.replace(/-/g, '')), face: null });
      showRecovery(code, () => {
        if (DB) { save().then(enterApp); } else { $('#lock').classList.add('hidden'); $('#welcome').classList.remove('hidden'); }
      });
      return;
    }
    msg.textContent = 'Abrindo…';
    try {
      const m = getMeta();
      if (m && m.v === 2) { await openWithRaw(await unwrapWithSecret(pin, m.pin)); enterApp(); }
      else {
        // version 1 (data encrypted directly with the PIN): open, then upgrade to the new key system
        const key = await deriveKey(pin, unb64(m.salt));
        DB = normalize(await decryptObj(JSON.parse(localStorage.getItem(K_DATA)), key));
        localStorage.setItem('rumo.legacy.bak', JSON.stringify({ meta: m, data: localStorage.getItem(K_DATA) })); // safety copy during upgrade
        DKRAW = rnd(32); KEY = await rawToKey(DKRAW);
        const code = newRecoveryCode();
        const nm = { v: 2, pin: await wrapWithSecret(pin), rec: await wrapWithSecret(code.replace(/-/g, '')), face: null };
        await save(); setMeta(nm);
        showRecovery(code, enterApp);
      }
    } catch (err) { console.warn(err); fail('PIN incorreto'); }
  };
}
function forgotPin() {
  const m = getMeta();
  if (!m?.rec) { alert('Esta versão do app ainda não tinha código de recuperação. A única saída é importar um backup (Ajustes não está acessível sem o PIN): apague o app da tela inicial, adicione de novo e importe seu backup.'); return; }
  openSheet(`<h3>Esqueci o PIN</h3><p class="small">Digite o código de recuperação que você anotou.</p>
    <div class="field"><label>Código</label><input id="rc-in" autocapitalize="characters" autocomplete="off" style="text-align:left" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"></div>
    <button class="btn primary block" id="rc-go">Abrir e criar novo PIN</button><button class="btn block" onclick="closeSheet()">Cancelar</button>`, (el) => {
    $('#rc-go', el).onclick = async () => {
      try { await openWithRaw(await unwrapWithSecret(normCode($('#rc-in', el).value).replace(/-/g, ''), m.rec)); closeSheet(); showLock('setup'); }
      catch { toast('Código incorreto'); }
    };
  });
}
function lockNow() { DB = null; KEY = null; DKRAW = null; charts.forEach((c) => c.destroy()); charts = []; $('#view').innerHTML = ''; showLock.auto = true; showLock('unlock'); }
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (DB && hiddenAt && Date.now() - hiddenAt > AUTOLOCK_MS && !getMeta()?.open) lockNow();
  else if (DB) maybeRefreshPrices();
});
$('#w-empty').onclick = async () => { DB = emptyDB(); await save(); enterApp(); };
if (PREVIEW && $('#w-demo')) { $('#w-demo').classList.remove('hidden'); $('#w-demo').onclick = async () => { DB = demoDB(); await save(); enterApp(); }; }
// invented example portfolio for the preview (no real data)
function demoDB() {
  const D = emptyDB(), now = new Date().toISOString(), td = today();
  Object.assign(D.prices, { gbpbrl: 7.26, usdbrl: 5.43, eurbrl: 6.31, BTC: 64852, ETH: 1803, XRP: 0.97, SOL: 73.29, BTC_24h: 1.02, ETH_24h: -0.2, XRP_24h: 2.59, SOL_24h: 4.4, updatedAt: now, assetsAt: now, fxSrc: 'planilha' });
  D.settings.aportePlanGBP = 1000; D.settings.auto = { acoes: true, fiis: true, stocks: true }; D.settings.lastBackup = now;
  const A = (cls, ticker, name, qty, price, avg, pc, extra = {}) => ({ id: uid(), cls, ticker, name, market: 'MANUAL', manualPrice: price, price, currency: 'BRL', avgCur: 'ASSET', qty, avg, pc, pcAt: td, priceAt: now, ...extra });
  D.assets = [
    A('acoes', 'BBSE3', 'BB Seguridade', 180, 43.12, 28.1, 42.8), A('acoes', 'ITSA4', 'Itaúsa', 500, 13.32, 8.05, 13.37), A('acoes', 'EGIE3', 'Engie Brasil', 200, 27.5, 29.0, 27.42),
    A('acoes', 'BBAS3', 'Banco do Brasil', 300, 17.78, 19.9, 18.07), A('acoes', 'SAPR4', 'Sanepar', 600, 6.7, 4.52, 6.63), A('acoes', 'TAEE11', 'Taesa', 50, 40.42, 36.1, 40.2),
    A('fiis', 'HGLG11', 'CSHG Logística', 120, 160.2, 165.4, 160.0), A('fiis', 'XPML11', 'XP Malls', 200, 105.3, 110.2, 104.9), A('fiis', 'MXRF11', 'Maxi Renda', 1500, 9.81, 10.2, 9.84), A('fiis', 'KNRI11', 'Kinea Renda Imobiliária', 100, 150.1, 145.0, 149.6),
    A('stocks', 'VWRP', 'Vanguard FTSE All-World', 60, 143.96, 120, 143.0, { currency: 'GBP', kind: 'ETF', avgCur: 'GBP' }),
    A('stocks', 'O', 'Realty Income', 40, 57.1, 45, 56.8, { currency: 'USD', kind: 'REIT', avgCur: 'GBP' }),
    A('stocks', 'AAPL', 'Apple', 8, 228.4, 150, 226.0, { currency: 'USD', kind: 'Stock', avgCur: 'GBP' }),
  ];
  Object.assign(D.balances, { t212cash: 3000, rfBrasil: 25000, caixa: 5000 });
  D.crypto = { people: ['Eu'], pre: { BTC: { Eu: 0.15 }, ETH: { Eu: 0.2 }, XRP: { Eu: 150 } }, fees: {}, log: [] };
  D.prices.cmid = { d: td, BTC: 64200, ETH: 1810, XRP: 0.95, SOL: 72 };
  DB = D; const P = portfolio(), n = natNow(P), c = catNow(P), T = P.total;
  // the last 13 closed months: steady growth with £1.000 a month
  const y = Number(ym().slice(0, 4)), last = Number(ym().slice(5)) - 1;
  for (let m = last - 13; m <= last; m++) { const f = 0.62 + 0.38 * ((m + 14 - last) / 15) + (((m % 3) + 3) % 3 === 0 ? -0.012 : 0.008);
    D.history.push({ month: ymAdd(`${y}-01`, m - 1), pat: Math.round(T * f * 0.985), aporteGBP: 1000, fx: 7.1 + m * 0.01, usd: 5.35, divFII: 950 + m * 12, divAcoes: 120 + (m % 4) * 40, divStocks: 18 + m, cat: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Math.round(v * f * 0.985)])), nat: { brl: n.brl * f * 0.985, gbp: n.gbp * f * 0.985, usd: n.usd * f * 0.985 }, savedAt: now }); }
  // daily records for the last 25 days
  for (let i = 25; i >= 1; i--) { const t = new Date(Date.now() - i * 864e5), f = 1 - i * 0.0006 + Math.sin(i / 2.5) * 0.004;
    D.daily.push({ d: ymdL(t), a: Object.fromEntries(D.assets.map((as, k) => [as.id, [+(as.price * (1 - i * 0.0012 * ((k % 3) - 1) + Math.sin(i / 2 + k) * 0.012)).toFixed(2), as.qty]])), v: T * f, g: 7.26, u: 5.43, c: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v * f])), n: { brl: n.brl * f, gbp: n.gbp * f, usd: n.usd * f } }); }
  const dm = (k) => ym() + '-' + String(k).padStart(2, '0');
  D.divLog = [{ id: uid(), type: 'fii', cur: 'BRL', amount: 132.0, date: dm(5), ticker: 'HGLG11' }, { id: uid(), type: 'fii', cur: 'BRL', amount: 165.0, date: dm(8), ticker: 'MXRF11' }, { id: uid(), type: 'acoes', cur: 'BRL', amount: 48.6, date: dm(10), ticker: 'BBSE3' }, { id: uid(), type: 'reits', cur: 'GBP', amount: 0.74, date: dm(12), ticker: 'O', g: 7.26 }];
  D.apLog = [{ id: uid(), gbp: 1000, dest: 'gbp', date: dm(5), g: 7.24, note: 'exemplo' }];
  D.draft = { month: ym(), divFII: null, divAcoes: null, divStocks: null, aporteGBP: null }; DB = null;
  return D;
}
$('#w-import').onclick = () => pickImport(true);

const PRICE_EVERY = 5 * 60 * 1000;   // while the app is open: shares every 5 min (Finnhub is real-time), the Google Sheet every 15
function maybeRefreshPrices() {
  const age = DB?.prices.updatedAt ? Date.now() - new Date(DB.prices.updatedAt) : Infinity;
  if (DB && age > PRICE_EVERY && !maybeRefreshPrices.wait) { maybeRefreshPrices.wait = true; RETRY.n = 0; setTimeout(() => { maybeRefreshPrices.wait = false; if (DB) refreshPrices(true); }, 1500); }
}
setInterval(() => { if (DB && !document.hidden) maybeRefreshPrices(); }, 60 * 1000);
// ---- dividends as they arrive: each payment is logged; the month's totals are the sum of its payments
const DTYPES = {
  fii: { n: 'FIIs', f: 'divFII', cur: 'BRL', cls: 'fiis' }, acoes: { n: 'Ações', f: 'divAcoes', cur: 'BRL', cls: 'acoes' },
  stocks: { n: 'Stocks', f: 'divStocks', cur: 'GBP', cls: 'stocks', kinds: ['Stock', 'ETF'] }, reits: { n: 'REITs', f: 'divStocks', cur: 'GBP', cls: 'stocks', kinds: ['REIT'] },
};
const DIV_FIELDS = ['divFII', 'divAcoes', 'divStocks'];
function divInField(e, field) {   // FIIs/Ações in R$, Stocks+REITs in £ (as the monthly fields have always been)
  const pr = DB.prices, g = e.g || pr.gbpbrl || 1, rate = { BRL: 1, GBP: g, USD: e.u || pr.usdbrl || 1, EUR: e.e || pr.eurbrl || 1 }[e.cur] || 1;
  const brlV = e.amount * rate; return field === 'divStocks' ? brlV / g : brlV;
}
function divSums(month) {
  const out = {}, L = (DB.divLog || []).filter((e) => e.date.slice(0, 7) === month);
  for (const e of L) { const f = DTYPES[e.type].f; out[f] = (out[f] || 0) + divInField(e, f); }
  for (const f of DIV_FIELDS) if (f in out) out[f] = Math.round(out[f] * 100) / 100;
  return out;
}
function applyDivLog(month) {
  const sums = divSums(month), h = DB.history.find((x) => x.month === month);
  for (const f of DIV_FIELDS) {
    const logged = (DB.divLog || []).some((e) => e.date.slice(0, 7) === month && DTYPES[e.type].f === f);
    if (!logged) continue;
    if (DB.draft.month === month) DB.draft[f] = sums[f];
    if (h) h[f] = sums[f];
  }
}
const lastDiv = () => [...(DB.divLog || [])].sort((a, b) => (a.at || a.date).localeCompare(b.at || b.date)).pop() || null;
const divLabel = (e) => (e.cur === 'GBP' ? gbp(e.amount, 2) : e.cur === 'USD' ? usd(e.amount, 2) : e.cur === 'EUR' ? '€ ' + nf2.format(e.amount) : brl(e.amount, 2));
const dmy = (d) => new Date(d + 'T12:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
function editDiv(id) {
  const x = id ? DB.divLog.find((e) => e.id === id) : { id: uid(), type: 'fii', cur: 'BRL', amount: null, date: today(), ticker: '' };
  const tickers = (t) => { const D = DTYPES[t]; return [...new Set((DB.assets || []).filter((a) => a.cls === D.cls && (!D.kinds || D.kinds.includes(a.kind || 'Stock'))).map((a) => a.ticker))].sort(); };
  openSheet(`<h3>${id ? 'Editar dividendo' : 'Recebi dividendos'}</h3>
    <div class="field"><label>Tipo</label><select id="dv-t">${Object.entries(DTYPES).map(([k, v]) => `<option value="${k}" ${x.type === k ? 'selected' : ''}>${v.n}</option>`).join('')}</select></div>
    <div class="field"><label>Moeda</label><select id="dv-c">${[['BRL', 'R$'], ['GBP', '£'], ['USD', 'US$'], ['EUR', '€']].map(([v, l]) => `<option value="${v}" ${x.cur === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="field"><label>Valor recebido</label><input id="dv-a" class="pt" inputmode="decimal" value="${fmtN(x.amount, 2)}"></div>
    <div class="field"><label>Data</label><input type="date" id="dv-d" value="${x.date}"></div>
    <div class="tk-field"><label>Ticker <small>opcional — comece a digitar</small></label>
      <input id="dv-k" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" value="${esc(x.ticker || '')}" placeholder="ex.: HGLG11">
      <div class="tk-dd hidden" id="dv-sug"></div></div>
    ${placeSelect('dv-pl', id ? x.to || '' : (DB.settings.lastTo || {}).div || '', 'Onde caiu')}
    <button class="btn primary block" id="dv-save">Salvar</button>
    ${id ? '<button class="btn danger block" id="dv-del">Apagar</button>' : ''}
    <button class="btn block" onclick="closeSheet()">Cancelar</button>`, (el) => {
    $$('input.pt', el).forEach(liveFormat);
    // dropdown under the box: only while typing, at most 5 of your own tickers of this type
    const dd = $('#dv-sug', el), box = $('#dv-k', el);
    const fill = () => {
      const q = box.value.trim().toUpperCase(), all = tickers($('#dv-t', el).value);
      if (!q || document.activeElement !== box) { dd.classList.add('hidden'); return; }
      const L = [...all.filter((t) => t.startsWith(q)), ...all.filter((t) => !t.startsWith(q) && t.includes(q))];
      if (L.length === 1 && L[0] === q) { dd.classList.add('hidden'); return; }
      dd.innerHTML = L.length ? L.slice(0, 5).map((t) => `<button type="button" data-tk="${t}"><b>${t.slice(0, t.indexOf(q))}<u>${q}</u>${t.slice(t.indexOf(q) + q.length)}</b><span>${DTYPES[$('#dv-t', el).value].n}</span></button>`).join('')
        : '<div class="tk-none">Nenhum ativo seu com esse nome — pode salvar assim mesmo</div>';
      dd.classList.remove('hidden');
      $$('[data-tk]', dd).forEach((b) => {   // keep the keyboard open while tapping, choose on the finished tap (so nothing underneath gets it)
        b.onpointerdown = (e) => e.preventDefault();
        b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); box.value = b.dataset.tk; dd.classList.add('hidden'); box.blur(); };
      });
    };
    box.addEventListener('input', fill); box.addEventListener('focus', fill); box.addEventListener('blur', () => setTimeout(() => dd.classList.add('hidden'), 250));
    $('#dv-t', el).onchange = () => { $('#dv-c', el).value = DTYPES[$('#dv-t', el).value].cur; fill(); }; fill();
    if (!id) setTimeout(() => $('#dv-a', el).focus(), 250);
    $('#dv-save', el).onclick = async () => {
      const o = { ...x, type: $('#dv-t', el).value, cur: $('#dv-c', el).value, amount: parsePT($('#dv-a', el).value), date: $('#dv-d', el).value || today(),
        ticker: $('#dv-k', el).value.trim().toUpperCase(), at: new Date().toISOString(), g: DB.prices.gbpbrl, u: DB.prices.usdbrl, e: DB.prices.eurbrl };
      if (!o.amount) return toast('Digite o valor');
      const pl = $('#dv-pl', el).value; o.to = pl || undefined; o.toAmt = pl ? toPlace(o.amount, o.cur, pl, o) : undefined;
      const m = o.date.slice(0, 7), f = DTYPES[o.type].f;
      const firstOfMonth = !(DB.divLog || []).some((e) => e.id !== o.id && e.date.slice(0, 7) === m && DTYPES[e.type].f === f);
      const typed = DB.draft.month === m ? DB.draft[f] : DB.history.find((h) => h.month === m)?.[f];
      if (firstOfMonth && typed) {   // keep what was typed by hand before switching this month to logged payments
        const keep = await ask(`${ymLong(m)} já tem ${f === 'divStocks' ? gbp(typed, 2) : brl(typed, 2)} de dividendos ${f === 'divStocks' ? 'Stocks/REITs' : DTYPES[o.type].n} digitados à mão.\n\nGuardar esse valor como um lançamento (para não perder) e somar o novo?`);
        if (keep) DB.divLog.push({ id: uid(), type: f === 'divStocks' ? 'stocks' : o.type, cur: f === 'divStocks' ? 'GBP' : 'BRL', amount: typed, date: m + '-01', ticker: '', note: 'digitado antes', at: new Date(0).toISOString(), g: DB.prices.gbpbrl });
      }
      const old = DB.divLog.find((e) => e.id === o.id)?.date.slice(0, 7);
      const i = DB.divLog.findIndex((e) => e.id === o.id); if (i > -1) placeApply(DB.divLog[i], -1); placeApply(o, 1); (DB.settings.lastTo ||= {}).div = o.to || '';
      if (i > -1) DB.divLog[i] = o; else DB.divLog.push(o);
      applyDivLog(m); if (old && old !== m) applyDivLog(old);
      await save(); closeSheet(); render(); fillMissingFx(); doneTick(); toast(`✓ ${divLabel(o)}${o.ticker ? ' · ' + o.ticker : ''} em ${ymLong(m)}${placeTxt(o)}`);
    };
    if (id) $('#dv-del', el).onclick = async () => {
      if (!(await ask('Apagar este dividendo?', { yes: 'Sim, apagar', danger: true }))) return;
      const m = x.date.slice(0, 7), f = DTYPES[x.type].f; placeApply(x, -1); DB.divLog = DB.divLog.filter((e) => e.id !== id);
      const still = DB.divLog.some((e) => e.date.slice(0, 7) === m && DTYPES[e.type].f === f);
      if (!still) { if (DB.draft.month === m) DB.draft[f] = null; const h = DB.history.find((q) => q.month === m); if (h) h[f] = null; } else applyDivLog(m);
      await save(); closeSheet(); render();
    };
  });
}
function divLogList(limit) {
  const L = [...(DB.divLog || [])].sort((a, b) => b.date.localeCompare(a.date) || (b.at || '').localeCompare(a.at || '')).slice(0, limit);
  return L.length ? L.map((e) => `<div class="item click" data-div="${e.id}"><div><div class="t">${DTYPES[e.type].n}${e.ticker ? ' · ' + esc(e.ticker) : ''}</div><div class="s">${new Date(e.date + 'T12:00').toLocaleDateString('pt-BR')}${e.note ? ' · ' + esc(e.note) : ''}</div></div><div class="r"><div class="t">${divLabel(e)}</div>${e.cur !== 'BRL' ? `<div class="s">${brl(divInField(e, 'divFII'), 2)}</div>` : ''}</div></div>`).join('')
    : '<p class="muted small">Nenhum dividendo lançado ainda.</p>';
}
const wireDivList = () => $$('#view [data-div]').forEach((el) => (el.onclick = () => editDiv(el.dataset.div)));

// ---- aportes with their date: the month's aporte is the sum; daily returns use the exact day the money arrived
const apBRL = (e) => (typeof e.brl === 'number' ? e.brl : e.gbp * (e.g || DB.prices.gbpbrl || 0));   // typed in R$ → exact R$
// ---- base currency: every return is measured in it (Ajustes). R$ by default; £ for someone whose life is in the UK.
// Amounts on screen still follow ⇄; only percentages and results depend on the base. Exchange rate always included.
const BASE = () => (DB?.settings?.base === 'GBP' ? 'GBP' : 'BRL');
const BSYM = () => (BASE() === 'GBP' ? '£' : 'R$');
const inB = (vBRL, g) => (BASE() === 'GBP' ? vBRL / (num(g) || num(DB.prices.gbpbrl) || 1) : vBRL);   // R$ at that day's rate → base
const fromB = (vB) => (BASE() === 'GBP' ? vB * num(DB.prices.gbpbrl) : vB);                            // base → R$ at today's rate (for ⇄ display)
const apB = (e) => (BASE() === 'GBP' ? num(e.gbp) : apBRL(e));
const apMonthB = (m, fx, gbpTot) => (BASE() === 'GBP' ? num(gbpTot) : apMonthBRL(m, fx, gbpTot));
// a month's aportes in R$: each logged entry at the rate of its own day (typed in R$ = exact); only a monthly total typed by hand, with no entries behind it, uses the month's rate
const apMonthBRL = (m, fx, gbpTot) => { const L = (DB.apLog || []).filter((e) => e.date.slice(0, 7) === m);
  return L.reduce((t, e) => t + apBRL(e), 0) + (num(gbpTot) - L.reduce((t, e) => t + num(e.gbp), 0)) * num(fx); };
const apTxt = (e) => (typeof e.brl === 'number' ? brl(Math.abs(e.brl)) : gbp(Math.abs(e.gbp), 2));
function apSum(month) { const L = (DB.apLog || []).filter((e) => e.date.slice(0, 7) === month); return L.length ? Math.round(L.reduce((a, e) => a + e.gbp, 0) * 100) / 100 : null; }
function applyApLog(month) {
  const v = apSum(month); if (v === null) return;
  if (DB.draft.month === month) DB.draft.aporteGBP = v;
  const h = DB.history.find((x) => x.month === month); if (h) h.aporteGBP = v;
}
const lastAp = () => [...(DB.apLog || [])].sort((a, b) => (a.at || a.date).localeCompare(b.at || b.date)).pop() || null;
function editAp(id) {
  const x = id ? DB.apLog.find((e) => e.id === id) : { id: uid(), gbp: null, date: today(), note: '' };
  let out = num(x.gbp) < 0;
  openSheet(`<h3 id="ap-h">${id ? (out ? 'Editar retirada' : 'Editar aporte') : 'Fiz um aporte'}</h3>
    <div class="seg ap-seg" style="margin:4px 0 10px"><button data-k="in" class="${out ? '' : 'on'}">Aporte</button><button data-k="out" class="${out ? 'on' : ''}">Retirada</button><button data-k="mv">Mover</button></div>
    <div class="small muted" style="margin-bottom:8px" id="ap-hint"></div>
    <div class="field"><label id="ap-v-l">Valor (£)</label><input id="ap-v" class="pt" inputmode="decimal" value="${x.gbp === null || x.gbp === undefined ? '' : fmtN(Math.abs(typeof x.brl === 'number' ? x.brl : x.gbp), 2)}"></div>
    <div class="field"><label>Data</label><input type="date" id="ap-d" value="${x.date}"></div>
    <div class="field"><label><span id="ap-to-l">Para onde foi</span><small id="ap-to-h"></small></label><select id="ap-to">${(() => { const sel = id ? apOptOf(x) : (DB.settings.lastTo || {}).ap2 || 't212cash'; return Object.entries(AP_OPTS).map(([k, v]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${v.n} (${v.cur})</option>`).join(''); })()}</select></div>
    <div id="ap-coinbox" class="hidden">${coinFields('ap', x.opId ? (DB.crypto.log.find((o) => o.id === x.opId) || {}) : {})}</div>
    <div class="field"><label>Nota<small>opcional</small></label><input id="ap-n" value="${esc(x.note || '')}" style="text-align:left" placeholder="ex.: salário"></div>
    <button class="btn primary block" id="ap-save">Salvar</button>
    ${id ? '<button class="btn danger block" id="ap-del">Apagar</button>' : ''}
    <button class="btn block" onclick="closeSheet()">Cancelar</button>`, (el) => {
    $$('input.pt', el).forEach(liveFormat); if (!id) setTimeout(() => $('#ap-v', el).focus(), 250);
    const mode = () => { $$('.ap-seg button', el).forEach((b) => b.classList.toggle('on', (b.dataset.k === 'out') === out));
      $('#ap-hint', el).textContent = out ? 'Dinheiro que você TIROU dos investimentos. Depois atualize o saldo de onde saiu.' : 'Dinheiro NOVO que entrou nos investimentos.';
      $('#ap-to-l', el).textContent = out ? 'De onde saiu' : 'Para onde foi'; if (!id) $('#ap-h', el).textContent = out ? 'Fiz uma retirada' : 'Fiz um aporte';
      const hint = $('#ap-to-h', el); if (hint) hint.textContent = AP_OPTS[$('#ap-to', el).value].to ? (out ? 'sai do saldo sozinho' : 'soma no saldo sozinho') : (out ? '' : 'atualize a quantidade'); };
    $$('.ap-seg button', el).forEach((b) => (b.onclick = () => { if (b.dataset.k === 'mv') return editMove(null, id ? x : null); out = b.dataset.k === 'out'; mode(); curL(); })); mode();
    const curL = () => { $('#ap-v-l', el).textContent = AP_OPTS[$('#ap-to', el).value].dest === 'brl' ? 'Valor (R$)' : 'Valor (£)'; $('#ap-coinbox', el).classList.toggle('hidden', out || $('#ap-to', el).value !== 'cripto'); mode(); };
    $('#ap-to', el).addEventListener('change', curL); curL();
    $('#ap-save', el).onclick = async () => {
      const raw = $('#ap-v', el).value.trim(), neg = out || raw.startsWith('-'), v = parsePT(raw.replace(/^-/, ''));
      if (!v) return toast('Digite o valor');
      const opt = AP_OPTS[$('#ap-to', el).value], inBRL = opt.dest === 'brl', g0 = DB.prices.gbpbrl || 1, sv = neg ? -v : v;
      const o = { ...x, gbp: inBRL ? Math.round((sv / g0) * 100) / 100 : sv, brl: inBRL ? sv : undefined, gFixed: false, date: $('#ap-d', el).value || today(), dest: opt.dest, note: $('#ap-n', el).value.trim(), at: new Date().toISOString(), g: DB.prices.gbpbrl };
      const pl = opt.to; o.to = pl || undefined; o.toAmt = pl ? toPlace(inBRL ? sv : o.gbp, inBRL ? 'BRL' : 'GBP', pl, { g: o.g }) : undefined;
      const cf = !neg && $('#ap-to', el).value === 'cripto' ? readCoin('ap', el) : null; if (cf === false) return;
      o.opId = linkBuy(x.opId, cf, o.date);   // the coins bought with this money go into the crypto log (one step)
      const m = o.date.slice(0, 7), first = !(DB.apLog || []).some((e) => e.id !== o.id && e.date.slice(0, 7) === m);
      const typed = DB.draft.month === m ? DB.draft.aporteGBP : DB.history.find((h) => h.month === m)?.aporteGBP;
      if (first && typed) {
        const keep = await ask(`${ymLong(m)} já tem ${gbp(typed, 2)} de aporte digitado à mão.\n\nGuardar esse valor como um lançamento (para não perder) e somar este?`);
        if (keep) DB.apLog.push({ id: uid(), gbp: typed, date: m + '-01', note: 'digitado antes', at: new Date(0).toISOString(), g: DB.history.find((h) => h.month === m)?.fx || DB.prices.gbpbrl });
      }
      const old = DB.apLog.find((e) => e.id === o.id)?.date.slice(0, 7);
      const i = DB.apLog.findIndex((e) => e.id === o.id); if (i > -1) placeApply(DB.apLog[i], -1); placeApply(o, 1); (DB.settings.lastTo ||= {}).ap2 = $('#ap-to', el).value;
      if (i > -1) DB.apLog[i] = o; else DB.apLog.push(o);
      applyApLog(m); if (old && old !== m) { if (apSum(old) === null) { if (DB.draft.month === old) DB.draft.aporteGBP = null; const h = DB.history.find((q) => q.month === old); if (h) h.aporteGBP = null; } else applyApLog(old); }
      await save(); closeSheet(); render(); fillMissingFx();
      doneTick(); toast(o.to ? `✓ ${o.gbp < 0 ? 'Retirada' : 'Aporte'} de ${apTxt(o)}${placeTxt(o)}` : `✓ ${o.gbp < 0 ? 'Retirada' : 'Aporte'} de ${apTxt(o)} em ${new Date(o.date + 'T12:00').toLocaleDateString('pt-BR')} — atualize hoje os saldos/quantidades que mudaram`, 5000);
    };
    if (id) $('#ap-del', el).onclick = async () => { if (await delAp(id)) { closeSheet(); render(); } };
  });
}
async function delAp(id) {
  const x = DB.apLog.find((e) => e.id === id); if (!x) return false;
  if (!(await ask(`Apagar ${x.gbp < 0 ? 'esta retirada' : 'este aporte'} de ${apTxt(x)} (${new Date(x.date + 'T12:00').toLocaleDateString('pt-BR')})?`, { yes: 'Sim, apagar', danger: true }))) return false;
  const m = x.date.slice(0, 7); placeApply(x, -1); linkBuy(x.opId, null); DB.apLog = DB.apLog.filter((e) => e.id !== id);
  if (apSum(m) === null) { if (DB.draft.month === m) DB.draft.aporteGBP = 0; const h = DB.history.find((q) => q.month === m); if (h) h.aporteGBP = 0; } else applyApLog(m);   // no entries left = £0 that month
  await save(); return true;
}
// coin details (crypto bought with this money): optional — blank = nothing logged in the crypto register
function coinFields(px, o = {}) {
  const c = DB.crypto;
  return `<div class="small muted" style="margin:2px 0 6px">Compra de cripto <small>(deixe em branco se já lançou em Cripto)</small></div>
    ${c.people.length > 1 ? `<div class="field"><label>Quem</label><select id="${px}-who">${c.people.map((w) => `<option ${w === (o.name || c.people[0]) ? 'selected' : ''}>${esc(w)}</option>`).join('')}</select></div>` : ''}
    <div class="field"><label>Moeda</label><select id="${px}-coin">${COINS.map((co) => `<option ${co.k === (o.coin || 'BTC') ? 'selected' : ''}>${co.k}</option>`).join('')}</select></div>
    <div class="field"><label>Quantidade</label><input id="${px}-qty" class="pt" inputmode="decimal" value="${o.qty ? fmtN(o.qty, 8) : ''}"></div>
    <div class="field"><label>Valor pago (US$)<small>com taxas</small></label><input id="${px}-usd" class="pt" inputmode="decimal" value="${o.value ? fmtN(o.value, 2) : ''}"></div>`;
}
function readCoin(px, el) {   // null = nothing to log · false = half filled (toast shown)
  const q = parsePT($(`#${px}-qty`, el)?.value || ''), u = parsePT($(`#${px}-usd`, el)?.value || '');
  if (!q && !u) return null; if (!q || !u) { toast('Para lançar a compra, preencha quantidade e valor pago (ou deixe os dois em branco)'); return false; }
  return { name: $(`#${px}-who`, el)?.value || DB.crypto.people[0], coin: $(`#${px}-coin`, el).value, qty: q, value: u, price: u / q };
}
function linkBuy(opId, cf, date) {   // create / update / remove the Buy row tied to an aporte or a move
  const c = DB.crypto; c.log = c.log.filter((o) => o.id !== opId);
  if (!cf) return undefined; const id = opId || uid();
  c.log.push({ id, date, op: 'Buy', ...cf }); c.log.sort((a, b) => (a.date || '').localeCompare(b.date || '')); return id;
}
// ---- moving money between your own accounts: balances change, results don't (not an aporte, not a retirada)
const MV_FROM = { t212cash: 'T212 caixa', caixa: 'Caixa', rfBrasil: 'Renda fixa' };
const MV_TO = { ...MV_FROM, cripto: 'Cripto' };
function mvApply(e, sign) {
  const b = DB.balances, at = new Date().toISOString(); (DB.settings.balAt ||= {});
  if (PLACES[e.from]) { b[e.from] = Math.round((num(b[e.from]) - sign * num(e.amt)) * 100) / 100; DB.settings.balAt[e.from] = at; }
  if (PLACES[e.to] && e.toAmt) { b[e.to] = Math.round((num(b[e.to]) + sign * num(e.toAmt)) * 100) / 100; DB.settings.balAt[e.to] = at; }
}
const mvTxt = (e) => `${PLACES[e.from]?.cur === 'GBP' ? gbp(e.amt, 2) : brl(e.amt, 2)} · ${MV_FROM[e.from] || e.from} → ${MV_TO[e.to] || e.to}`;
function editMove(id, fromAp) {   // fromAp: an aporte/retirada being turned into a move (keeps its date, amount and note)
  const x = id ? (DB.mvLog || []).find((e) => e.id === id) : { id: uid(), date: fromAp?.date || today(), from: fromAp && fromAp.gbp < 0 && MV_FROM[fromAp.to] ? fromAp.to : 't212cash', amt: fromAp ? Math.abs(typeof fromAp.brl === 'number' ? fromAp.brl : fromAp.gbp) : null, to: 'cripto', note: fromAp?.note || '' };
  const op = x.opId ? DB.crypto.log.find((o) => o.id === x.opId) || {} : {};
  openSheet(`<h3>${id ? 'Editar movimentação' : 'Mover entre contas'}</h3>
    <div class="small muted" style="margin:-2px 0 10px">Dinheiro que mudou de lugar entre suas contas. Não é aporte nem retirada: os saldos mudam, seus resultados não.${fromAp ? '<br><b>Este lançamento vai virar uma movimentação.</b>' : ''}</div>
    <div class="field"><label>De</label><select id="mv-from">${Object.entries(MV_FROM).map(([k, n]) => `<option value="${k}" ${k === x.from ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    <div class="field"><label id="mv-v-l">Valor</label><input id="mv-v" class="pt" inputmode="decimal" value="${x.amt ? fmtN(x.amt, 2) : ''}"></div>
    <div class="field"><label>Para</label><select id="mv-to">${Object.entries(MV_TO).map(([k, n]) => `<option value="${k}" ${k === x.to ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    <div class="field hidden" id="mv-in-f"><label id="mv-in-l">Chegou</label><input id="mv-in" class="pt" inputmode="decimal" value="${x.toAmt ? fmtN(x.toAmt, 2) : ''}"></div>
    <div id="mv-coinbox" class="hidden">${coinFields('mv', op)}</div>
    <div class="field"><label>Data</label><input type="date" id="mv-d" value="${x.date}"></div>
    <div class="field"><label>Nota<small>opcional</small></label><input id="mv-n" value="${esc(x.note || '')}" style="text-align:left" placeholder="ex.: comprar bitcoin"></div>
    <button class="btn primary block" id="mv-save">Salvar</button>
    ${id ? '<button class="btn danger block" id="mv-del">Apagar</button>' : ''}
    <button class="btn block" onclick="closeSheet()">Cancelar</button>`, (el) => {
    $$('input.pt', el).forEach(liveFormat);
    const sym = (k) => (PLACES[k]?.cur === 'GBP' ? '£' : 'R$');
    let typedIn = !!x.toAmt; $('#mv-in', el).addEventListener('input', () => (typedIn = true));
    const sync = () => { const f = $('#mv-from', el).value, t = $('#mv-to', el).value, v = parsePT($('#mv-v', el).value);
      $('#mv-v-l', el).textContent = `Valor (${sym(f)})`; $('#mv-coinbox', el).classList.toggle('hidden', t !== 'cripto');
      const cross = PLACES[t] && PLACES[t].cur !== PLACES[f].cur; $('#mv-in-f', el).classList.toggle('hidden', !cross);
      if (cross) { $('#mv-in-l', el).textContent = `Chegou (${sym(t)})`; if (!typedIn && v) $('#mv-in', el).value = fmtN(toPlace(v, PLACES[f].cur, t, { g: DB.prices.gbpbrl }), 2); } };
    ['#mv-from', '#mv-to'].forEach((k) => ($(k, el).onchange = sync)); $('#mv-v', el).addEventListener('input', sync); sync();
    $('#mv-save', el).onclick = async () => {
      const f = $('#mv-from', el).value, t = $('#mv-to', el).value, v = parsePT($('#mv-v', el).value);
      if (!v) return toast('Digite o valor'); if (f === t) return toast('Escolha contas diferentes');
      const cf = t === 'cripto' ? readCoin('mv', el) : null; if (cf === false) return;
      const toAmt = PLACES[t] ? (PLACES[t].cur === PLACES[f].cur ? v : parsePT($('#mv-in', el).value) || toPlace(v, PLACES[f].cur, t, { g: DB.prices.gbpbrl })) : 0;
      const o = { id: x.id, date: $('#mv-d', el).value || today(), from: f, amt: v, to: t, toAmt, note: $('#mv-n', el).value.trim(), at: new Date().toISOString() };
      DB.mvLog ||= []; const i = DB.mvLog.findIndex((e) => e.id === o.id); if (i > -1) mvApply(DB.mvLog[i], -1);
      o.opId = linkBuy(x.opId, cf, o.date);
      if (fromAp) {   // the old aporte/retirada stops counting as new money; its balance change is undone and replaced by this move
        placeApply(fromAp, -1); linkBuy(fromAp.opId, null); DB.apLog = DB.apLog.filter((e) => e.id !== fromAp.id); const m = fromAp.date.slice(0, 7);
        if (apSum(m) === null) { if (DB.draft.month === m) DB.draft.aporteGBP = 0; const h = DB.history.find((q) => q.month === m); if (h) h.aporteGBP = 0; } else applyApLog(m);
      }
      mvApply(o, 1); if (i > -1) DB.mvLog[i] = o; else DB.mvLog.push(o);
      await save(); closeSheet(); render(); doneTick(); toast(`✓ Movido: ${mvTxt(o)}${o.opId ? ' · compra lançada em Cripto' : ''}`, 5000);
    };
    if (id) $('#mv-del', el).onclick = async () => { if (!(await ask('Apagar esta movimentação? Os saldos voltam ao que eram.', { yes: 'Sim, apagar', danger: true }))) return;
      mvApply(x, -1); linkBuy(x.opId, null); DB.mvLog = DB.mvLog.filter((e) => e.id !== id); await save(); closeSheet(); render(); };
  });
}
function openApList() {
  const MV = [...(DB.mvLog || [])].sort((a, b) => b.date.localeCompare(a.date));
  openSheet(`<h3>Aportes e retiradas</h3><div class="small muted" style="margin-bottom:6px">Toque para editar · × para apagar</div>${apList()}
    ${MV.length ? `<div class="ps-h">Movimentações entre contas</div>${MV.map((e) => `<div class="item click" data-mv="${e.id}"><div><div class="t">${new Date(e.date + 'T12:00').toLocaleDateString('pt-BR')}</div><div class="s">${e.note ? esc(e.note) + ' · ' : ''}${MV_FROM[e.from]} → ${MV_TO[e.to]}</div></div><div class="r"><div class="t">↔ ${PLACES[e.from]?.cur === 'GBP' ? gbp(e.amt, 2) : brl(e.amt, 2)}</div></div></div>`).join('')}` : ''}
    <button class="btn block" onclick="closeSheet()" style="margin-top:10px">Fechar</button>`, (el) => {
    $$('[data-ap]', el).forEach((x) => (x.onclick = () => editAp(x.dataset.ap)));
    $$('[data-mv]', el).forEach((x) => (x.onclick = () => editMove(x.dataset.mv)));
    $$('[data-apx]', el).forEach((b) => (b.onclick = async (e) => { e.stopPropagation(); if (await delAp(b.dataset.apx)) { render(); openApList(); } }));
  });
}
function apList() {
  const L = [...(DB.apLog || [])].sort((a, b) => b.date.localeCompare(a.date));
  return L.length ? L.map((e) => `<div class="item click" data-ap="${e.id}"><div><div class="t">${new Date(e.date + 'T12:00').toLocaleDateString('pt-BR')}</div><div class="s">${e.note ? esc(e.note) : e.gbp < 0 ? 'retirada' : 'aporte'} · ${AP_OPTS[apOptOf(e)].n}</div></div><div class="r" style="display:flex;align-items:center;gap:10px"><div>${typeof e.brl === 'number' ? `<div class="t ${e.gbp < 0 ? 'neg' : ''}">${brl(e.brl)}</div><div class="s">${gbp(e.gbp, 2)}</div>` : `<div class="t ${e.gbp < 0 ? 'neg' : ''}">${gbp(e.gbp, 2)}</div><div class="s">${brl(apBRL(e))}</div>`}</div><button class="apx" data-apx="${e.id}" aria-label="Apagar">×</button></div></div>`).join('') : '<p class="muted small">Nenhum aporte lançado ainda.</p>';
}
// daily chained return for a month: needs a snapshot from the last days of the month before
function dailyMonth(month) {
  const D = DB.daily || [], start = month + '-01', base = [...D].filter((x) => x.d < start).pop();
  if (!base || (new Date(start) - new Date(base.d)) / 864e5 > 7) return null;
  const pts = [base, ...D.filter((x) => x.d.slice(0, 7) === month)]; if (pts.length < 2) return null;
  let f = 1, gain = 0, cfT = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], cf = (DB.apLog || []).filter((e) => e.date > a.d && e.date <= b.d).reduce((s2, e) => s2 + apB(e), 0);
    const va = inB(a.v, a.g), vb = inB(b.v, b.g);
    if (va > 0) f *= 1 + (vb - va - cf) / va; gain += vb - va - cf; cfT += cf;
  }
  return { month, r: f - 1, gain, aporte: cfT, daily: true, days: pts.length - 1 };
}

// old months (imported from the spreadsheet) have no GBP/BRL rate: fetch the official rate of the month's last day (ECB, Frankfurter)
async function fxOn(date) {   // official GBP/BRL of a past day (ECB via Frankfurter)
  for (const u of ['https://api.frankfurter.dev/v1/' + date + '?base=GBP&symbols=BRL', 'https://api.frankfurter.app/' + date + '?from=GBP&to=BRL']) {
    try { const j = await fetchJSON(u); if (j?.rates?.BRL) return j.rates.BRL; } catch (e) { console.warn('fx hist', u, e); }
  }
  return null;
}
async function fxPair(date, cur) {   // USD/BRL or EUR/BRL of a past day
  for (const u of ['https://api.frankfurter.dev/v1/' + date + '?base=' + cur + '&symbols=BRL', 'https://api.frankfurter.app/' + date + '?from=' + cur + '&to=BRL']) {
    try { const j = await fetchJSON(u); if (j?.rates?.BRL) return j.rates.BRL; } catch (e) { console.warn('fx hist', u, e); }
  }
  return null;
}
async function fillMissingFx() {
  if (PREVIEW) return;
  if (!DB || !navigator.onLine) return; let changed = false;
  for (const h of DB.history) {
    if (h.fx || h.aporteGBP === null || h.aporteGBP === undefined || !num(h.aporteGBP)) continue;
    const [y, m] = h.month.split('-').map(Number), last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const rate = await fxOn(last); if (rate) { h.fx = rate; h.fxAuto = true; changed = true; }
  }
  for (const e of DB.divLog || []) {   // dividends paid in £/US$/€ on a past day get that day's rate
    if (e.cur === 'BRL' || e.gFixed || e.date >= today()) continue;
    const g = await fxOn(e.date); if (g) { const k = e.cur === 'GBP' ? null : await fxPair(e.date, e.cur); e.g = g; if (e.cur === 'USD' && k) e.u = k; if (e.cur === 'EUR' && k) e.e = k; e.gFixed = true; changed = true; }
  }
  for (const e of DB.apLog || []) {   // aportes logged with a past date get that day's rate
    if (e.gFixed || e.date >= today()) continue;
    const rate = await fxOn(e.date); if (rate) { e.g = rate; if (typeof e.brl === 'number') e.gbp = Math.round((e.brl / rate) * 100) / 100; e.gFixed = true; changed = true; }
  }
  for (const h of DB.history.filter((x) => typeof x.pat === 'number' && !x.nat).slice(-4)) {   // recent months: both rates of the month's last day
    if (h.fx && h.usd) continue; const [y, m] = h.month.split('-').map(Number), last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    if (!h.fx) { const g = await fxOn(last); if (g) { h.fx = g; h.fxAuto = true; changed = true; } }
    if (!h.usd) { const u = await fxPair(last, 'USD'); if (u) { h.usd = u; changed = true; } }
  }
  // still missing (offline or service down): use the nearest saved month's rate, so the month can be measured
  for (const h of DB.history) {
    if (h.fx || !num(h.aporteGBP)) continue;
    const near = DB.history.filter((x) => x.fx && Math.abs(ymDiff(x.month, h.month)) <= 2).sort((a, b) => Math.abs(ymDiff(a.month, h.month)) - Math.abs(ymDiff(b.month, h.month)))[0];
    if (near) { h.fx = near.fx; h.fxAuto = 'aprox'; changed = true; }
  }
  if (changed) { await save(); render(); }
}
// ---- daily snapshot: today's patrimônio, saved quietly after prices load (later the same day replaces it)
const today = () => { const t = new Date(); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); };
const CAT_N = { acoes: 'Ações', fiis: 'FIIs', rf: 'Renda fixa', stocks: 'Exterior', crypto: 'Cripto', caixa: 'Caixa' };
// three blocks, each in its own currency: Brazil (R$), Trading 212 (£), Cripto (US$)
const natNow = (P) => { const b = DB.balances, pr = DB.prices, r2 = (v) => Math.round(v * 100) / 100;
  return { brl: r2(P.v.acoes + P.v.fiis + num(b.rfBrasil) + num(b.caixa)), gbp: r2(P.v.stocks / (pr.gbpbrl || 1) + num(b.t212cash)), usd: r2(P.v.crypto / (pr.usdbrl || 1)) }; };
// where a logged aporte / dividend lands: its amount is added to that balance automatically (and taken back if edited or deleted)
const PLACES = { caixa: { n: 'Caixa', cur: 'BRL' }, rfBrasil: { n: 'Renda fixa Brasil', cur: 'BRL' }, t212cash: { n: 'Trading 212 · caixa', cur: 'GBP' } };
const placeSelect = (id, sel, label) => `<div class="field"><label>${label}<small>soma no saldo sozinho</small></label><select id="${id}"><option value="">Não somar (já atualizei / comprei ativos)</option>${Object.entries(PLACES).map(([k, v]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${v.n} (${v.cur === 'GBP' ? '£' : 'R$'})</option>`).join('')}</select></div>`;
function toPlace(amount, cur, place, r) {   // amount in its own currency → the balance's currency, at the rates r = {g, u, e}
  const g = num(r.g || DB.prices.gbpbrl) || 1, brlV = cur === 'BRL' ? amount : cur === 'GBP' ? amount * g : cur === 'USD' ? amount * num(r.u || DB.prices.usdbrl) : amount * num(r.e || DB.prices.eurbrl);
  return Math.round((PLACES[place].cur === 'GBP' ? (cur === 'GBP' ? amount : brlV / g) : brlV) * 100) / 100;
}
function placeApply(e, sign) {   // sign 1 = add, −1 = undo
  if (!e || !e.to || !PLACES[e.to] || !e.toAmt) return; const b = DB.balances;
  b[e.to] = Math.round((num(b[e.to]) + sign * e.toAmt) * 100) / 100; (DB.settings.balAt ||= {})[e.to] = new Date().toISOString();
}
const placeTxt = (e) => (e.to && PLACES[e.to] ? ` · ${e.toAmt < 0 ? 'tirado de' : 'somado em'} ${PLACES[e.to].n}` : '');
// one list for "Para onde foi": each choice sets the currency block and, when it is a cash balance, adds to it automatically
const AP_OPTS = {
  t212cash: { n: 'Trading 212 · caixa', cur: '£', dest: 'gbp', to: 't212cash' },
  t212buy: { n: 'Trading 212 · comprei ações', cur: '£', dest: 'gbp', to: '' },
  caixa: { n: 'Caixa', cur: 'R$', dest: 'brl', to: 'caixa' },
  rfBrasil: { n: 'Renda fixa Brasil', cur: 'R$', dest: 'brl', to: 'rfBrasil' },
  brbuy: { n: 'Brasil · comprei ações/FIIs', cur: 'R$', dest: 'brl', to: '' },
  cripto: { n: 'Cripto', cur: '£', dest: 'usd', to: '' },
};
const apOptOf = (e) => (e.to && AP_OPTS[e.to] ? e.to : (e.dest || 'gbp') === 'brl' ? 'brbuy' : e.dest === 'usd' ? 'cripto' : 't212buy');
const BLK = { brl: { n: 'Brasil', cur: 'R$' }, gbp: { n: 'Trading 212', cur: '£' }, usd: { n: 'Cripto', cur: 'US$' } };
const rateOf = (k, g, u) => (k === 'brl' ? 1 : k === 'gbp' ? g : u);
// new money of a period, split by where it went, in each block's own currency
function flowsBetween(d1, d2, mode) {   // mode 'day': (d1, d2]  ·  mode 'month': whole month d1
  const L = (DB.apLog || []).filter((e) => (mode === 'month' ? e.date.slice(0, 7) === d1 : e.date > d1 && e.date <= d2)), f = { brl: 0, gbp: 0, usd: 0 };
  for (const e of L) { const g = e.g || DB.prices.gbpbrl || 1, k = e.dest || 'gbp'; f[k] += k === 'gbp' ? e.gbp : k === 'brl' ? apBRL(e) : (e.gbp * g) / (DB.prices.usdbrl || 1); }
  return { f, any: L.length > 0 };
}
// return without exchange-rate effect for one period: each block in its own currency, weighted by its size at the start
function localPeriod(a, b, f, half) {
  let num_ = 0, den = 0, gainEnd = 0;
  for (const k of Object.keys(BLK)) {
    const Va = num(a.n[k]), Vb = num(b.n[k]), cf = num(f[k]), ra = rateOf(k, a.g || 1, a.u || 1), rb = rateOf(k, b.g || 1, b.u || 1);
    const base = Va + (half ? 0.5 * cf : 0); if (base > 0) { num_ += ((Vb - Va - cf) / base) * base * ra; den += base * ra; }
    gainEnd += (Vb - Va - cf) * rb;   // investment gain valued at today's rates (R$)
  }
  return { r: den ? num_ / den : 0, gainR: gainEnd };
}
// months imported from the spreadsheet have only the total: split it by the currency mix of the nearest daily snapshot, valued at that month's rates
function estNat(pat, g, u, S) {
  if (!S?.n || !(pat > 0) || !g || !u) return null;
  const w = { brl: num(S.n.brl), gbp: num(S.n.gbp) * g, usd: num(S.n.usd) * u }, t = w.brl + w.gbp + w.usd; if (!t) return null;
  return { brl: (pat * w.brl) / t, gbp: (pat * w.gbp) / t / g, usd: (pat * w.usd) / t / u };
}
const chainLocal = (pts, halfFirst) => { let f = 1, gR = 0; for (let i = 1; i < pts.length; i++) { const L = localPeriod(pts[i - 1], pts[i], flowsBetween(pts[i - 1].d, pts[i].d, 'day').f, halfFirst && i === 1); f *= 1 + L.r; gR += L.gainR; } return { r: f - 1, gainR: gR }; };
// return of a month without the exchange rate. now = live point for the current month (or null)
function monthLocal(month, now) {
  const D = (DB.daily || []).filter((x) => x.n && (!now || x.d < today())), start = month + '-01', base = [...D].filter((x) => x.d < start).pop();
  const inM = D.filter((x) => x.d.slice(0, 7) === month), tail = now ? [...inM, now] : inM;
  if (base && (new Date(start) - new Date(base.d)) / 864e5 <= 7 && tail.length) return chainLocal([base, ...tail], false);   // exact: daily chain
  const H = DB.history, a = H.filter((h) => h.month < month && typeof h.pat === 'number').slice(-1)[0];
  if (!a || ymDiff(a.month, month) !== 1) return null;
  const aEnd = a.month + '-31';   // after any day of the month before
  if (a.nat && tail.length) return chainLocal([{ d: aEnd, n: a.nat, g: a.fx, u: a.usd }, ...tail], true);
  if (!a.nat && tail.length) {   // month before has only the total: estimate its split with the first snapshot of this month
    const n = estNat(a.pat, a.fx, a.usd, tail[0]); if (n) return { ...chainLocal([{ d: aEnd, n, g: a.fx, u: a.usd }, ...tail], true), est: true };
  }
  const h = H.find((x) => x.month === month); if (!h || typeof h.pat !== 'number') return null;   // a past month with no snapshots inside
  const S = D.find((x) => x.d > month + '-31' && (new Date(x.d) - new Date(start)) / 864e5 <= 75);
  const nA = a.nat || estNat(a.pat, a.fx, a.usd, S), nH = h.nat || estNat(h.pat, h.fx, h.usd, S); if (!nA || !nH) return null;
  const fl = flowsBetween(month, null, 'month'); let f = fl.f;
  if (!fl.any) { if (h.aporteGBP === null || h.aporteGBP === undefined) return null; f = { brl: 0, gbp: num(h.aporteGBP), usd: 0 }; }   // typed aporte → Trading 212
  const L = localPeriod({ n: nA, g: a.fx, u: a.usd }, { n: nH, g: h.fx, u: h.usd }, f, true); return { r: L.r, gainR: L.gainR, est: !(a.nat && h.nat) };
}
function liveLocal(P) { return monthLocal(ym(), { d: today(), n: natNow(P), g: DB.prices.gbpbrl, u: DB.prices.usdbrl }); }
function localMonth(month) { return monthLocal(month, null); }
const catNow = (P) => { const o = {}; for (const k in P.v) o[k] = Math.round(P.v[k] * 100) / 100; o.caixa = Math.round(num(DB.balances.caixa) * 100) / 100; return o; };
// "where did the growth come from": total change − aportes = real growth; split into dividends + price/FX, and by category when both ends have it
function growthBreak(from, to, apBRLv, divBRL, loc) {
  const chg = to.v - from.v, real = chg - apBRLv, cats = from.c && to.c ? Object.keys(CAT_N).map((k) => ({ k, n: CAT_N[k], d: num(to.c[k]) - num(from.c[k]) })) : null;
  const inv = loc ? loc.gainR : real, fx = loc ? real - loc.gainR : null;   // investment result (no FX) and the exchange-rate part
  return { chg, ap: apBRLv, real, div: divBRL, val: inv - divBRL, fx, rl: loc ? loc.r : null, pct: from.v ? real / (from.v + 0.5 * apBRLv) : 0, cats };
}
function yearTable() {   // one line per year, no-FX return when known
  const R = returnsData(); if (!R.years.length) return '';
  return `<div class="ps-h">Por ano · em ${BSYM()}</div><div class="ps-card">${[...R.years].reverse().map((y) => { const v = y.r;
    return `<div class="ps-step"><span>${y.year}<small> · ${y.n} ${y.n === 1 ? 'mês' : 'meses'}</small></span><b class="${v < 0 ? 'neg' : 'pos'}">${signed(pct, v)}</b></div>`; }).join('')}</div>`;
}
function breakHtml(B, title, sub) {   // plain-language: what changed, how much was new money, what the investments did, and why
  const R = (v) => (Math.abs(v) < 0.5 ? 0 : v), sg = (v) => signed((x) => brl(x), R(v)), cl = (v) => (R(v) < 0 ? 'neg' : R(v) > 0 ? 'pos' : '');
  const why = [['Dividendos', B.div], ...(B.fx !== null ? [['Preços', B.val], ['Câmbio', B.fx]] : [['Preços e câmbio', B.val]])];
  const mx = Math.max(1, ...why.map((w) => Math.abs(w[1])));
  const pc = B.pct;
  return `<div class="ps">
    <div class="ps-top"><div class="ps-sub">${sub}</div><h3>${title}</h3>
      <div class="ps-big ${pc < 0 ? 'neg' : pc > 0 ? 'pos' : ''}">${signed(pct, pc)}</div>
      <div class="ps-sub">os investimentos ${R(B.real) < 0 ? 'perderam' : 'renderam'} <b class="${cl(B.real)}">${brl(Math.abs(R(B.real)))}</b></div></div>
    <div class="ps-card">
      <div class="ps-step"><span>Seu patrimônio ${B.chg < 0 ? 'caiu' : 'subiu'}</span><b>${brl(Math.abs(R(B.chg)))}</b></div>
      ${R(B.ap) ? `<div class="ps-step"><span>${B.ap > 0 ? 'mas foi dinheiro novo (aportes)' : 'e você retirou'}</span><b>${brl(Math.abs(B.ap))}</b></div>` : ''}
      <div class="ps-step ps-res"><span>Resultado dos investimentos</span><b class="${cl(B.real)}">${sg(B.real)}</b></div>
    </div>
    <div class="ps-h">Por quê</div>
    <div class="ps-card">${why.map(([n, v]) => `<div class="ps-why"><span>${n}</span><div class="ps-bar"><i class="${cl(v)}" style="width:${(Math.abs(R(v)) / mx * 100).toFixed(1)}%"></i></div><b class="${cl(v)}">${sg(v)}</b></div>`).join('')}</div>
    ${B.rl !== null && Math.abs(B.pct - B.rl) >= 0.0005 ? `<div class="ps-note">Sem câmbio (como se a libra e o dólar não tivessem mudado): ${signed(pct, B.rl)}.</div>` : ''}
    <button class="btn block" onclick="closeSheet()" style="margin-top:16px">Fechar</button></div>`;
}
async function dailySnap() {
  if (!DB || !DB.prices.updatedAt || Date.now() - new Date(DB.prices.updatedAt) > 2 * 3600 * 1000) return;   // only with fresh prices
  const P = portfolio(); if (!(P.total > 0)) return;
  const e = { d: today(), v: Math.round(P.total * 100) / 100, g: DB.prices.gbpbrl || null, u: DB.prices.usdbrl || null, eu: DB.prices.eurbrl || null, c: catNow(P), n: natNow(P),
    a: Object.fromEntries((DB.assets || []).filter((x) => priceOf(x) > 0).map((x) => [x.id, [priceOf(x), num(x.qty)]])),
    k: Object.fromEntries(P.cs.coins.filter((x) => x.units).map((x) => [x.k, [num(DB.prices[x.k]), x.units]])) };
  const D = (DB.daily ||= []), last = D[D.length - 1];
  if (last && last.d === e.d) D[D.length - 1] = e; else D.push(e);
  const cut = (() => { const t = new Date(Date.now() - 60 * 864e5); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); })();
  for (const x of D) if (x.d < cut && (x.a || x.k)) { delete x.a; delete x.k; }   // older days keep only the totals (all charts and returns use those)
  await save(); autoCloseMonth();
}
// on the 1st (or later), last month is saved from its last daily snapshot, unless you saved it yourself on/after that day
async function autoCloseMonth() {
  if (!DB) return; const m = ymAdd(ym(), -1), D = (DB.daily || []).filter((x) => x.d.slice(0, 7) === m && x.n && x.c), last = D[D.length - 1];
  if (!last) return; const [y, mo] = m.split('-').map(Number), endDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (Number(last.d.slice(8)) < endDay - 3) return;   // no record near the end of the month: leave it to you
  const h = DB.history.find((x) => x.month === m); if (h && h.savedAt && h.savedAt.slice(0, 10) >= last.d) return;
  const src = DB.draft.month === m ? DB.draft : h || {};
  const entry = { month: m, pat: last.v, aporteGBP: src.aporteGBP ?? null, divFII: src.divFII ?? null, divAcoes: src.divAcoes ?? null, divStocks: src.divStocks ?? null, fx: last.g, usd: last.u, cat: last.c, nat: last.n, savedAt: new Date(last.d + 'T22:00:00Z').toISOString(), auto: true };
  if (h?.note) entry.note = h.note;
  const i = DB.history.findIndex((x) => x.month === m); if (i > -1) DB.history[i] = entry; else DB.history.push(entry);
  DB.history.sort((a, b) => a.month.localeCompare(b.month)); applyDivLog(m); applyApLog(m);
  if (DB.draft.month <= m) { DB.draft = { month: ym(), divFII: null, divAcoes: null, divStocks: null, aporteGBP: null }; applyDivLog(ym()); applyApLog(ym()); }
  await save(); render();
  const e2 = DB.history.find((x) => x.month === m);
  toast(`✓ ${ymLong(m)} fechado sozinho com os valores de ${dmy(last.d)}${e2.aporteGBP === null || e2.aporteGBP === undefined ? ' — informe o aporte do mês em Histórico' : ''}`, 6000);
}
async function enterApp() {
  $('#lock').classList.add('hidden'); $('#welcome').classList.add('hidden'); $('#app').classList.remove('hidden');
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  render();
  maybeRefreshPrices();
  setTimeout(() => dailySnap(), 20000);   // fallback if prices were already fresh (no refresh needed)
  setTimeout(() => fillMissingFx(), 4000);
  setTimeout(() => autoCloseMonth(), 3000);
}

/* ---------------- backup ---------------- */
async function exportBackup() {
  openSheet(`<h3>Exportar backup</h3>
    <p class="small">Crie uma senha para o arquivo (mínimo 6 caracteres). Sem ela o arquivo não pode ser aberto — nem por você.</p>
    <div class="field"><label>Senha do backup</label><input id="bk-p1" type="password" autocomplete="new-password" value="${esc(DB.settings.backupPass || '')}"></div>
    <div class="field"><label>Repita a senha</label><input id="bk-p2" type="password" autocomplete="new-password" value="${esc(DB.settings.backupPass || '')}"></div>
    <label class="small" style="display:flex;gap:8px;align-items:center;margin:8px 0"><input type="checkbox" id="bk-rem" ${DB.settings.backupPass ? 'checked' : ''}> Lembrar a senha neste aparelho (fica guardada criptografada)</label>
    <p class="small">O arquivo se chama sempre <b>rumo-backup.json</b>. Salve na mesma pasta do iCloud Drive/OneDrive e escolha <b>Substituir</b> — assim fica só a cópia mais recente.</p>
    <button class="btn primary block" id="bk-go">Criar arquivo</button>
    <button class="btn block" onclick="closeSheet()">Cancelar</button>`, (el) => {
    $('#bk-go', el).onclick = async () => {
      const p1 = $('#bk-p1', el).value, p2 = $('#bk-p2', el).value;
      if (p1.length < 6) return toast('A senha precisa ter pelo menos 6 caracteres');
      if (p1 !== p2) return toast('As senhas não batem');
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const box = await encryptObj(DB, await deriveKey(p1, salt));
      const file = JSON.stringify({ app: APP_ID, format: 1, encrypted: true, salt: b64(salt), ...box, createdAt: new Date().toISOString() });
      const name = 'rumo-backup.json';
      if ($('#bk-rem', el)?.checked) DB.settings.backupPass = p1; else delete DB.settings.backupPass;
      const blob = new Blob([file], { type: 'application/json' });
      const f = new File([blob], name, { type: 'application/json' });
      try {
        if (navigator.canShare && navigator.canShare({ files: [f] })) await navigator.share({ files: [f], title: name });
        else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
        DB.settings.lastBackup = new Date().toISOString(); await save(); closeSheet(); render(); toast('Backup criado — salve em Arquivos (iCloud Drive ou OneDrive)');
      } catch (e) { if (e.name !== 'AbortError') toast('Não foi possível salvar o arquivo'); }
    };
  });
}
async function pickImport(fromWelcome) {
  const inp = $('#file-in'); inp.value = '';
  inp.onchange = async () => {
    const file = inp.files[0]; if (!file) return;
    let obj; try { obj = JSON.parse(await file.text()); } catch { return toast('Arquivo inválido'); }
    if (obj.app !== APP_ID) return toast('Este arquivo não é um backup do Rumo ao Milhão');
    const finish = async (data) => {
      DB = normalize(data); await save(); closeSheet();
      if (fromWelcome) enterApp(); else render();
      toast(`Importado: ${DB.history.length} meses, ${DB.crypto.log.length} operações de cripto`);
    };
    if (!obj.encrypted) return finish(obj.data);
    openSheet(`<h3>Senha do backup</h3><div class="field"><label>Senha</label><input id="im-p" type="password"></div>
      <button class="btn primary block" id="im-go">Importar</button><button class="btn block" onclick="closeSheet()">Cancelar</button>`, (el) => {
      $('#im-go', el).onclick = async () => {
        try { const data = await decryptObj(obj, await deriveKey($('#im-p', el).value, unb64(obj.salt))); await finish(data); }
        catch { toast('Senha incorreta'); }
      };
    });
  };
  if (!fromWelcome && !(await ask('Importar um backup substitui TODOS os dados atuais deste aparelho. Continuar?'))) return;
  inp.click();
}

/* ---------------- Ativos: holdings with live prices ---------------- */
const ACLS = [
  { k: 'acoes', n: 'Ações', market: 'B3' },
  { k: 'fiis', n: 'FIIs', market: 'GS' },
  { k: 'stocks', n: 'Exterior', market: 'US' },
];
const FXOF = (cur) => (cur === 'BRL' ? 1 : cur === 'USD' ? num(DB.prices.usdbrl) : cur === 'GBP' ? num(DB.prices.gbpbrl) : cur === 'GBX' ? num(DB.prices.gbpbrl) / 100 : cur === 'EUR' ? num(DB.prices.eurbrl) : 1);
const curOf = (a) => (a.market === 'B3' ? 'BRL' : a.market === 'GS' ? a.currency || 'BRL' : a.market === 'US' ? 'USD' : a.currency || 'BRL');
const priceOf = (a) => (a.market === 'MANUAL' ? num(a.manualPrice) : (typeof a.price === 'number' && a.price > 0 ? a.price : num(a.manualPrice)));
const STALE_MS = 4 * 864e5;
function assetRows(cls) {
  return (DB.assets || []).filter((a) => !cls || a.cls === cls).map((a) => {
    const cur = curOf(a), fx = FXOF(cur), pr = priceOf(a), value = num(a.qty) * pr * fx;
    const avgFx = a.avgCur === 'GBP' ? FXOF('GBP') : fx;   // "€93,01 (£80,34)" → £80,34 compares what you paid in £ with today's value in £
    const cost = a.avg ? num(a.qty) * num(a.avg) * avgFx : null;
    const auto = a.market !== 'MANUAL';
    const stale = auto && (!a.priceAt || Date.now() - new Date(a.priceAt) > STALE_MS || !!a.priceErr);
    return { a, cur, fx, pr, value, cost, pl: cost !== null ? value - cost : null, plPct: cost ? (value - cost) / cost : null, auto, stale };
  });
}
const classTotal = (cls) => assetRows(cls).reduce((s, r) => s + r.value, 0);
const curSym = (c) => ({ BRL: 'R$', USD: 'US$', GBP: '£', GBX: 'p', EUR: '€' }[c] || c);
const fmtPx = (c, v) => (c === 'GBX' ? nf2.format(v || 0) + 'p' : curSym(c) + ' ' + nf2.format(v || 0));

async function fetchJSONo(url, opts = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 9000);
  try { const r = await fetch(url, { ...opts, signal: ctl.signal, cache: 'no-store' }); const j = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j?.message || j?.error || r.status); e.status = r.status; throw e; } return j; }
  finally { clearTimeout(t); }
}
const LASTERR = {};
// a few requests at a time: the iPhone queues more than ~6 per site and price APIs refuse bursts
async function pool(items, n, fn) { const q = [...items]; await Promise.all(Array.from({ length: Math.min(n, q.length) }, async () => { while (q.length) await fn(q.shift()); })); }
async function fetchRetry(url, opts) {
  try { return await fetchJSONo(url, opts); }
  catch (e) { if (e.status === 429 || e.name === 'AbortError' || !e.status) { await new Promise((r) => setTimeout(r, 1500)); return fetchJSONo(url, opts); } throw e; }
}
function brapiParse(j) {
  const out = {};
  for (const r of j?.results || []) {
    const sym = String(r.symbol || r.data?.symbol || r.stock || '').toUpperCase();
    const px = r.data?.regularMarketPrice ?? r.regularMarketPrice, pc = r.data?.regularMarketPreviousClose ?? r.regularMarketPreviousClose, tt = r.data?.regularMarketTime ?? r.regularMarketTime;
    if (sym && typeof px === 'number' && px > 0) { out[sym] = px; { const nm = r.data?.longName || r.longName || r.data?.shortName || r.shortName; if (nm) NMQ[sym] = String(nm).trim(); } if (typeof pc === 'number' && pc > 0) PCQ.b[sym] = pc; if (tt) { const d = typeof tt === 'number' ? tradeDay(tt) : ymdL(new Date(tt)); if (d && d !== 'NaN-NaN-NaN') TDQ.b[sym] = d; } }
  }
  return out;
}
// brapi free plan: 15.000 calls/month, 1 ticker per call. Count every call and stop before the limit.
const BRAPI_MONTH = 14000, BRAPI_DAY = 450;
function brapiUse() { const u = (DB.settings.brapiUse ||= {}); const m = ym(), d = today(); if (u.m !== m) { u.m = m; u.n = 0; } if (u.d !== d) { u.d = d; u.dn = 0; } return u; }
function brapiCanCall(k = 1) { const u = brapiUse(); return u.n + k <= BRAPI_MONTH && u.dn + k <= BRAPI_DAY; }
function brapiCount() { const u = brapiUse(); u.n++; u.dn++; }
async function brapiQuotes(syms, key) {
  if (!brapiCanCall(syms.length)) { LASTERR.brapi = `limite de segurança atingido (${brapiUse().n} chamadas este mês) — use Google Sheets para as ações`; return {}; }
  const got = {}, list = syms.join(',');
  const tries = [
    () => { brapiCount(); return fetchJSONo('https://brapi.dev/api/v2/stocks/quote?symbols=' + encodeURIComponent(list), key ? { headers: { Authorization: 'Bearer ' + key } } : {}); },
    () => { brapiCount(); return fetchJSONo('https://brapi.dev/api/quote/' + encodeURIComponent(list) + (key ? '?token=' + encodeURIComponent(key) : '')); },
  ];
  const mode = DB?.settings?.brapiMode;   // remembers what works with your plan, so refused requests aren't repeated
  if (mode !== 'single') for (const [i, t] of tries.entries()) { if (mode === 'v1' && i === 0) continue;
    try { Object.assign(got, brapiParse(await t())); if (syms.every((s) => got[s])) { if (DB) DB.settings.brapiMode = i ? 'v1' : 'v2'; return got; } } catch (e) { console.warn('brapi', e); LASTERR.brapi = e.message; } }
  const single = syms.filter((x) => !got[x]);
  await pool(single, 3, async (s) => {   // free plans allow only one ticker per request
    brapiCount(); try { Object.assign(got, brapiParse(await fetchRetry('https://brapi.dev/api/quote/' + encodeURIComponent(s) + (key ? '?token=' + encodeURIComponent(key) : '')))); } catch (e) { console.warn('brapi one', s, e); LASTERR.brapi = e.message; }
  });
  if (DB && single.length && single.every((x) => got[x]) && !Object.keys(got).some((k) => !single.includes(k))) DB.settings.brapiMode = 'single';
  return got;
}
async function finnhubQuotes(syms, key) {
  const got = {}; if (!key) return got;
  await pool(syms, 4, async (s) => {   // 4 at a time (Finnhub allows ~60/minute, but not big bursts)
    try { const j = await fetchRetry('https://finnhub.io/api/v1/quote?symbol=' + encodeURIComponent(s) + '&token=' + encodeURIComponent(key)); if (j.c > 0) { got[s] = j.c; if (j.pc > 0) PCQ.f[s] = j.pc; if (j.t > 0) TDQ.f[s] = tradeDay(j.t); } else LASTERR.finnhub = 'ticker sem preço (' + s + ')'; } catch (e) { console.warn('finnhub', s, e); LASTERR.finnhub = e.message; }
  });
  return got;
}
// Alpha Vantage: London (.LON, prices in pence) and European exchanges (.DEX, .PAR, .AMS…). End-of-day prices, ~25 requests/day on the free plan.
async function alphaQuotes(syms, key) {
  const got = {}; if (!key) return got;
  for (const s of syms) {
    try {
      const j = await fetchJSONo('https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=' + encodeURIComponent(s) + '&apikey=' + encodeURIComponent(key));
      const px = Number(j?.['Global Quote']?.['05. price']);
      if (px > 0) got[s] = px; else LASTERR.alpha = j?.Information || j?.Note || j?.['Error Message'] || 'ticker sem preço (' + s + ')';
    } catch (e) { console.warn('alpha', s, e); LASTERR.alpha = e.message; }
  }
  return got;
}
// Google Sheets: a sheet in YOUR Google Drive with =GOOGLEFINANCE("BVMF:"&A2) next to each ticker.
// Share it as "anyone with the link can view"; the app reads it as CSV. No key, no daily limit.
function sheetCsvUrl(link) {
  link = String(link || '').trim(); if (!link) return null;
  if (/\/pub\?|output=csv|tqx=out:csv/.test(link)) return link;
  const m = link.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/); if (!m) return null;
  const gid = (link.match(/[#&?]gid=(\d+)/) || [])[1];
  return `https://docs.google.com/spreadsheets/d/${m[1]}/gviz/tq?tqx=out:csv${gid ? '&gid=' + gid : ''}`;
}
function csvRows(t) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; } else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
function sheetNum(v) {
  v = String(v || '').replace(/[R$\s]/g, ''); if (!v || /N\/A|#|ERR/i.test(v)) return null;
  if (v.includes(',') && v.includes('.')) v = v.lastIndexOf(',') > v.lastIndexOf('.') ? v.replace(/\./g, '').replace(',', '.') : v.replace(/,/g, '');
  else v = v.replace(',', '.');
  const n = Number(v); return n > 0 ? n : null;
}
const PCQ = { b: {}, f: {}, s: {} }, NMQ = {};
// "BB SEGURIDADE PARTICIPACOES S.A." → "BB Seguridade Participacoes": short and readable
const tidyName = (n) => { let t = String(n).replace(/\b(S\.?\s?A\.?|S\/A|Inc\.?|Corp\.?|Corporation|PLC|plc|Ltd\.?|N\.?V\.?|SE|ON|PN|UNT|NM|N1|N2|ED|EJ|ADR|Class [A-Z])\b\.?/g, '').replace(/\s{2,}/g, ' ').replace(/[\s,.-]+$/, '').trim();
  if (t === t.toUpperCase()) t = t.split(' ').map((w, i) => (w.length <= 2 && i === 0) || /\d/.test(w) ? w : /^(DE|DO|DA|DOS|DAS|E|OF|AND|THE)$/.test(w) && i ? w.toLowerCase() : w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
  return t.length > 34 ? t.slice(0, 33).trim() + '…' : t; };   // NMQ: company names found by the price sources
const TDQ = { b: {}, f: {}, s: {} }, EXQ = {};   // last trade day per source · exchange prefix from the sheet (LON, EPA…)
// a new price more than 5× away from the last good one is suspicious — unless the previous close agrees with it (e.g. a split)
const far = (a, b) => a > 0 && b > 0 && (a / b > 5 || b / a > 5);
const suspectPx = (a, px, pc) => (num(a.price) > 0 && far(px, num(a.price)) && !(pc > 0 && !far(px, pc) && px / pc < 2 && pc / px < 2)) || (!(num(a.price) > 0) && pc > 0 && far(px, pc));
const ymdL = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
function tradeDay(v) {   // "28/10 13:56", "28/10/2026 13:56:00", "2026-10-28 …", a sheet serial number or a unix time → 'YYYY-MM-DD'
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return ymdL(new Date(v > 1e11 ? v : v > 1e9 ? v * 1000 : Date.UTC(1899, 11, 30) + v * 864e5));
  const t = String(v).trim(); let m = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
  m = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (m) { const now = new Date(), mo = Number(m[2]); let y = m[3] ? Number(m[3].length === 2 ? '20' + m[3] : m[3]) : now.getFullYear(); if (!m[3] && mo > now.getMonth() + 1) y--; return y + '-' + String(mo).padStart(2, '0') + '-' + m[1].padStart(2, '0'); }
  if (/^\d{5}([.,]\d+)?$/.test(t)) return tradeDay(Number(t.replace(',', '.')));
  return null;
}
// has this exchange opened today (by our clock)? used when the source gives no trade time
const EXCH = { LON: ['Europe/London', 8, 0], EPA: ['Europe/Paris', 9, 0], AMS: ['Europe/Paris', 9, 0], EBR: ['Europe/Paris', 9, 0], ETR: ['Europe/Berlin', 9, 0], FRA: ['Europe/Berlin', 9, 0], BVMF: ['America/Sao_Paulo', 10, 0], US: ['America/New_York', 9, 30] };
function exchOpenedToday(ex) {
  const [z, h, mi] = EXCH[ex] || EXCH.BVMF;
  try {
    const f = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: z, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
    if (f.weekday === 'Sat' || f.weekday === 'Sun') return false;
    if (`${f.year}-${f.month}-${f.day}` !== today()) return false;   // over there it's still yesterday
    return Number(f.hour) * 60 + Number(f.minute) >= h * 60 + mi;
  } catch { return true; }
}
const exchOf = (a) => a.exch || (a.market === 'US' ? 'US' : a.market === 'B3' ? 'BVMF' : curOf(a) === 'BRL' ? 'BVMF' : ['GBP', 'GBX'].includes(curOf(a)) ? 'LON' : curOf(a) === 'EUR' ? 'EPA' : 'US');
// counts only if its exchange has opened today AND (when the source says) the last trade was today — a source's clock alone isn't trusted
const tradedToday = (a) => exchOpenedToday(exchOf(a)) && (!a.tradeD || a.tradeD === today());   // previous close per source (brapi, Finnhub, Google Sheet column E)
const FX_SHEET = ['CURRENCY:GBPBRL', 'CURRENCY:USDBRL', 'CURRENCY:EURBRL'];
// the sheet is downloaded once and shared for 60 s (prices + exchange-rate rows use the same copy); waits up to 20 s and tries twice
const SHEETC = { url: null, at: 0, p: null };
function sheetCsv(url) {
  if (SHEETC.p && SHEETC.url === url && Date.now() - SHEETC.at < 60 * 1000) return SHEETC.p;
  const one = async () => { const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 20000);
    try { const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' }); return { ok: r.ok, txt: await r.text() }; } finally { clearTimeout(t); } };
  SHEETC.url = url; SHEETC.at = Date.now();
  SHEETC.p = one().catch(async (e) => { if (!navigator.onLine) throw e; await new Promise((r) => setTimeout(r, 1500)); return one(); });
  SHEETC.p.catch(() => { SHEETC.p = null; });   // a failure isn't reused
  return SHEETC.p;
}
async function sheetQuotes(syms, link) {
  const got = {}, url = sheetCsvUrl(link);
  if (!url) { LASTERR.sheet = 'link inválido — copie o link do botão Compartilhar'; return got; }
  try {
    const { ok: rok, txt } = await sheetCsv(url);
    if (!rok || /<html/i.test(txt.slice(0, 200))) { LASTERR.sheet = 'sem acesso — no Google Sheets: Compartilhar → "Qualquer pessoa com o link" → Leitor'; return got; }
    const all = {}, cur = {}, pcAll = {}, tdAll = {};
    for (const row of csvRows(txt)) { const tk = String(row[0] || '').trim().toUpperCase().replace(/^BVMF:/, ''); const px = sheetNum(row[1]); if (tk && px) { all[tk] = px; const pc0 = sheetNum(row[4]); if (pc0) pcAll[tk] = pc0; const td0 = tradeDay(row[2]); if (td0) tdAll[tk] = td0; const nm0 = String(row[5] || '').trim(); if (nm0 && !/^#/.test(nm0)) { NMQ[tk] = nm0; const sh0 = tk.includes(':') ? tk.split(':').pop() : null; if (sh0) NMQ[sh0] ||= nm0; } const c = String(row[3] || '').trim().toUpperCase(); if (/^(BRL|USD|GBP|GBX|EUR)$/.test(c)) cur[tk] = c; } }
    // also match without the exchange: "VWRP" finds "LON:VWRP" (an exact match always wins)
    for (const tk of Object.keys(all)) { const sh = tk.includes(':') ? tk.split(':').pop() : null; if (sh && !(sh in all)) { all[sh] = all[tk]; if (cur[tk]) cur[sh] = cur[tk]; if (pcAll[tk]) pcAll[sh] = pcAll[tk]; if (tdAll[tk]) tdAll[sh] = tdAll[tk]; EXQ[sh] = tk.split(':')[0]; } }
    for (const s2 of syms) { if (pcAll[s2]) PCQ.s[s2] = pcAll[s2]; TDQ.s[s2] = tdAll[s2] || null; }
    sheetQuotes.cur = cur;
    for (const s of syms) if (all[s]) got[s] = all[s];
    sheetQuotes.count = Object.keys(all).length;
    if (!Object.keys(all).length) LASTERR.sheet = 'nenhum preço na planilha (coluna A = ticker, coluna B = preço)';
    else if (syms.length && !Object.keys(got).length) LASTERR.sheet = 'tickers não encontrados na planilha: ' + syms.join(', ');
  } catch (e) { console.warn('sheet', e); LASTERR.sheet = e.name === 'AbortError' ? 'demorou demais' : 'não consegui ler — confira se a planilha está em Compartilhar → "Qualquer pessoa com o link"'; }
  return got;
}
async function setKeyStatus(prov, ok, okMsg) {
  (DB.settings.keyStatus ||= {})[prov] = { ok, msg: ok ? okMsg : (LASTERR[prov] || 'sem resposta'), at: new Date().toISOString() };
}
let assetBusy = false;
async function refreshAssetPrices(force) {
  if (PREVIEW) return null;
  const A = DB?.assets || []; if (!A.length || assetBusy || !navigator.onLine) return null;
  if (!force && DB.prices.assetsAt && Date.now() - new Date(DB.prices.assetsAt) < 5 * 60 * 1000) return null;
  assetBusy = true;
  try {
    const keys = DB.settings.keys || {};
    const now = () => new Date().toISOString(), tk = (m) => [...new Set(A.filter((a) => a.market === m).map((a) => a.ticker))];
    const usDue = !DB.prices.usAt || Date.now() - new Date(DB.prices.usAt) > 60 * 1000, b3Due = !DB.prices.b3At || Date.now() - new Date(DB.prices.b3At) > (force ? 5 : 30) * 60 * 1000;
    const euDue = force || !DB.prices.euAt || Date.now() - new Date(DB.prices.euAt) > 20 * 3600 * 1000;   // saves the small daily allowance
    const gsDue = force || !DB.prices.gsAt || Date.now() - new Date(DB.prices.gsAt) > 15 * 60 * 1000;
    // 1) Google Sheet first (no monthly limit): its own tickers + the B3 shares
    const gs = gsDue ? [...new Set([...tk('GS'), ...(keys.sheet ? tk('B3') : [])])] : [];
    if (gs.length) DB.prices.gsAt = now();
    const pg = gs.length ? await sheetQuotes(gs, keys.sheet) : {};
    if (gs.length && keys.sheet) { const own = tk('GS'), n = own.filter((t) => pg[t]).length; DB.prices.sheetHas = tk('B3').filter((t) => pg[t] && !(A.find((a) => a.ticker === t && a.market === 'B3' && suspectPx(a, pg[t], PCQ.s[t]))));
      await setKeyStatus('sheet', Object.keys(pg).length > 0, `${n}/${own.length} preços${DB.prices.sheetHas.length ? ` + ${DB.prices.sheetHas.length} da B3` : ''}`); }
    const inSheet = new Set(keys.sheet ? DB.prices.sheetHas || [] : []);
    // 2) brapi only for B3 shares the sheet doesn't have
    const b3 = b3Due ? tk('B3').filter((t) => !inSheet.has(t)) : [], us = usDue ? tk('US') : [], eu = euDue ? tk('EU') : [];
    if (b3.length) DB.prices.b3At = now(); if (us.length) DB.prices.usAt = now();
    const [pb, pu, pe] = await Promise.all([b3.length ? brapiQuotes(b3, keys.brapi) : {}, us.length ? finnhubQuotes(us, keys.finnhub) : {}, eu.length ? alphaQuotes(eu, keys.alpha) : {}]);
    if (b3.length) await setKeyStatus('brapi', Object.keys(pb).length > 0, `${Object.keys(pb).length}/${b3.length} preços`);
    else if (keys.brapi && tk('B3').length && inSheet.size === tk('B3').length) (DB.settings.keyStatus ||= {}).brapi = { ok: true, msg: 'em espera — todas as ações vêm da planilha', at: now() };
    if (us.length && keys.finnhub) await setKeyStatus('finnhub', Object.keys(pu).length > 0, `${Object.keys(pu).length}/${us.length} preços`);
    if (eu.length && keys.alpha) { await setKeyStatus('alpha', Object.keys(pe).length > 0, `${Object.keys(pe).length}/${eu.length} preços`); DB.prices.euAt = now(); }
    let ok = 0, fail = []; const bad = new Set();
    for (const a of A) {
      if (a.market === 'MANUAL') continue;
      const viaSheet = a.market === 'GS' || (a.market === 'B3' && inSheet.has(a.ticker));
      const due = viaSheet ? gsDue : a.market === 'B3' ? b3Due : a.market === 'US' ? usDue : euDue;
      if (!due) { if (a.priceAt && !a.priceErr) ok++; else if (!a.price) fail.push(a.ticker); continue; }   // fetched moments ago — still fresh
      let [Q, PC, TD] = viaSheet ? [pg, PCQ.s, TDQ.s] : a.market === 'B3' ? [pb, PCQ.b, TDQ.b] : a.market === 'US' ? [pu, PCQ.f, TDQ.f] : [pe, {}, {}];
      if (!Q[a.ticker] && a.market === 'B3' && pg[a.ticker]) [Q, PC, TD] = [pg, PCQ.s, TDQ.s];
      let px = Q[a.ticker]; const pc = PC[a.ticker];
      if (px && suspectPx(a, px, pc)) {   // e.g. 2580 for a R$ 16 share: keep the last good price, try brapi next time
        a.suspect = a.suspect && Math.abs(a.suspect.px / px - 1) < 0.05 ? a.suspect : { px, since: now() };
        if (Date.now() - new Date(a.suspect.since) < 24 * 3600 * 1000) { a.priceErr = `preço suspeito na fonte (${fmtN(px, 2)})`; fail.push(a.ticker); if (viaSheet && a.market === 'B3') bad.add(a.ticker); continue; }
      }
      if (px && !a.name && NMQ[a.ticker]) a.name = tidyName(NMQ[a.ticker]);
      if (px) { delete a.suspect; a.price = px; a.priceAt = now(); a.priceErr = null; ok++; if (pc > 0) { a.pc = pc; a.pcAt = today(); }
        a.tradeD = TD[a.ticker] || null; a.exch = Q === pg ? EXQ[a.ticker] || (a.market === 'B3' || curOf(a) === 'BRL' ? 'BVMF' : null) : a.market === 'US' ? 'US' : a.market === 'B3' ? 'BVMF' : null; if (a.market === 'GS' && sheetQuotes.cur?.[a.ticker]) a.currency = sheetQuotes.cur[a.ticker]; }
      else { a.priceErr = 'não atualizou'; fail.push(a.ticker); }   // keeps the last good price
    }
    if (bad.size) DB.prices.sheetHas = (DB.prices.sheetHas || []).filter((t) => !bad.has(t));   // brapi takes over that ticker next round
    DB.prices.assetsAt = new Date().toISOString(); await save();
    return { ok, fail };
  } finally { assetBusy = false; }
}

let ATV = { seg: 'acoes', open: null };
const AV_COL = ['#1D4ED8', '#0F766E', '#A16207', '#7C3AED', '#BE185D', '#15803D', '#C2410C', '#0369A1', '#4338CA', '#B91C1C'];
const avatar = (t) => { const k = String(t || '').replace(/^[A-Z]+:/, '').replace(/[^A-Z]/gi, '').toUpperCase(), h = [...k].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  return `<span class="av" style="background:${AV_COL[h % AV_COL.length]}">${esc(k.slice(0, 2) || '?')}</span>`; };
function segBar(active) {
  return `<div class="seg hy cw-seg">${ACLS.map((c) => `<button class="${active === c.k ? 'on' : ''}" data-seg="${c.k}">${c.n}</button>`).join('')}<button class="${active === 'cripto' ? 'on' : ''}" data-seg="cripto">Cripto</button></div>`;
}
function wireSeg() {
  $$('#view [data-seg]').forEach((b) => (b.onclick = () => { if (b.dataset.seg === 'cripto') location.hash = '#cripto'; else { ATV.seg = b.dataset.seg; if (route() !== 'ativos') location.hash = '#ativos'; else render(); } }));
}
function vAtivos() {
  const cls = ATV.seg, info = ACLS.find((c) => c.k === cls), rows = assetRows(cls), keys = DB.settings.keys || {};
  const total = rows.reduce((s, r) => s + r.value, 0), auto = !!DB.settings.auto?.[cls];
  const cost = rows.filter((r) => r.cost !== null).reduce((s, r) => s + r.cost, 0), withCost = rows.filter((r) => r.cost !== null);
  const pl = withCost.reduce((s, r) => s + r.pl, 0);
  // one currency everywhere: the one picked with ⇄ on the Painel
  const gbp = num(DB.prices.gbpbrl), inGBP = cls === 'stocks' && gbp > 0;
  const M = (v) => CM(v, 2), M0 = (v) => CM(v, 2);
  const needGS = rows.some((r) => r.a.market === 'GS') && !keys.sheet, needB3 = rows.some((r) => r.a.market === 'B3') && !keys.brapi, needUS = rows.some((r) => r.a.market === 'US') && !keys.finnhub, needEU = rows.some((r) => r.a.market === 'EU') && !keys.alpha;
  const manualTotal = cls === 'stocks' ? (num(DB.balances.pieStocks) + num(DB.balances.pieReits) + num(DB.balances.pieEtfs)) * num(DB.prices.gbpbrl) : num(DB.balances[cls]);
  $('#view').innerHTML = `<div class="gwrap cw">${segBar(cls)}
  
   
    <div class="gl cw-hero"><div class="lab">${info.n}</div><div class="val money">${M(total)}</div>
      ${withCost.length ? `<div class="sub cw-pl">${plLine(pl, cost ? pl / cost : 0)}</div>` : ''}</div>
    ${!auto || needGS || needB3 || needUS || needEU ? `<div class="gl">
      <label class="toggle"><input type="checkbox" id="at-auto" ${auto ? 'checked' : ''}><span><b>Usar estes ativos no patrimônio</b><br><span class="small muted">${auto ? 'Ligado: o total de ' + info.n + ' é calculado aqui (preços ao vivo).' : 'Desligado: vale o total digitado em Atualizar (<span class="money">' + M(manualTotal) + '</span>).'}</span></span></label>
      <div class="small muted" style="margin-top:8px">Preços: ${DB.prices.assetsAt ? fmtDate(DB.prices.assetsAt) : 'ainda não buscados'} · atualizam sozinhos a cada 5 min</div>
      <button class="btn block" id="at-refresh"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/></svg> Atualizar preços agora</button>
      ${needGS ? '<div class="banner" style="margin:10px 0 0">Para preços de FIIs, cole o link da sua planilha do Google em ⚙︎ Ajustes → Chaves de preço → Google Sheets.</div>' : ''}
      ${needB3 ? '<div class="banner" style="margin:10px 0 0">Para preços da B3, crie a chave grátis em <b>brapi.dev</b> e cole em ⚙︎ Ajustes → Chaves de preço.</div>' : ''}
      ${needUS ? '<div class="banner" style="margin:10px 0 0">Para preços dos EUA, crie a chave grátis em <b>finnhub.io</b> e cole em ⚙︎ Ajustes → Chaves de preço.</div>' : ''}
      ${needEU ? '<div class="banner" style="margin:10px 0 0">Para Londres/Europa, crie a chave grátis em <b>alphavantage.co</b> e cole em ⚙︎ Ajustes → Chaves de preço.</div>' : ''}
    </div>` : ''}
   <div class="gl"><div class="ahd"><h2 style="margin:0">Ativos</h2><a id="at-add" class="aadd"><svg style="vertical-align:-3px" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg> Adicionar</a></div>
     ${(() => {
        const itemHtml = (r) => { const op = ATV.open === r.a.id, stale = r.stale ? ` <span class="neg">⚠</span>` : '';
          const hoje = (() => { const a = r.a; if (a.market === 'MANUAL') return null; if (!tradedToday(a)) return 0; return a.pc > 0 && a.pcAt === today() ? priceOf(a) / a.pc - 1 : null; })();
          return `<div class="arow click${op ? ' open' : ''}" data-ar="${r.a.id}"><div class="al"><div class="t">${esc(r.a.ticker)}${stale}</div><div class="s">${esc(r.a.name || '')}</div></div>
          <div class="ar"><div class="t money">${M0(r.value)}</div><div class="s">${r.pl !== null ? plLine(r.pl, r.plPct) : 'sem preço médio'}</div></div><span class="ach">${op ? '▾' : '›'}</span></div>
          ${op ? `<div class="adet">
            <div><span>Quantidade</span><b>${r.a.qty.toLocaleString('pt-BR', { maximumFractionDigits: 8 })}</b></div>
            <div><span>Preço</span><b>${fmtPx(r.cur, r.pr)}${r.a.market === 'MANUAL' ? ' · manual' : ''}</b></div>
            <div><span>Preço médio</span><b>${num(r.a.avg) ? (r.a.cls === 'stocks' && r.a.avgCur !== 'ASSET' ? '£ ' + nf2.format(r.a.avg) : fmtPx(r.cur, r.a.avg)) : '—'}</b></div>
            <div><span>Lucro</span><b class="money ${r.pl === null ? '' : r.pl < 0 ? 'neg' : 'pos'}">${r.pl === null ? '—' : signed(M0, r.pl)}</b></div>
            <div><span>Hoje</span><b class="${hoje ? (hoje < 0 ? 'neg' : 'pos') : ''}">${hoje === null ? '—' : signed(pct, hoje)}</b></div>
            <div><span>Peso</span><b>${pct(total ? r.value / total : 0)}</b></div>
            ${r.stale ? `<div style="grid-column:span 2"><span class="neg">⚠ ${r.a.priceAt ? 'preço de ' + new Date(r.a.priceAt).toLocaleDateString('pt-BR') + ' — não atualizou' : 'sem preço'}</span></div>` : ''}
            <div style="grid-column:span 2"><a class="aedit" data-ed="${r.a.id}">Editar ativo ›</a></div></div>` : ''}`; };
        const itemHtmlOld = (r) => `<div class="item click" data-id="${r.a.id}">
        <div class="av-row">${avatar(r.a.ticker)}<div><div class="t">${esc(r.a.ticker)} ${r.a.kind ? `<span class="small muted">${esc(r.a.kind)}</span>` : ''}</div>
        <div class="s">${r.a.qty.toLocaleString('pt-BR', { maximumFractionDigits: 8 })} × ${fmtPx(r.cur, r.pr)}${r.a.market === 'MANUAL' ? ' · manual' : ''}${!num(r.a.avg) ? ' · <span class="warn">sem preço médio</span>' : ''}${r.stale ? ` · <span class="neg">⚠ ${r.a.priceAt ? 'preço de ' + new Date(r.a.priceAt).toLocaleDateString('pt-BR') : 'sem preço'}</span>` : ''}</div></div></div>
        <div class="r"><div class="t">${M(r.value)}</div>${r.pl !== null ? `<div class="s ${r.pl < 0 ? 'neg' : 'pos'}">${signed(M0, r.pl)} · ${signed(pct, r.plPct)}</div>` : ''}</div></div>`;
        const sorted = rows.sort((x, y) => y.value - x.value);
        if (!sorted.length) return '<p class="muted">Nenhum ativo ainda. Toque em ＋ Adicionar ativo.</p>';
        if (cls !== 'stocks') return sorted.map(itemHtml).join('');
        // Exterior: one "pie" per type, like Trading 212 (Stocks, REITs, ETFs)
        let openP = []; try { openP = JSON.parse(localStorage.getItem('rumo.pies') || '[]'); } catch {}
        return ['Stock', 'REIT', 'ETF'].map((k) => {
          const g = sorted.filter((r) => (r.a.kind || 'Stock') === k); if (!g.length) return '';
          const v = g.reduce((a, r) => a + r.value, 0), wc = g.filter((r) => r.cost !== null), c = wc.reduce((a, r) => a + r.cost, 0), gp = wc.reduce((a, r) => a + r.pl, 0);
          const op = openP.includes(k);
          return `<div class="pie-h click" data-pie="${k}"><div><b><span class="chev2">${op ? '▾' : '▸'}</span> ${k === 'Stock' ? 'Stocks' : k + 's'}</b><span class="small muted"> · ${g.length} ${g.length === 1 ? 'ativo' : 'ativos'} · ${pct(total ? v / total : 0)}</span></div>
            <div class="r"><b class="money">${M(v)}</b>${c ? `<div class="small">${plLine(gp, gp / c)}</div>` : ''}</div></div>` + (op ? g.map(itemHtml).join('') : '');
        }).join('');
      })()}
     ${rows.some((r) => r.stale) ? '<div class="small muted" style="margin-top:8px">⚠ = o preço não atualizou; o app continua usando o último preço bom.</div>' : ''}
   </div>
  </div>`;
  wireSeg();
  $('#at-auto') && ($('#at-auto').onchange = async (e) => {
    if (e.target.checked && !rows.length) { e.target.checked = false; return toast('Adicione os ativos primeiro'); }
    (DB.settings.auto ||= {})[cls] = e.target.checked; await save(); render();
    toast(e.target.checked ? `Patrimônio agora usa os ativos de ${info.n}` : `Voltou para o total digitado em Atualizar`);
  });
  $('#at-refresh') && ($('#at-refresh').onclick = async () => { toast('Buscando preços…'); $('#btn-refresh').classList.add('spin'); setTimeout(() => $('#btn-refresh')?.classList.remove('spin'), 1200); const r = await refreshAssetPrices(true); render(); if (r) toast(r.fail.length ? `${r.ok} atualizados · não atualizaram: ${r.fail.join(', ')}` : `✓ ${r.ok} preços em dia`, 4500); else toast('Sem internet ou sem ativos'); });
  $('#at-add').onclick = () => editAsset(null, cls);
  $('#at-all-gs') && ($('#at-all-gs').onclick = async () => {
    const L = DB.assets.filter((a) => a.cls === 'acoes' && a.market === 'B3');
    if (!(await ask(`Mudar ${L.length} ações de brapi para Google Sheets?\n\nAntes, confira que estes tickers estão na coluna A da planilha:\n${L.map((a) => a.ticker).join(', ')}`))) return;
    for (const a of L) { a.market = 'GS'; a.currency = 'BRL'; }
    await save(); render(); const r = await refreshAssetPrices(true); render();
    toast(r?.fail.length ? `Não estão na planilha: ${r.fail.join(', ')}` : '✓ Ações agora vêm da planilha', 5000);
  });
  $$('#view .item').forEach((el) => (el.onclick = () => editAsset(el.dataset.id)));
  $$('#view [data-ar]').forEach((el) => (el.onclick = () => { ATV.open = ATV.open === el.dataset.ar ? null : el.dataset.ar; const y = window.scrollY; render(); window.scrollTo(0, y); }));
  $$('#view [data-ed]').forEach((el) => (el.onclick = (e) => { e.stopPropagation(); editAsset(el.dataset.ed); }));
  // tap a pie to open/close its shares (remembered on this phone)
  $$('#view .pie-h').forEach((el) => (el.onclick = () => { let o = []; try { o = JSON.parse(localStorage.getItem('rumo.pies') || '[]'); } catch {}
    const k = el.dataset.pie; o = o.includes(k) ? o.filter((x) => x !== k) : [...o, k]; try { localStorage.setItem('rumo.pies', JSON.stringify(o)); } catch {} render(); }));
}
function editAsset(id, cls) {
  const a = id ? DB.assets.find((x) => x.id === id) : { id: uid(), cls, ticker: '', kind: cls === 'stocks' ? 'Stock' : '', market: ACLS.find((c) => c.k === cls).market, currency: 'BRL', avgCur: cls === 'stocks' ? 'GBP' : 'ASSET', qty: 0, avg: null, manualPrice: null, price: null, priceAt: null };
  const inp = (id2, v, ph = '') => `<input id="${id2}" class="pt" inputmode="decimal" value="${v === null || v === undefined || v === 0 ? '' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 8 })}" placeholder="${ph || '0'}">`;
  openSheet(`<h3>${id ? esc(a.ticker) : 'Novo ativo — ' + ACLS.find((c) => c.k === a.cls).n}</h3>
    <div class="field"><label>Ticker<small>${a.cls === 'stocks' ? 'ex.: AAPL, O, VOO' : 'ex.: PETR4, HGLG11'}</small></label><input id="ea-t" value="${esc(a.ticker)}" autocapitalize="characters" style="text-align:left"></div>
    <div class="field"><label>Nome<small>opcional — aparece embaixo do ticker</small></label><input id="ea-name" value="${esc(a.name || '')}" placeholder="${a.cls === 'stocks' ? 'ex.: Realty Income' : 'ex.: BB Seguridade'}" style="text-align:left"></div>
    ${a.cls === 'stocks' ? `<div class="field"><label>Tipo</label><select id="ea-kind">${['Stock', 'REIT', 'ETF'].map((k) => `<option ${a.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select></div>` : ''}
    <div class="field"><label>Preço vem de</label><select id="ea-m">
      ${[['GS', 'Google Sheets (qualquer bolsa)'], ['B3', 'brapi (B3 ações)'], ['US', 'Finnhub (EUA)'], ['EU', 'Alpha Vantage (Londres/Europa)'], ['MANUAL', 'Manual (eu digito)']].map(([v, l]) => `<option value="${v}" ${a.market === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="small muted hidden" id="ea-eu-hint" style="margin:-6px 0 10px">Use o sufixo da bolsa: <b>.LON</b> Londres (preço em pence), <b>.DEX</b> Alemanha, <b>.PAR</b> Paris, <b>.AMS</b> Amsterdã. Ex.: VUSA.LON. Preço de fechamento, atualiza 1× por dia.</div>
    <div class="small muted hidden" id="ea-gs-hint" style="margin:-6px 0 10px">B3: só o ticker (HGLG11). Outras bolsas: na planilha escreva <b>BOLSA:TICKER</b> (ex.: LON:VWRP); aqui basta <b>VWRP</b>. A moeda vem da coluna D da planilha.</div>
    <div class="field" id="ea-cur-row"><label>Moeda do preço</label><select id="ea-cur">${[['BRL', 'R$'], ['USD', 'US$'], ['GBP', '£'], ['GBX', 'pence (p)'], ['EUR', '€']].map(([v, l]) => `<option value="${v}" ${a.currency === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="field"><label>Quantidade</label>${inp('ea-qty', a.qty)}</div>
    ${a.cls === 'stocks' ? `<div class="field"><label>Preço médio em<small>no Trading 212 é o valor em £ entre parênteses</small></label><select id="ea-avgcur"><option value="GBP" ${a.avgCur !== 'ASSET' ? 'selected' : ''}>£ libras</option><option value="ASSET" ${a.avgCur === 'ASSET' ? 'selected' : ''}>moeda do ativo</option></select></div>` : ''}
    <div class="field"><label>Preço médio pago<small id="ea-avg-h">opcional — mostra lucro/prejuízo</small></label>${inp('ea-avg', a.avg)}</div>
    <div class="field"><label>Preço manual<small>usado se for "Manual" ou se o automático falhar</small></label>${inp('ea-man', a.manualPrice)}</div>
    ${id ? `<div class="small muted">Último preço automático: ${a.price ? fmtPx(curOf(a), a.price) + ' em ' + fmtDate(a.priceAt) : '–'}${a.priceErr ? ' · ⚠ ' + esc(a.priceErr) : ''}</div>` : ''}
    <button class="btn primary block" id="ea-save">Salvar</button>
    ${id ? '<button class="btn block" id="ea-buy"><svg style="vertical-align:-4px" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg> Comprei mais</button><button class="btn danger block" id="ea-del">Apagar</button>' : ''}
    <button class="btn block" onclick="closeSheet()">Cancelar</button>`, (el) => {
    $$('input.pt', el).forEach(liveFormat);
    const curRow = (changed) => {
      const m = $('#ea-m', el).value; $('#ea-cur-row', el).classList.toggle('hidden', m !== 'MANUAL' && m !== 'EU' && m !== 'GS'); $('#ea-eu-hint', el).classList.toggle('hidden', m !== 'EU'); $('#ea-gs-hint', el).classList.toggle('hidden', m !== 'GS');
      const t = $('#ea-t', el).value.toUpperCase();
      if (changed && m === 'EU') $('#ea-cur', el).value = t.endsWith('.LON') ? 'GBX' : 'EUR';
      if (changed && m === 'GS') $('#ea-cur', el).value = !t.includes(':') ? (a.cls === 'stocks' ? 'GBP' : 'BRL') : t.startsWith('LON:') ? 'GBP' : /^(NYSE|NASDAQ|NYSEARCA|BATS):/.test(t) ? 'USD' : 'EUR';
    };
    const avgHint = () => { const ac = $('#ea-avgcur', el)?.value, c = $('#ea-cur', el).value, m = $('#ea-m', el).value;
      const cc = m === 'US' ? 'USD' : m === 'B3' ? 'BRL' : c; $('#ea-avg-h', el).innerHTML = ac === 'GBP' && cc !== 'GBP' ? '<b style="color:var(--amber)">em £</b> — no Trading 212 é o valor <b>entre parênteses</b> em "Average price", ex.: $99,94 <b>(£74,60)</b>'
        : 'por unidade, em ' + (ac === 'GBP' ? '£' : cc === 'GBX' ? 'pence' : curSym(cc)) + ' — mostra lucro/prejuízo'; };
    ['#ea-avgcur', '#ea-cur', '#ea-m'].forEach((k) => $(k, el)?.addEventListener('change', avgHint)); setTimeout(avgHint, 0);
    $('#ea-m', el).onchange = () => curRow(true); $('#ea-t', el).addEventListener('change', () => curRow(true)); curRow(false);
    $('#ea-save', el).onclick = async () => {
      const t = $('#ea-t', el).value.trim().toUpperCase().replace(/\s+/g, ''); if (!t) return toast('Digite o ticker');
      const o = { ...a, name: ($('#ea-name', el).value || '').trim() || undefined, ticker: t, kind: $('#ea-kind', el)?.value || a.kind, market: $('#ea-m', el).value, currency: $('#ea-cur', el).value,
        qty: parsePT($('#ea-qty', el).value) ?? 0, avg: parsePT($('#ea-avg', el).value), avgCur: $('#ea-avgcur', el)?.value || a.avgCur || 'ASSET', manualPrice: parsePT($('#ea-man', el).value) };
      if (o.ticker !== a.ticker || o.market !== a.market) { o.price = null; o.priceAt = null; }
      if (o.market === 'MANUAL' && !o.manualPrice) return toast('Digite o preço manual');
      // safety check: an average in £ that matches the price in $/€ (not in £) was probably typed in the wrong currency
      { const cur = curOf(o), px = o.price || a.price || o.manualPrice;
        if (o.avg && px && o.avgCur === 'GBP' && cur !== 'GBP' && cur !== 'BRL') {
          const pxGBP = px * FXOF(cur) / FXOF('GBP'), off = o.avg / pxGBP, near = Math.abs(o.avg / px - 1) < 0.25;
          if ((off > 1.2 || off < 0.8) && near && !(await ask(`O preço médio ${nf2.format(o.avg)} parece estar em ${cur === 'GBX' ? 'pence' : curSym(cur)}, não em £.\n\nHoje ${o.ticker} vale ${fmtPx(cur, px)} ≈ £ ${nf2.format(pxGBP)}. No Trading 212 use o valor em £ entre parênteses.\n\nSalvar assim mesmo?`, { yes: 'Salvar assim', no: 'Corrigir' }))) return;
        } }
      if (!DB.assets.find((x) => x.id === o.id) && DB.assets.find((x) => x.ticker === o.ticker && x.cls === o.cls)) return toast(o.ticker + ' já está na lista — edite ele');
      const i = DB.assets.findIndex((x) => x.id === o.id); if (i > -1) DB.assets[i] = o; else DB.assets.push(o);
      await save(); closeSheet(); render();
      if (o.market !== 'MANUAL' && !o.price) { const r = await refreshAssetPrices(true); render(); if (r?.fail.includes(o.ticker)) toast(`Não achei preço para ${o.ticker} — confira o ticker ou a chave`, 4500); }
    };
    if (id) {
      $('#ea-buy', el).onclick = () => openSheet(`<h3>${esc(a.ticker)} — comprei mais</h3>
        <div class="field"><label>Quantidade comprada</label><input id="b-q" class="pt" inputmode="decimal"></div>
        <div class="field"><label>Preço pago por unidade<small>opcional, em ${a.avgCur === 'GBP' ? '£' : curOf(a) === 'GBX' ? 'pence' : curSym(curOf(a))} — atualiza o preço médio</small></label><input id="b-p" class="pt" inputmode="decimal"></div>
        <button class="btn primary block" id="b-go">Adicionar</button><button class="btn block" onclick="closeSheet()">Cancelar</button>`, (e2) => {
        $$('input.pt', e2).forEach(liveFormat);
        $('#b-go', e2).onclick = async () => {
          const q = parsePT($('#b-q', e2).value), p = parsePT($('#b-p', e2).value); if (!q) return toast('Digite a quantidade');
          if (p && (a.avg || !a.qty)) a.avg = (num(a.qty) * num(a.avg) + q * p) / (num(a.qty) + q);
          a.qty = num(a.qty) + q; await save(); closeSheet(); render(); doneTick(); toast(`✓ ${a.ticker}: agora ${a.qty.toLocaleString('pt-BR', { maximumFractionDigits: 8 })}`);
        };
      });
      $('#ea-del', el).onclick = async () => { if (!(await ask('Apagar ' + a.ticker + '?', { yes: 'Sim, apagar', danger: true }))) return; DB.assets = DB.assets.filter((x) => x.id !== id); await save(); closeSheet(); render(); };
    }
  });
}

/* ---------------- rendering ---------------- */
const TITLES = { painel: 'Painel', atualizar: 'Registrar', historico: 'Histórico', dividendos: 'Dividendos', cripto: 'Cripto', ativos: 'Carteira', ajustes: 'Ajustes' };
function route() { return (location.hash || '#painel').slice(1); }
window.addEventListener('hashchange', () => { if (DB) render(); window.scrollTo(0, 0); });
// header line: how long ago the prices were fetched
function topSub() {
  const el = document.getElementById('top-sub'); if (!el || !DB) return; const u = DB.prices.updatedAt;
  let t = 'preços ainda não buscados';
  if (u) { const m = Math.floor((Date.now() - new Date(u)) / 60000);
    t = m < 1 ? 'atualizado agora' : m < 60 ? `atualizado há ${m} min` : m < 24 * 60 && new Date(u).toDateString() === new Date().toDateString() ? `atualizado às ${new Date(u).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'atualizado em ' + fmtDate(u); }
  el.textContent = PREVIEW ? 'prévia · valores de exemplo' : t + (navigator.onLine ? '' : ' · offline');
}
setInterval(topSub, 30 * 1000);
let RENDER_WAIT = false;
function render() {
  if (!DB) return;
  const ae = document.activeElement;
  if (ae && ae.matches && ae.matches('#view input[data-k]')) { if (!RENDER_WAIT) { RENDER_WAIT = true; ae.addEventListener('blur', () => { RENDER_WAIT = false; setTimeout(render, 0); }, { once: true }); } return; }
  setTimeout(() => $$('#view input[data-k]').forEach(liveFormat), 0);
  $('#btn-lock').classList.toggle('hidden', !!getMeta()?.open);
  charts.forEach((c) => c.destroy()); charts = [];
  const r = TITLES[route()] && route() !== 'graficos' ? route() : 'painel';
  $('#top-title').textContent = TITLES[r];
  topSub();
  $$('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === (r === 'cripto' ? 'ativos' : r)));
  requestAnimationFrame(() => { const maxY = Math.max(0, document.documentElement.scrollHeight - innerHeight); if (scrollY > maxY) scrollTo(0, maxY); });
  document.body.classList.add('glassy');   // the whole app uses the glass style
  ({ painel: vPainel, atualizar: vAtualizar, historico: vHistorico, dividendos: vDividendos, cripto: vCripto, ativos: vAtivos, ajustes: vAjustes })[r]();
  { const w = $('#view .gwrap'); if (w) { applyOrder(w, { painel: 'painel', atualizar: 'atualizar', dividendos: 'dividendos' }[r]);
    if (PAGE_SECS[r] && !w.querySelector('.lo-link')) { const a = document.createElement('button'); a.className = 'lo-link'; a.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg> Organizar esta página'; a.onclick = () => openLayout(r); w.appendChild(a); } } }
  if (r !== LAST_R) { const v = $('#view'); v.classList.remove('vfade'); void v.offsetWidth; v.classList.add('vfade'); LAST_R = r; }
}
let LAST_R = null;
$('#btn-settings').onclick = () => { location.hash = '#ajustes'; };
{ let tk = false; window.addEventListener('scroll', () => { if (tk) return; tk = true; requestAnimationFrame(() => { tk = false; const h = document.querySelector('header.top'); if (!h) return; const y = window.scrollY, on = h.classList.contains('small'); if (!on && y > 44) h.classList.add('small'); else if (on && y < 14) h.classList.remove('small'); }); }, { passive: true }); }
$('#btn-lock').onclick = lockNow;
// pull down from the top of any tab to refresh all prices (same as ⟳)
(() => {
  const ind = document.createElement('div'); ind.id = 'ptr'; ind.innerHTML = '<svg viewBox="0 0 32 32" width="26" height="26"><circle cx="16" cy="16" r="12" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="2.4"/><circle class="pr" cx="16" cy="16" r="12" fill="none" stroke="#D9C7A3" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="0 76" transform="rotate(-90 16 16)"/></svg>'; document.body.appendChild(ind);
  let y0 = null, dist = 0, busy = false;
  const can = () => DB && !busy && window.scrollY <= 0 && $('#modal').classList.contains('hidden') && !$('#app').classList.contains('hidden');
  document.addEventListener('touchstart', (e) => { y0 = can() && e.touches.length === 1 ? e.touches[0].clientY : null; dist = 0; if (y0 !== null) ind.style.top = ($('header.top').getBoundingClientRect().bottom + 8) + 'px'; }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (y0 === null) return; dist = Math.max(0, (e.touches[0].clientY - y0) * 0.5);
    if (window.scrollY > 0) { y0 = null; dist = 0; }
    ind.style.transform = `translate(-50%, ${Math.min(dist, 80) - 50}px)`; ind.style.opacity = Math.min(1, dist / 50);
    { const c = ind.querySelector('.pr'); if (c) c.setAttribute('stroke-dasharray', `${(Math.min(1, dist / 70) * 75.4).toFixed(1)} 76`); }
    ind.classList.toggle('ready', dist >= 70);
  }, { passive: true });
  document.addEventListener('touchend', async () => {
    if (y0 === null) return; y0 = null;
    if (dist >= 70) {
      busy = true; ind.classList.add('spin'); ind.style.opacity = 1; ind.style.transform = 'translate(-50%, 20px)';
      try { await refreshPrices(false, true); } finally { ind.style.opacity = 0; setTimeout(() => { busy = false; ind.classList.remove('spin', 'ready'); ind.style.transform = ''; ind.querySelector('.pr')?.setAttribute('stroke-dasharray', '0 76'); }, 220); }
    } else { ind.style.opacity = 0; ind.style.transform = ''; ind.classList.remove('ready'); }
    dist = 0;
  });
})();
// 👁 hides all amounts on screen (handy in public); the choice is remembered on this phone only
const EYE_ON = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" opacity=".55"/><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="2" opacity=".55"/><path d="M4 20 20 4" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
const setPriv = (on) => { document.documentElement.classList.toggle('priv', on); try { localStorage.setItem('rumo.hide', on ? '1' : '0'); } catch {} const b = $('#btn-eye'); b.innerHTML = on ? EYE_OFF : EYE_ON; b.setAttribute('aria-label', on ? 'Mostrar valores' : 'Esconder valores'); };
$('#btn-eye').onclick = () => { const on = !document.documentElement.classList.contains('priv'); setPriv(on); toast(on ? 'Valores escondidos' : 'Valores visíveis'); };
setPriv(document.documentElement.classList.contains('priv'));
$('#btn-refresh').onclick = () => refreshPrices(false);
window.addEventListener('online', () => DB && refreshPrices(true));

let chartLoading = false;
function chart(id, cfg) {
  const el = document.getElementById(id); if (!el) return;
  if (!window.Chart) {
    el.parentElement.innerHTML = '<p class="small">Carregando gráficos… (se não aparecer, confira se o arquivo chart.umd.js está no GitHub)</p>';
    if (!chartLoading) { chartLoading = true;   // loaded only when a chart is needed, so the app opens faster
      loadScript('chart.umd.js').catch(() => loadScript('https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js')).then(() => render(), () => { chartLoading = false; }); }
    return;
  }
  Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
  Chart.defaults.color = cssVar('--muted');
  charts.push(new Chart(el, cfg));
}
const kTicks = { callback: (v) => (Math.abs(v) >= 1000 ? (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k' : nf0.format(v)) };
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const gridOpts = () => ({ color: cssVar('--line') });

/* time-weighted return: each month = (end − start − aporte) / (start + ½·aporte), months compounded */
function returnsData() {
  const H = histLive(), months = [];
  for (let i = 1; i < H.length; i++) {
    const a = H[i - 1], b = H[i];
    if (typeof a.pat !== 'number' || typeof b.pat !== 'number' || ymDiff(a.month, b.month) !== 1) continue;
    const pa = BASE() === 'GBP' ? (a.fx ? a.pat / a.fx : null) : a.pat, pb = BASE() === 'GBP' ? (b.fx ? b.pat / b.fx : null) : b.pat;
    if (pa === null || pb === null) continue;   // £ base: a month with no rate can't be measured
    if (b.live) {   // this month so far: same figure as the Painel
      if (b.aporteGBP === null || b.aporteGBP === undefined) continue;
      const C = apMonthB(b.month, b.fx, b.aporteGBP), dm = dailyMonth(b.month), ll = liveLocal(portfolio());
      months.push({ month: b.month, gain: pb - pa - C, r: dm ? dm.r : (pb - pa - C) / pa, aporte: C, rl: ll ? ll.r : null, live: true }); continue;
    }
    const lm = localMonth(b.month), rl = lm ? lm.r : null;
    const dm = b.month < ym() ? dailyMonth(b.month) : null; if (dm) { months.push({ ...dm, rl }); continue; }   // daily data covers it → exact
    if (b.aporteGBP === null || b.aporteGBP === undefined) continue; // aporte unknown → month can't be measured
    const fx = b.fx || (num(b.aporteGBP) === 0 ? 1 : null); if (!fx) continue;   // rate is fetched in the background for old months
    const C = apMonthB(b.month, fx, b.aporteGBP), den = pa + 0.5 * C;
    if (den <= 0) continue;
    months.push({ month: b.month, gain: pb - pa - C, r: (pb - pa - C) / den, aporte: C, rl });
  }
  const years = {};
  for (const m of months) {
    const y = m.month.slice(0, 4); const Y = (years[y] ||= { year: y, f: 1, gain: 0, aporte: 0, n: 0, fl: 1, nl: 0 });
    Y.f *= 1 + m.r; Y.gain += m.gain; Y.aporte += m.aporte; Y.n++; if (m.rl !== null && m.rl !== undefined) { Y.fl *= 1 + m.rl; Y.nl++; }
  }
  const list = Object.values(years).map((Y) => ({ ...Y, r: Y.f - 1, rl: Y.nl ? Y.fl - 1 : null, full: Y.nl === Y.n })).sort((a, b) => a.year.localeCompare(b.year));
  const total = months.reduce((f, m) => f * (1 + m.r), 1) - 1;
  return { months, years: list, total, since: months[0]?.month || null };
}

// tap the "hoje" chip: what moved your money today, by category (no exchange-rate effect); tap a category to see its assets
// today's market move: each asset vs its previous close (as brokers show it), crypto over 24 h; typed balances and the exchange rate don't count
function dayMove(P) {
  const pr = DB.prices, yest = [...(DB.daily || [])].filter((x) => x.d < today() && x.a).pop() || null;
  const CATS = [['acoes', 'Ações'], ['fiis', 'FIIs'], ['Stock', 'Stocks'], ['REIT', 'REITs'], ['ETF', 'ETFs'], ['crypto', 'Cripto']];
  const G = Object.fromEntries(CATS.map(([k, n]) => [k, { n, v: 0, base: 0, items: [] }])); let snapUsed = 0, any = false;
  for (const a of DB.assets || []) {
    const pt = priceOf(a), q = num(a.qty); if (!pt || !q) continue;
    if (a.market !== 'MANUAL' && !tradedToday(a)) { const fx0 = FXOF(curOf(a)), k0 = a.cls === 'stocks' ? a.kind || 'Stock' : a.cls; if (G[k0]) { G[k0].base += q * pt * fx0; any = true; } continue; }   // its market hasn't opened today: 0
    let base = a.pc > 0 && a.pcAt === today() ? a.pc : null;
    if (!base) { const y = yest?.a?.[a.id]; if (!y || !y[0]) continue; base = y[0]; snapUsed++; }   // no previous close: last snapshot price
    const fx = FXOF(curOf(a)), v = q * (pt - base) * fx, k = a.cls === 'stocks' ? a.kind || 'Stock' : a.cls; if (!G[k]) continue;
    G[k].v += v; G[k].base += q * base * fx; any = true; if (Math.abs(v) >= 0.005) G[k].items.push({ t: a.ticker, r: pt / base - 1, v });
  }
  for (const c of P.cs.coins) {
    if (!c.units) continue; const u = num(pr.usdbrl), ch = pr[c.k + '_24h'], m0 = pr.cmid?.d === today() ? num(pr.cmid[c.k]) : 0, pt0 = num(pr[c.k]); let r, v, base;
    if (m0 > 0 && pt0 > 0 && Math.abs(pt0 / m0 - 1) < 0.5) { r = pt0 / m0 - 1; base = c.units * m0 * u; v = c.valUSD * u - base; }   // since 00:00
    else if (typeof ch === 'number') { r = ch / 100; base = (c.valUSD / (1 + r)) * u; v = c.valUSD * u - base; }
    else { const y = yest?.k?.[c.k], pt = num(pr[c.k]); if (!y || !y[0]) continue; r = pt / y[0] - 1; v = c.units * (pt - y[0]) * u; base = c.units * y[0] * u; snapUsed++; }
    G.crypto.v += v; G.crypto.base += base; any = true; if (Math.abs(v) >= 0.005) G.crypto.items.push({ t: c.k, r, v });
  }
  const list = CATS.map(([k]) => ({ k, ...G[k] })).filter((g) => g.base > 0 || g.items.length), v = list.reduce((t, g) => t + g.v, 0);
  return { any, v, r: P.total - v > 0 ? v / (P.total - v) : 0, list, snapUsed };
}
// today's real change of your money: now vs the last snapshot before today, in the base currency, new money taken out (exchange rate included)
function dayTotal(P) {
  const y = [...(DB.daily || [])].filter((x) => x.d < today() && x.v > 0).pop(); if (!y) return null;
  const yB = inB(y.v, y.g), nowB = inB(P.total, DB.prices.gbpbrl), fl = (DB.apLog || []).filter((e) => e.date > y.d && e.date <= today()).reduce((t, e) => t + apB(e), 0);
  const chB = nowB - yB - fl; return { r: yB ? chB / yB : 0, v: fromB(chB), from: y.d };
}
const exchOpenedLbl = () => { try { const d = new Date(); const ny = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' })), here = new Date(d.toLocaleString('en-US')); const diff = Math.round((here - ny) / 36e5); return String(9 + diff).padStart(2, '0') + ':30'; } catch { return '14:30'; } };
function todaySheet(CV) {
  const P = portfolio(), dm = dayMove(P), dt = dayTotal(P); if (!dm.any && !dt) return toast('Sem preços de fechamento ainda — puxe para atualizar');
  const wk = [0, 6].includes(new Date().getDay());
  const amt = (v) => `<span class="money ${v < 0 ? 'neg' : v > 0 ? 'pos' : ''}">${signed(CV, v)}</span>`;
  const catRow = (g) => `<div class="tc click" data-c="${g.k}"><div class="mc-row" style="border:0"><span><span class="tc-ch">▸</span> ${g.n}</span><span style="text-align:right">${g.base ? `<span class="${g.v < 0 ? 'neg' : g.v > 0 ? 'pos' : ''}">${signed(pctS, g.v / g.base)}</span> · ` : ''}${amt(g.v)}</span></div>
      <div class="tc-items hidden">${g.items.sort((a, b) => a.v - b.v).map((m) => `<div class="tc-i"><span>${esc(m.t)}</span><span><span class="${m.r < 0 ? 'neg' : 'pos'}">${signed(pctS, m.r)}</span> · ${amt(m.v)}</span></div>`).join('') || '<div class="tc-i muted">sem variação</div>'}</div></div>`;
  const T = dt || { v: dm.v, r: dm.r }, other = dt ? dt.v - dm.v : null;
  openSheet(`<div class="mc"><div class="mc-top"><div class="small muted">${dt ? 'desde o último registro (' + dmy(dt.from).slice(0, 5) + ') · em ' + BSYM() + ', com câmbio · sem aportes' : 'só mercado · sem câmbio'}</div><h3 style="margin:2px 0 0">Hoje</h3>
      <div class="mc-big ${T.v < 0 ? 'neg' : 'pos'} money">${signed(CV, T.v)}</div><div style="font-weight:700" class="${T.r < 0 ? 'neg' : 'pos'}">${signed(pctS, T.r)}</div></div>
      ${dt && dm.any ? `<div class="ps-card" style="margin:10px 0"><div class="ps-step"><span>Mercado (preços)</span><b class="money ${dm.v < 0 ? 'neg' : 'pos'}">${signed(CV, dm.v)}</b></div><div class="ps-step"><span>Câmbio e saldos digitados</span><b class="money ${other < 0 ? 'neg' : 'pos'}">${signed(CV, other)}</b></div></div><div class="small muted" style="margin:0 0 6px">Mercado por categoria (sem câmbio):</div>` : ''}
    <div class="small muted" style="margin:10px 0 2px;font-weight:700;letter-spacing:.03em">POR CATEGORIA <span style="font-weight:500;letter-spacing:0">· toque para ver os ativos</span></div>
    ${dm.list.map(catRow).join('')}
    ${dm.snapUsed ? `<div class="small muted" style="margin-top:10px">${dm.snapUsed} ${dm.snapUsed === 1 ? 'ativo sem' : 'ativos sem'} fechamento anterior na fonte de preço — comparado com o último registro do app.</div>` : ''}
    <div class="small muted" style="margin-top:6px">Londres abre 08:00 · B3 ${new Date().getTimezoneOffset() === 0 ? '13:00' : '14:00'} · EUA ${exchOpenedLbl()} (hora daqui). Cripto: desde a meia-noite.</div>
    <div class="small muted" style="margin-top:6px">${dt ? 'O total de hoje conta tudo: preços, a variação da libra e do dólar e os saldos que você digitou. As categorias mostram só os preços.' : 'Saldos digitados (renda fixa, caixa, cash da T212) não entram: só a variação de mercado.'}</div>
    <button class="btn block" onclick="closeSheet()" style="margin-top:14px">Fechar</button></div>`, (el) => {
    $$('.tc', el).forEach((t) => (t.onclick = () => { const it = $('.tc-items', t), open = it.classList.toggle('hidden') === false; $('.tc-ch', t).textContent = open ? '▾' : '▸'; }));
  });
}
// a champagne tick draws itself in the middle of the screen when money is logged
function doneTick() {
  let el = document.getElementById('tick'); if (!el) { el = document.createElement('div'); el.id = 'tick'; document.body.appendChild(el); }
  el.innerHTML = '<div><svg viewBox="0 0 64 64" width="64" height="64"><circle cx="32" cy="32" r="26" fill="none" stroke="var(--g-acc2, #C9B087)" stroke-width="2.6" stroke-dasharray="164" stroke-dashoffset="164"/><path d="M21 33l7.5 7.5L44 25" fill="none" stroke="var(--g-acc1, #F3EEE4)" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="36" stroke-dashoffset="36"/></svg></div>';
  el.classList.remove('on'); void el.offsetWidth; el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), 1100);
}
// ---- your own order for the cards (Ajustes → Organizar páginas). Saved with your data, so it comes back with a backup
const LAYOUT = {
  painel_top: { t: 'Painel · cartões que deslizam', it: [['pat', 'Patrimônio'], ['rumo', 'Rumo a R$ 1 milhão'], ['cripto', 'Cripto']] },
  painel: { t: 'Painel · abaixo dos cartões', it: [['onde', 'Onde está'], ['div', 'Dividendos'], ['perf', 'Desempenho']] },
  atualizar: { t: 'Registrar', it: [['pat', 'Patrimônio do mês'], ['act', 'Botões Aporte e Dividendo'], ['mes', 'Lançamentos do mês'], ['saldos', 'Saldos que você digita'], ['auto', 'Automático']] },
  dividendos: { t: 'Dividendos', it: [['ano', 'Este ano'], ['add', 'Dividendo recebido'], ['vida', 'Na vida'], ['quem', 'Quem mais paga'], ['ultimos', 'Últimos pagamentos'], ['tabela', 'Tabela por ano']] },
};
const PAGE_SECS = { painel: ['painel_top', 'painel'], atualizar: ['atualizar'], dividendos: ['dividendos'] };
function layoutOf(key) { const def = LAYOUT[key].it.map((x) => x[0]), saved = (DB.settings.layout || {})[key] || []; return [...saved.filter((k) => def.includes(k)), ...def.filter((k) => !saved.includes(k))]; }
function applyOrder(box, key) {
  if (!box || !key || !LAYOUT[key]) return; const ord = layoutOf(key), kids = [...box.querySelectorAll(':scope > [data-k]')]; if (kids.length < 2) return;
  const slots = kids.map((k) => { const c = document.createComment(''); k.replaceWith(c); return c; });
  const sorted = [...kids].sort((a, b) => ord.indexOf(a.dataset.k) - ord.indexOf(b.dataset.k)); sorted.forEach((k, i) => slots[i].replaceWith(k));
}
function openLayout(only) {
  const secs = only ? PAGE_SECS[only] || [] : Object.keys(LAYOUT);
  const draw = () => `<h3>Organizar ${only ? 'esta página' : 'páginas'}</h3><p class="small muted" style="margin:-4px 0 12px">Use as setas para mudar a ordem. Muda na hora.</p>
    ${secs.map((key) => { const ord = layoutOf(key), names = Object.fromEntries(LAYOUT[key].it);
      return `<div class="lo-sec"><div class="lo-h"><span>${LAYOUT[key].t}</span>${(DB.settings.layout || {})[key] ? `<a class="lo-reset" data-r="${key}">Padrão</a>` : ''}</div><div class="lo-list">
        ${ord.map((k, i) => `<div class="lo-row"><span class="lo-n">${i + 1}</span><span class="lo-t">${names[k]}</span>
          <button class="lo-b" data-key="${key}" data-k="${k}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Subir"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg></button>
          <button class="lo-b" data-key="${key}" data-k="${k}" data-d="1" ${i === ord.length - 1 ? 'disabled' : ''} aria-label="Descer"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button></div>`).join('')}</div></div>`; }).join('')}
    <button class="btn block" onclick="closeSheet()" style="margin-top:14px">Pronto</button>`;
  const wire = (el) => {
    $$('.lo-b', el).forEach((b) => (b.onclick = async () => { const key = b.dataset.key, ord = layoutOf(key), i = ord.indexOf(b.dataset.k), j = i + Number(b.dataset.d); if (j < 0 || j >= ord.length) return;
      [ord[i], ord[j]] = [ord[j], ord[i]]; (DB.settings.layout ||= {})[key] = ord; await save(); $('#sheet').innerHTML = $('#sheet .sh-top')?.outerHTML + draw(); wire($('#sheet')); render(); }));
    $$('.lo-reset', el).forEach((a) => (a.onclick = async () => { delete (DB.settings.layout || {})[a.dataset.r]; await save(); $('#sheet').innerHTML = $('#sheet .sh-top')?.outerHTML + draw(); wire($('#sheet')); render(); }));
  };
  openSheet(draw(), wire);
}
let PG_I = 0;   // top card shown: kept while the app is open, back to Patrimônio after reopening or unlocking
let COUNTED = false;   // the patrimônio counts up once each time the app opens
let SHOWN = null;   // last patrimônio shown, so a refresh glides from the old value to the new one
function countUp(el, v, fmt, cur) {
  if (!el || !(v > 0)) return; let reduce = false; try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch {}
  const prev = SHOWN; SHOWN = { v, cur };
  const from = !COUNTED ? 0 : prev && prev.cur === cur && Math.abs(prev.v - v) > 0.5 ? prev.v : null;
  if (!COUNTED) { COUNTED = true; document.querySelector('.gwrap')?.classList.add('first'); }
  if (prev && prev.cur !== cur && !reduce) { el.classList.remove('nswap'); void el.offsetWidth; el.classList.add('nswap'); }
  if (from === null || reduce) return;
  const t0 = performance.now(), D = from === 0 ? 700 : 600, step = (t) => { const k = Math.min(1, (t - t0) / D), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(from + (v - from) * e); if (k < 1) requestAnimationFrame(step); else el.textContent = fmt(v); };
  requestAnimationFrame(step);
}
function vPainel() {
  const P = portfolio(), st = historyStats(), pr = projections(P.total), ms = milestones(), s = DB.settings, cs = P.cs;
  const meta = num(s.meta), prog = meta ? Math.min(1, P.total / meta) : 0;
  const backupOld = !s.lastBackup || Date.now() - new Date(s.lastBackup) > 30 * 864e5;
  const R = returnsData();
  // ⇄ on the Patrimônio card: R$ → £ → US$ (remembered on this phone)
  const HM = { BRL: (v) => brl(v), GBP: (v) => gbp(v / (DB.prices.gbpbrl || 1)), USD: (v) => usd(v / (DB.prices.usdbrl || 1)) };
  let heroCur = 'BRL'; try { heroCur = HM[localStorage.getItem('rumo.cur')] ? localStorage.getItem('rumo.cur') : 'BRL'; } catch {}
  const heroOpen = () => { try { return localStorage.getItem('rumo.hero') === '1'; } catch { return false; } };
  const CV = (v) => HM[heroCur](v);
  const divNow = (() => { const m = ym(), h = DB.draft.month === m ? DB.draft : DB.history.find((x) => x.month === m) || {}; return divTotal({ ...h, month: m, fx: h.fx || DB.prices.gbpbrl }); })();   // every amount on the Painel follows the ⇄ currency
  // "Este mês": live patrimônio vs the last month saved before this calendar month
  const prevM = DB.history.filter((h) => typeof h.pat === 'number' && h.month < ym()).slice(-1)[0] || null, mChg = prevM ? P.total - prevM.pat : 0;
  // real growth this month (aportes taken out): exact daily chain when possible, otherwise vs last saved month
  const apNowGBP = (() => { const a = apSum(ym()); if (a !== null) return a; const dv = DB.draft.month === ym() ? DB.draft.aporteGBP : null; if (dv !== null && dv !== undefined) return dv; const h = DB.history.find((x) => x.month === ym()); return h && h.aporteGBP !== undefined ? h.aporteGBP : null; })();
  const prevB = prevM ? inB(prevM.pat, prevM.fx) : null, nowB = inB(P.total, DB.prices.gbpbrl);   // in the base currency, each at its own rate
  const mRealV = prevM && apNowGBP !== null && apNowGBP !== undefined ? nowB - prevB - apMonthB(ym(), DB.prices.gbpbrl, apNowGBP) : null;   // in base
  const mReal = (() => { const dm = dailyMonth(ym()); if (dm) return dm.r; if (!prevM || !prevB) return null;
    const apNow = apNowGBP; if (apNow === null || apNow === undefined) return null;
    return mRealV / prevB; })();
  // crypto 24h move, weighted by what you hold of each coin
  const c24 = (() => { let now = 0, before = 0, any = false; for (const x of cs.coins) { const ch = DB.prices[x.k + '_24h']; if (typeof ch !== 'number' || !x.valUSD) continue; any = true; now += x.valUSD; before += x.valUSD / (1 + ch / 100); } return any && before ? now / before - 1 : null; })();
  const aportesYearGBP = DB.history.filter((h) => h.month.startsWith(st.year) && h.aporteGBP).reduce((a, h) => a + h.aporteGBP, 0);
  const aportesYear = DB.history.filter((h) => h.month.startsWith(st.year) && h.aporteGBP && h.fx).reduce((a, h) => a + apMonthBRL(h.month, h.fx, h.aporteGBP), 0);

  // ---- extras for the new layout
  const mLoc = prevM ? liveLocal(P) : null;
  // the year on the Painel = saved months of this year (except the current one) × the current month LIVE, same as the month figure
  const Ry = (() => {
    const yNow = String(new Date().getFullYear()), M = R.months.filter((m) => m.month.startsWith(yNow) && m.month !== ym());
    let f = 1, fl = 1, gain = 0, n = 0, nl = 0;
    for (const m of M) { f *= 1 + m.r; gain += m.gain; n++; if (m.rl !== null && m.rl !== undefined) { fl *= 1 + m.rl; nl++; } }
    if (prevM && mReal !== null) { f *= 1 + mReal; gain += mRealV ?? 0; n++; if (mLoc) { fl *= 1 + mLoc.r; nl++; } }
    return n ? { year: yNow, r: f - 1, gain, n, rl: nl ? fl - 1 : null, nl, full: nl === n } : null;
  })();
  // "hoje": investments only — each block in its own currency vs yesterday's snapshot, aportes of today taken out (no exchange-rate effect)
  const dmv = dayMove(P), dTot = dayTotal(P), dLoc = dTot ? { r: dTot.r, gainR: dTot.v } : dmv.any ? { r: dmv.r, gainR: dmv.v } : null;   // real change today (with câmbio); market-only if there is no snapshot from before today
  const dChg = dLoc ? dLoc.gainR : null;
  const spark = (() => {   // last 30 days of daily values (+ now); falls back to the last 12 saved months
    const cut = Date.now() - 30 * 864e5; let pts = (DB.daily || []).filter((x) => new Date(x.d + 'T12:00') >= cut && x.d < today()).map((x) => x.v), lbl = 'últimos 30 dias';
    if (pts.length < 2) { pts = DB.history.filter((h) => typeof h.pat === 'number').slice(-12).map((h) => h.pat); lbl = 'últimos 12 meses'; }
    pts = [...pts, P.total]; if (pts.length < 2) return '';
    const mn = Math.min(...pts), mx = Math.max(...pts), W = 300, H = 50, y = (v) => (mx === mn ? H / 2 : H - 4 - ((v - mn) / (mx - mn)) * (H - 8));
    const d = pts.map((v, k) => `${k ? 'L' : 'M'}${((k / (pts.length - 1)) * W).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#60A5FA" stop-opacity=".35"/><stop offset="1" stop-color="#60A5FA" stop-opacity="0"/></linearGradient></defs>
      <path d="${d} L${W} ${H} L0 ${H} Z" fill="url(#sg)"/><path d="${d}" fill="none" stroke="#93C5FD" stroke-width="2" vector-effect="non-scaling-stroke"/></svg><div class="spark-l">${lbl}</div>`;
  })();
  const bars = (() => {   // last 12 months of real growth; current month live (lighter)
    const byM = Object.fromEntries(R.months.map((m) => [m.month, m.r])), L = [];   // bars: return in the base currency (exchange rate included)
    for (let k = 11; k >= 0; k--) { const m = ymAdd(ym(), -k); L.push({ m, r: m === ym() ? mReal : byM[m] ?? null, live: m === ym() }); }
    const mx = Math.max(0.005, ...L.filter((x) => x.r !== null).map((x) => Math.abs(x.r)));
    const first = L.findIndex((x) => x.r !== null), F = first > 0 ? L.slice(first) : null;
    void F;
    const INI = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
    return `<div class="pb3">${L.map((x) => { const h = x.r === null ? 0 : Math.max(4, (Math.abs(x.r) / mx) * 30), c = x.r < 0 ? 'neg' : 'pos';
      return `<div class="c${x.live ? ' cur' : ''}" data-bm="${x.m}" data-br="${x.r ?? ''}"><div class="up">${x.r !== null && x.r >= 0 ? `<i class="${c}" style="height:${h}px"></i>` : ''}</div><div class="dn">${x.r < 0 ? `<i class="${c}" style="height:${h}px"></i>` : ''}</div><div class="m">${INI[Number(x.m.slice(5)) - 1]}</div></div>`; }).join('')}</div>`;
  })();
  const nLogM = (DB.divLog || []).filter((e) => e.date.slice(0, 7) === ym()), lastD = nLogM.length ? [...nLogM].sort((a, b) => b.date.localeCompare(a.date))[0] : null;
  const nextDiv = (Math.floor(st.divLife / 10000) + 1) * 10000, divProg = (st.divLife % 10000) / 10000;
  const nextMs = ms.find((m) => !m.hit), etaMs = nextMs && st.cresc12 > 0 ? ymAdd(ym(), Math.ceil(Math.max(0, nextMs.v - P.total) / st.cresc12)) : null;
  const TI = { coin: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .9-3 2s1.3 1.7 3 2 3 .9 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5M12 6v2M12 16v2"/></svg>', trophy: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8"/></svg>', btc: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6h5a3 3 0 0 1 0 6H9zM9 12h6a3 3 0 0 1 0 6H9zM9 6v12M11 4v2M11 18v2M8 6h1M8 18h1"/></svg>', down: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v11M8 10l4 4 4-4M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>' };
  const tile = (ico, bg, lab, val, sub, go, extra = '') => { const [ic, fg] = ico.split('|'); return `<div class="card kpi t2 click" onclick="location.hash='${go}'"><span class="ico" style="background:${bg};color:${fg}">${TI[ic] || ic}</span><div class="lab">${lab}</div><div class="val">${val}</div><div class="sub">${sub}</div>${extra}</div>`; };
  // ---- glass layout
  const GC = { fiis: 'var(--g-c1)', crypto: 'var(--g-c2)', rf: 'var(--g-c3)', acoes: 'var(--g-c4)', stocks: 'var(--g-c5)', caixa: 'var(--g-c6)' };
  const GO = { acoes: "ATV.seg='acoes';location.hash='#ativos'", fiis: "ATV.seg='fiis';location.hash='#ativos'", stocks: "ATV.seg='stocks';location.hash='#ativos'", crypto: "location.hash='#cripto'", rf: "location.hash='#atualizar'", caixa: "location.hash='#atualizar'" };
  const cats = [...P.alloc.map((a) => ({ k: a.k, n: a.k === 'crypto' ? 'Cripto' : a.n, v: a.v, cur: a.cur, tgt: a.tgt })), { k: 'caixa', n: 'Caixa', v: num(DB.balances.caixa), cur: null, tgt: null }].sort((x, y) => y.v - x.v);
  const nx = P.alloc.find((a) => a.n === P.next.n), hitN = ms.filter((m) => m.hit).length, win = ms.slice(Math.max(0, Math.min(hitN - 2, ms.length - 5)), Math.max(0, Math.min(hitN - 2, ms.length - 5)) + 5);
  const msL = (v) => (v >= 1e6 ? nf0.format(v / 1e6) + ' mi' : nf0.format(v / 1000) + ' mil');
  const R0 = 44, C0 = 2 * Math.PI * R0;
  const DO = '1';
  const divM = `<div class="gll">${lastD ? `${nLogM.length} ${nLogM.length === 1 ? 'pagamento' : 'pagamentos'} · último ${dmy(lastD.date)}` : 'nenhum ainda'}</div>`;
  const divCard = `<div class="gl click gdiv" onclick="location.hash='#dividendos'">
     <div class="glh"><span class="gll">Dividendos de ${MONTHS[new Date().getMonth()].toLowerCase()}</span><span class="gch">›</span></div>
     <div class="gtot money" style="font-size:36px;margin:4px 0 2px">${CV(divNow)}</div>${divM}
     <div class="gdiv2"><div><div class="gll">${st.year}</div><div class="gk money">${CV(st.divYear + (DB.draft.month === ym() && !DB.history.some((h) => h.month === ym()) ? divNow : 0))}</div></div>
       <div><div class="gll">Na vida</div><div class="gk money">${CV(st.divLife)}</div><div class="gbar"><i style="width:${(divProg * 100).toFixed(1)}%"></i></div><div class="gll" style="margin-top:4px;font-size:11.5px">faltam ${brl(nextDiv - st.divLife)} p/ ${nf0.format(nextDiv / 1000)} mil</div></div></div></div>`;
  const divLine = `<a class="gdline click" onclick="location.hash='#dividendos'"><span class="money">${CV(divNow)}</span> em dividendos em ${MONTHS[new Date().getMonth()].toLowerCase()} ›</a>`;
  const divTiles = `<div class="gtwo">
     <div class="gl click" onclick="location.hash='#dividendos'"><div class="gll">Dividendos ${MONTHS[new Date().getMonth()].toLowerCase()}</div><div class="gk money">${CV(divNow)}</div><div class="gll">${lastD ? `${nLogM.length} ${nLogM.length === 1 ? 'pagamento' : 'pagamentos'}` : 'nenhum ainda'}</div></div>
     <div class="gl click" onclick="location.hash='#dividendos'"><div class="gll">Dividendos na vida</div><div class="gk money">${CV(st.divLife)}</div><div class="gbar"><i style="width:${(divProg * 100).toFixed(1)}%"></i></div><div class="gll" style="margin-top:5px">faltam ${brl(nextDiv - st.divLife)} p/ ${nf0.format(nextDiv / 1000)} mil</div></div></div>`;
  const divTry = '';
  $('#view').innerHTML = `
  ${SAVE_ERR ? `<div class="banner" style="border-color:var(--neg)" onclick="location.hash='#ajustes'">⚠ As últimas mudanças não foram salvas no aparelho (${esc(SAVE_ERR)}). Faça um backup agora — toque aqui.</div>` : ''}
  ${(() => { const u = storeUse(); return u.p >= 0.7 ? `<div class="banner" onclick="location.hash='#ajustes'">O espaço do app no iPhone está ${Math.round(u.p * 100)}% cheio (${mbTxt(u.b)} de 5 MB). Faça um backup e peça a mudança para o armazenamento maior — toque aqui.</div>` : ''; })()}
  ${backupOld ? `<div class="banner" onclick="location.hash='#ajustes'">Faça um backup — ${s.lastBackup ? 'o último foi há mais de 30 dias' : 'você ainda não fez nenhum'}. Toque aqui.</div>` : ''}
  <div class="gwrap">${divTry}
   <div class="gpg" id="gpg">
    <div data-k="pat" class="gpage">
   <div class="gl">
     <div class="glh"><span class="gll">Patrimônio <button class="geye" id="p-eye" aria-label="Esconder valores"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg></button></span><button class="gswap" id="cur-swap" aria-label="Trocar moeda"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/></svg> ${heroCur === 'BRL' ? 'R$' : heroCur === 'GBP' ? '£' : 'US$'}</button></div>
     <div class="gtot money">${HM[heroCur](P.total)}</div>
     <div class="chips2">${dLoc ? `<span class="dchip ${dChg < 0 ? 'neg' : 'pos'}">${dChg < 0 ? '▼' : '▲'} <span class="money">${CV(Math.abs(dChg))}</span> <small>hoje</small> ${signed(pctS, dLoc.r)}</span>` : ''}${prevM ? (() => { // the month's real result: aportes and withdrawals taken out, in the base currency, exchange rate included (same as Desempenho)
       const real = mRealV !== null && mReal !== null, v = real ? fromB(mRealV) : mChg;
       return `<span class="mchip ${v < 0 ? 'neg' : 'pos'}" id="mchip">${v < 0 ? '▼' : '▲'} <span class="money">${CV(Math.abs(v))}</span> <small>no mês</small>${real ? ' ' + signed(pctS, mReal) : ''}</span>`; })() : ''}</div>
     ${DO === '2' || DO === '3' ? divLine : ''}
     <div class="gll gsub">${['BRL', 'GBP', 'USD'].filter((c) => c !== heroCur).map((c) => `<span class="money">${HM[c](P.total)}</span>`).join('&nbsp;&nbsp;')}</div>
     ${(() => { // lifetime profit/loss of what you hold: every asset and coin with an average price, against what it cost
       let cost = 0, pl = 0; for (const k of ['acoes', 'fiis', 'stocks']) for (const r of assetRows(k)) if (r.cost !== null) { cost += r.cost; pl += r.pl; }
       const u = num(DB.prices.usdbrl); if (cs.plTot) { cost += cs.plTot.cost * u; pl += cs.plTot.pl * u; }
       if (!cost) return '';
       return `<div class="glife"><span class="gll">Lucro total</span><span class="plx"><span class="plp ${pl < 0 ? 'dn' : 'up'}">${pl < 0 ? '▼' : '▲'} ${pct(Math.abs(pl / cost))}</span><span class="plv money">${signed(CV, pl)}</span></span></div>`; })()}
     <div id="spark-tap" class="gspark">${spark}</div>
   </div>

    </div>
    <div data-k="rumo" class="gpage">
   <div class="gl">
     <div class="gmeta">
       <svg width="104" height="104" viewBox="0 0 110 110" aria-hidden="true"><circle cx="55" cy="55" r="${R0}" fill="none" stroke="var(--g-track)" stroke-width="9"/>
         <circle cx="55" cy="55" r="${R0}" fill="none" class="garc" stroke="url(#gmg)" stroke-width="9" stroke-linecap="round" stroke-dasharray="${(C0 * prog).toFixed(1)} ${C0.toFixed(1)}" transform="rotate(-90 55 55)"/>
         <defs><linearGradient id="gmg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--g-acc1)"/><stop offset="1" stop-color="var(--g-acc2)"/></linearGradient></defs>
         <text x="55" y="60" text-anchor="middle" class="gring">${(prog * 100).toFixed(1).replace('.', ',')}%</text></svg>
       <div style="min-width:0;flex:1"><div class="gll">Rumo a ${brl(meta)}</div><div class="gfalta">faltam <span class="money">${CV(pr.falta)}</span></div>
       <div class="gpred">${pr.ritmo ? `<div><b>${ymLabel(pr.ritmo)}</b><span>no ritmo atual</span></div>` : ''}${pr.cenario ? `<div><b>${ymLabel(pr.cenario)}</b><span>no plano<em class="money">${gbp(s.aportePlanGBP)} por mês</em></span></div>` : ''}${!pr.ritmo && !pr.cenario ? '<div><b>—</b><span>precisa de 12 meses salvos</span></div>' : ''}</div></div>
     </div>
     <div class="gms">${win.map((m) => `<div class="${m.hit ? 'ok' : m === nextMs ? 'nx' : ''}"><b></b>${msL(m.v)}${m === nextMs && etaMs ? `<small>${ymLabel(etaMs)}</small>` : ''}</div>`).join('')}</div>
   </div>


    </div>
    <div data-k="cripto" class="gpage">
   <div class="gl click gcpage" onclick="location.hash='#cripto'">
     <div class="glh"><span class="gll">Cripto</span>${typeof c24 === 'number' ? `<span class="gc24 ${c24 < 0 ? 'neg' : 'pos'}">${c24 < 0 ? '▼' : '▲'} ${pct(Math.abs(c24))} <small>24h</small></span>` : ''}</div>
     <div class="gtot money gctot">${CV(cs.totalBRL)}</div>
     <div class="gcrows">${cs.coins.filter((x) => x.units > 1e-8).sort((a, b) => b.valUSD - a.valUSD).slice(0, 4).map((x) => { const ch = DB.prices[x.k + '_24h']; return `<div><span class="gcn">${x.k}</span><span class="money gcv">${CV(x.valUSD * num(DB.prices.usdbrl))}</span><b>${usd(DB.prices[x.k], DB.prices[x.k] < 100 ? 2 : 0)}</b>${typeof ch === 'number' ? `<span class="${ch < 0 ? 'neg' : 'pos'}">${ch < 0 ? '▼' : '▲'}${pct(Math.abs(ch) / 100)}</span>` : '<span></span>'}</div>`; }).join('')}</div>
   </div>
    </div>
   </div>
   <div class="gdots" id="gdots"><i data-i="0"></i><i data-i="1"></i><i data-i="2"></i></div>
   <div data-k="onde" class="gl">
     <div class="gll">Onde está</div>
     ${cats.map((c) => `<div class="grow click" onclick="${GO[c.k]}"><div class="grl"><span class="gdot" style="background:${GC[c.k]}"></span><span class="gn">${c.n}</span><span class="gvs money">${CV(c.v)}</span><span class="gpb">${pct(P.total ? c.v / P.total : 0).replace(/(\d),(\d)\d%/, '$1,$2%')}</span><span class="gch">›</span></div>
       ${c.cur !== null ? `<div class="gbl"><div class="gtrk"><i style="width:${Math.min(100, (c.cur / 0.5) * 100).toFixed(1)}%;background:${GC[c.k]}"></i><span style="left:${Math.min(100, (c.tgt / 0.5) * 100).toFixed(1)}%"></span></div><span class="gtl1 ${c.cur < c.tgt ? 'gbelow' : ''}">${c.cur < c.tgt ? `faltam <span class="money">${CV(c.tgt * (P.total - num(DB.balances.caixa)) - c.v)}</span>` : 'acima da meta'}</span></div>` : '<div class="gbl"><span class="gtl1">fora das metas</span></div>'}</div>`).join('')}
   </div>

   ${divCard.replace('<div class="gl', '<div data-k="div" class="gl')}
   <div data-k="perf" class="gl click" id="k-perf">
     <div class="glh"><span class="gll">Desempenho · sem aportes · em ${BSYM()}</span><span class="gll">ⓘ</span></div>
     <div class="perf2">
       <div><div class="gll">${MONTHS[new Date().getMonth()]}</div>
         ${prevM && mReal !== null ? `<div class="pv ${mReal < 0 ? 'neg' : 'pos'}">${signed(pct, mReal)}</div><div class="gll"><span class="money">${signed(CV, fromB(mRealV ?? 0))}</span>${mLoc ? ` · sem câmbio ${signed(pct, mLoc.r)}` : ''}</div>`
           : `<div class="pv">–</div><div class="gll">${prevM ? 'informe o aporte do mês' : 'precisa de um mês salvo'}</div>`}</div>
       <div><div class="gll">${st.year}</div>
         ${Ry ? `<div class="pv ${Ry.r < 0 ? 'neg' : 'pos'}">${signed(pct, Ry.r)}</div><div class="gll">${Ry.n} ${Ry.n === 1 ? 'mês' : 'meses'}${Ry.full && Ry.rl !== null ? ` · sem câmbio ${signed(pct, Ry.rl)}` : ''}</div>`
           : '<div class="pv">–</div><div class="gll">começa com os aportes</div>'}</div>
     </div>
     ${bars}<div class="pb3sel" id="pb3sel"></div>
   </div>

  </div>`;
  { const r = $('#mrow'), k = ms.indexOf(nextMs); if (r && k > 0) r.scrollLeft = Math.max(0, (k - 2) * 70); }   // show the last 2 reached + the next one
  $$('[data-do]').forEach((b) => (b.onclick = () => { try { localStorage.setItem('rumo.divopt', b.dataset.do); } catch {} render(); }));
  $('#cur-swap').onclick = (e) => { e.stopPropagation(); const nx = { BRL: 'GBP', GBP: 'USD', USD: 'BRL' }[heroCur]; try { localStorage.setItem('rumo.cur', nx); } catch {} render(); };
  $('#p-eye') && ($('#p-eye').onclick = (e) => { e.stopPropagation(); $('#btn-eye').click(); });
  countUp($('#gpg [data-k="pat"] .gtot'), P.total, HM[heroCur], heroCur);
  { const g = $('#gpg'), dots = $$('#gdots i'); if (g) {
    // endless: a copy of the last card sits before the first and a copy of the first after the last; landing on a copy jumps to the real card
    applyOrder(g, 'painel_top');
    const pages = [...g.children], N = pages.length, cp = (el) => { const c = el.cloneNode(true); c.querySelectorAll('[id]').forEach((x) => x.removeAttribute('id')); c.setAttribute('aria-hidden', 'true'); return c; };
    g.insertBefore(cp(pages[N - 1]), pages[0]); g.appendChild(cp(pages[0]));
    const W = () => g.children[0].offsetWidth + 12, real = (i) => (((i - 1) % N) + N) % N, mark = (k) => dots.forEach((d, n) => d.classList.toggle('on', n === k));
    const jump = (i) => { g.style.scrollSnapType = 'none'; g.scrollLeft = i * W(); requestAnimationFrame(() => { g.style.scrollSnapType = ''; }); };
    jump(PG_I + 1); mark(PG_I);
    const settle = () => { const i = Math.round(g.scrollLeft / W()); if (i === 0) jump(N); else if (i === N + 1) jump(1); PG_I = real(i); mark(PG_I); };
    let t = null; g.addEventListener('scroll', () => { mark(real(Math.round(g.scrollLeft / W()))); clearTimeout(t); t = setTimeout(settle, 140); }, { passive: true });
    if ('onscrollend' in window) g.addEventListener('scrollend', () => { clearTimeout(t); settle(); });
    dots.forEach((d) => (d.onclick = () => g.scrollTo({ left: (Number(d.dataset.i) + 1) * W(), behavior: 'smooth' }))); } }
  $('#spark-tap') && ($('#spark-tap').onclick = (e) => { e.stopPropagation(); patSheet(); });
  $('.dchip') && ($('.dchip').onclick = (e) => { e.stopPropagation(); todaySheet(CV); });
  { const sel = $('#pb3sel'), cs = $$('.pb3 .c'), show = (c) => { cs.forEach((x) => x.classList.toggle('sel', x === c)); const r = c.dataset.br; sel.innerHTML = `${ymLong(c.dataset.bm)}${c.dataset.bm === ym() ? ' · em andamento' : ''} <b class="${r === '' ? '' : Number(r) < 0 ? 'neg' : 'pos'}">${r === '' ? 'sem dados' : signed(pct, Number(r))}</b>`; };
    cs.forEach((c) => (c.onclick = (e) => { e.stopPropagation(); show(c); })); cs.length && show(cs[cs.length - 1]); }
  $('#mchip') && ($('#mchip').onclick = (e) => { e.stopPropagation(); const L = (DB.apLog || []).filter((x) => x.date.slice(0, 7) === ym()), apR = L.reduce((t, x) => t + apBRL(x), 0);
    toast(`${MONTHS[new Date().getMonth()]}: ${signed(CV, mChg)} desde o fim de ${MONTHS[(new Date().getMonth() + 11) % 12].toLowerCase()}${L.length ? ` · inclui ${apR < 0 ? 'retirada' : 'aporte'} de ${CV(Math.abs(apR))}` : ''}${mRealV !== null ? ` · sem aportes ${signed(CV, mRealV)}` : ''}`, 6000); });
  $('#hero-tap') && ($('#hero-tap').onclick = () => { try { localStorage.setItem('rumo.hero', heroOpen() ? '0' : '1'); } catch {} render(); });
  $('#k-perf').onclick = () => {
    if (!prevM) return;
    const from = { v: prevM.pat, c: prevM.cat || null }, D = DB.daily || [], base = [...D].filter((x) => x.d < ym() + '-01').pop();
    const fromB = base && base.c && (new Date(ym() + '-01') - new Date(base.d)) / 864e5 <= 7 ? { v: base.v, c: base.c } : from;
    const B = growthBreak(fromB, { v: P.total, c: catNow(P) }, num(apNowGBP) * num(DB.prices.gbpbrl), divNow, mLoc);
    openSheet(breakHtml(B, MONTHS[new Date().getMonth()] + ' até agora', 'desde ' + ymLong(prevM.month) + ' · ao vivo').replace('<button class="btn block" onclick="closeSheet()"', yearTable() + '<button class="btn block" onclick="closeSheet()"'));
  };
}

let patChart = null;
async function patSheet() {
  const hp = DB.history.filter((h) => typeof h.pat === 'number'), D = DB.daily || [], first = D[0]?.d, ts = (d) => new Date(d + 'T12:00').getTime(), pr = DB.prices;
  const cur = (() => { try { return localStorage.getItem('rumo.cur') || 'BRL'; } catch { return 'BRL'; } })();
  const conv = (v, g, u) => (cur === 'GBP' ? v / (g || pr.gbpbrl || 1) : cur === 'USD' ? v / (u || pr.usdbrl || 1) : v), fmt = cur === 'GBP' ? gbp : cur === 'USD' ? usd : brl;
  const all = [...hp.filter((h) => !first || h.month < first.slice(0, 7)).map((h) => { const [y, m] = h.month.split('-').map(Number); return { x: new Date(y, m, 0, 12).getTime(), y: conv(h.pat, h.fx) }; }),
    ...D.map((x) => ({ x: ts(x.d), y: conv(x.v, x.g, x.u) }))];
  const build = (rg) => { const pts = rg === 'all' ? all : all.filter((q) => q.x >= Date.now() - Number(rg) * 864e5); const span = pts.length > 1 ? pts[pts.length - 1].x - pts[0].x : 0;
    return { pts, dl: (v) => { const d = new Date(v); return span > 200 * 864e5 ? MON3[d.getMonth()] + '/' + String(d.getFullYear()).slice(2) : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); } }; };
  const stats = (pts) => { if (!pts.length) return ''; const mx = pts.reduce((a, q) => (q.y > a.y ? q : a), pts[0]), d = (x) => new Date(x).toLocaleDateString('pt-BR', { month: '2-digit', year: '2-digit' });
    return [['início', pts[0]], ['agora', pts[pts.length - 1]], ['máximo', mx]].map(([l, q]) => `<div><span class="small muted">${l}</span><b class="money">${fmt(q.y)}</b><span class="small muted">${d(q.x)}</span></div>`).join(''); };
  const rg0 = patRange(), b0 = build(rg0);
  openSheet(`<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h3 style="margin:0">Patrimônio</h3>
      <div class="seg mini">${[['30', '30d'], ['90', '90d'], ['365', '1a'], ['all', 'Tudo']].map(([k, l]) => `<button class="${rg0 === k ? 'on' : ''}" data-rg="${k}">${l}</button>`).join('')}</div></div>
    <div class="pstats" id="ps">${stats(b0.pts)}</div><div class="chart-box" style="height:280px"><canvas id="ch-pat2"></canvas></div>
    <div class="small muted" style="margin:6px 0 12px">Antes do registro diário, os meses do Histórico. Toque na linha para ver cada ponto.</div>
    <button class="btn block" onclick="closeSheet()">Fechar</button>`, async (el) => {
    if (!window.Chart) { try { await loadScript('chart.umd.js'); } catch { try { await loadScript('https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js'); } catch { return; } } }
    Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif'; Chart.defaults.color = cssVar('--muted');
    patChart?.destroy();
    const gv = (n) => getComputedStyle(document.body).getPropertyValue(n).trim(), acc = gv('--g-acc1') || '#E9DFC9', acc2 = gv('--g-acc2') || '#C9B087';
    Chart.defaults.color = gv('--g-mut') || cssVar('--muted');
    const fillG = (ctx) => { const { chart } = ctx, a = chart.chartArea; if (!a) return 'transparent'; const g = chart.ctx.createLinearGradient(0, a.top, 0, a.bottom); g.addColorStop(0, acc2 + '55'); g.addColorStop(1, acc2 + '00'); return g; };
    patChart = new Chart($('#ch-pat2', el), { type: 'line', data: { datasets: [{ data: b0.pts, borderColor: acc, backgroundColor: fillG, fill: true, pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: acc, tension: .25, borderWidth: 2 }] },
      options: { maintainAspectRatio: false, parsing: false, animation: { duration: 350 }, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false }, tooltip: { callbacks: { title: (c) => new Date(c[0].raw.x).toLocaleDateString('pt-BR'), label: (c) => fmt(c.raw.y) } } },
        scales: { x: { type: 'linear', min: b0.pts[0]?.x, max: b0.pts[b0.pts.length - 1]?.x, grid: { display: false }, ticks: { maxTicksLimit: 5, callback: b0.dl } }, y: { grid: { color: gv('--g-bd') || cssVar('--line') }, border: { display: false }, ticks: kTicks } } } });
    $$('[data-rg]', el).forEach((b) => (b.onclick = () => { const rg = b.dataset.rg; try { localStorage.setItem('rumo.range', rg); } catch {}
      $$('[data-rg]', el).forEach((x) => x.classList.toggle('on', x === b)); const n = build(rg), ds = patChart.data.datasets[0];
      ds.data = n.pts; Object.assign(patChart.options.scales.x, { min: n.pts[0]?.x, max: n.pts[n.pts.length - 1]?.x }); patChart.options.scales.x.ticks.callback = n.dl; patChart.update('none'); /* redraw straight away: animating between ranges of different lengths made the line jump */ $('#ps', el).innerHTML = stats(n.pts); }));
  });
}
const patRange = () => { try { return localStorage.getItem('rumo.range') || 'all'; } catch { return 'all'; } };
function yearsList() {
  const H = DB.history; if (!H.length) return [String(new Date().getFullYear())];
  const a = Number(H[0].month.slice(0, 4)), b = Math.max(Number(H[H.length - 1].month.slice(0, 4)), new Date().getFullYear());
  return Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
}

/* ----- Atualizar ----- */
// calendar-style month picker: a year with ‹ › and 12 month tiles; saved months get a green dot
function pickMonth(sel, onPick) {
  const max = ymAdd(ym(), 1), min = DB.history[0]?.month || ymAdd(ym(), -12);
  let year = Number(sel.slice(0, 4));
  const draw = (el) => {
    const yMin = Number(min.slice(0, 4)), yMax = Number(max.slice(0, 4));
    el.innerHTML = `<h3 style="margin-bottom:4px">Mês de referência</h3>
      <div class="mp-head"><button class="icon-btn" data-y="-1" ${year <= yMin ? 'disabled' : ''}>‹</button><b>${year}</b><button class="icon-btn" data-y="1" ${year >= yMax ? 'disabled' : ''}>›</button></div>
      <div class="mp-grid">${MONTHS.map((n, i) => { const m = year + '-' + String(i + 1).padStart(2, '0'), off = m > max || m < min, saved = DB.history.some((h) => h.month === m);
        return `<button class="mp-m ${m === sel ? 'on' : ''} ${m === ym() ? 'now' : ''}" data-m="${m}" ${off ? 'disabled' : ''}>${n.slice(0, 3)}${saved ? '<i></i>' : ''}</button>`; }).join('')}</div>
      <div class="small muted" style="margin:10px 0"><span style="color:var(--green)">●</span> já salvo no Histórico · borda azul = mês atual</div>
      <button class="btn block" id="mp-cancel">Cancelar</button>`;
    $$('[data-y]', el).forEach((b) => (b.onclick = () => { year += Number(b.dataset.y); draw(el); }));
    $$('[data-m]', el).forEach((b) => (b.onclick = () => { closeSheet(); if (b.dataset.m !== sel) onPick(b.dataset.m); }));
    $('#mp-cancel', el).onclick = closeSheet;
  };
  openSheet('<div id="mp"></div>', (el) => draw($('#mp', el)));
}
function monthOptions(sel, onlyMissing) {
  const first = DB.history[0]?.month || ymAdd(ym(), -12), out = [];
  let last = ymAdd(ym(), 1); if (sel && sel > last) last = sel;
  for (let m = last; m >= first; m = ymAdd(m, -1)) {
    if (onlyMissing && DB.history.find((h) => h.month === m)) continue;
    out.push(`<option value="${m}" ${m === sel ? 'selected' : ''}>${ymLong(m)}</option>`);
  }
  return out.join('');
}
const DECS = { 'p.gbpbrl': 4, 'p.usdbrl': 4, 'p.XRP': 4 };
const showNum = (key, v) => (v === null || v === undefined || v === '' ? '' :
  Number(v).toLocaleString('pt-BR', { useGrouping: true, maximumFractionDigits: DECS[key] ?? (key.startsWith('pre.') || key.startsWith('fee.') ? 8 : 2) }));
// pt-BR numbers: "." = thousands, "," = decimals. The keypad's "." or "," both start the decimals.
function fmtN(v, d) { return v === null || v === undefined || v === '' || !isFinite(v) || Number(v) === 0 ? '' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: d }); }
function parsePT(s) {
  s = String(s ?? '').replace(/\s|R\$|£|US\$/g, ''); if (!s) return null;
  const v = Number(s.replace(/\./g, '').replace(',', '.')); return isFinite(v) ? v : null;
}
function liveFormat(inp) {
  inp.addEventListener('input', (e) => {
    let v = inp.value;
    if (e.data === '.' || e.data === ',') { const pos = inp.selectionStart; v = v.slice(0, pos - 1).replace(/,/g, '') + ',' + v.slice(pos).replace(/,/g, ''); }
    const neg = v.trim().startsWith('-'), parts = v.split(',');
    let int = parts[0].replace(/\D/g, '').replace(/^0+(?=\d)/, ''); const dec = parts.slice(1).join('').replace(/\D/g, '');
    if (!int && parts.length > 1) int = '0';
    inp.value = (neg ? '-' : '') + int.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (parts.length > 1 ? ',' + dec : '');
  });
}
function fieldRow(label, key, val, hint, calc) {
  return `<div class="field"><label>${label}${hint ? `<small>${hint}</small>` : ''}</label>
    <div><input inputmode="decimal" data-k="${key}" value="${showNum(key, val)}">${calc ? `<div class="small calc" data-calc="${key}">${calc}</div>` : ''}</div></div>`;
}
function calcRow(label, cls) {
  return `<div class="field click" onclick="ATV.seg='${cls}';location.hash='#ativos'"><label>${label} <small>calculado em Ativos (preços ao vivo) ›</small></label><div class="calc">${brl(classTotal(cls))}</div></div>`;
}
let FXEDIT = false;   // exchange rates / coin prices are locked unless you tap ✎ Corrigir à mão
const ATU = { open: undefined };   // which checklist step is open (this session)
function vAtualizar() {
  const b = DB.balances, p = DB.prices, d = DB.draft, P = portfolio(), au = DB.settings.auto || {};
  const exists = DB.history.find((h) => h.month === d.month);
  const balAt = (DB.settings.balAt ||= {}), mStart = d.month + '-01';
  const fresh = (k) => balAt[k] && balAt[k].slice(0, 10) >= mStart;   // updated (or confirmed) in/after the month being closed
  const last = (k) => (balAt[k] ? new Date(balAt[k]).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : 'nunca');
  const mName = MONTHS[Number(d.month.slice(5)) - 1].toLowerCase();
  const balRow = (lab, key, val, conv) => fieldRow(lab, 'b.' + key, val, fresh(key) ? `<span class="okt">✓ conferido em ${last(key)}</span>`
    : `<span class="warn">conferir para ${mName}${balAt[key] ? ' · último em ' + last(key) : ''}</span>`, conv);
  // ---- step states
  const apN = (DB.apLog || []).filter((e) => e.date.slice(0, 7) === d.month).length;
  const s1 = apN > 0 || (d.aporteGBP !== null && d.aporteGBP !== undefined);
  const dvN = (DB.divLog || []).filter((e) => e.date.slice(0, 7) === d.month).length;
  const dvTot = num(d.divFII) + num(d.divAcoes) + num(d.divStocks) * num(p.gbpbrl);
  const s2 = dvN > 0 || d.divOk || ['divFII', 'divAcoes', 'divStocks'].some((f) => d[f] !== null && d[f] !== undefined);
  const manual = ['t212cash', 'rfBrasil', 'caixa'], s3 = manual.every(fresh);
  const nonAuto = [!au.acoes && 'acoes', !au.fiis && 'fiis', ...(!au.stocks ? ['pieStocks', 'pieReits', 'pieEtfs'] : [])].filter(Boolean);
  const s4 = nonAuto.every(fresh);
  const pxAge = p.updatedAt ? Date.now() - new Date(p.updatedAt) : Infinity, s5 = pxAge < 6 * 3600e3;
  const need = [s1, s2, s3, ...(nonAuto.length ? [s4] : [])], nNeed = need.length, nDone = need.filter(Boolean).length;
  if (ATU.open === undefined) ATU.open = 0;   // 2. every step starts closed
  const stepH = (k, ok, auto, title, sub, body) => `<div class="cs ${ATU.open === k ? 'open' : ''}">
      <div class="cs-h" data-step="${k}"><div class="ck ${ok ? (auto ? 'auto' : 'ok') : 'todo'}">${ok ? (auto ? 'AUTO' : '✓') : k}</div><div class="cs-t"><b>${title}</b><span>${sub}</span></div><span class="cs-c">${ATU.open === k ? '⌄' : '›'}</span></div>
      ${ATU.open === k ? `<div class="cs-b">${body}</div>` : ''}</div>`;
  const ae = lastAp(), de = lastDiv();
  const autoVal = (au.acoes ? P.v.acoes : 0) + (au.fiis ? P.v.fiis : 0) + (au.stocks ? P.v.stocks : 0);
  const mN = MONTHS[Number(d.month.slice(5)) - 1], isNow = d.month === ym();
  const apL = (DB.apLog || []).filter((e) => e.date.slice(0, 7) === d.month), apSum = apL.reduce((t, e) => t + num(e.gbp), 0);
  const bal = (lab, key, cur) => `<div class="au-bal"><div class="au-bl"><b>${lab}</b><small>${balAt[key] ? 'atualizado ' + last(key) : 'ainda não atualizado'}</small></div>
      <div class="au-in"><div class="au-f"><span>${cur === 'GBP' ? '£' : 'R$'}</span><input inputmode="decimal" data-k="b.${key}" value="${showNum('b.' + key, b[key])}"></div>${cur === 'GBP' ? `<small data-calc="b.${key}">${brl(num(b[key]) * num(p.gbpbrl))}</small>` : ''}</div></div>`;
  const dvL = (DB.divLog || []).filter((e) => e.date.slice(0, 7) === d.month), dvR = dvL.length ? dvL.reduce((t, e) => t + num(e.amount) * (e.cur === 'GBP' ? num(e.g || p.gbpbrl) : e.cur === 'USD' ? num(e.u || p.usdbrl) : 1), 0) : dvTot;
  const autoRow = (lab, cls) => `<div class="au-row click" onclick="ATV.seg='${cls}';location.hash='#ativos'"><span>${lab}</span><b>${brl(classTotal(cls))}</b><span class="gch">›</span></div>`;
  const endD = (() => { const n = ymAdd(d.month, 1); return '1º de ' + MONTHS[Number(n.slice(5)) - 1].toLowerCase(); })();
  $('#view').innerHTML = `
  <div class="gwrap au">
   <div data-k="pat" class="gl">
     <div class="glh"><span class="gll">Patrimônio de ${mN.toLowerCase()}</span><button class="gswap" id="f-month">${ymLabel(d.month)} <span class="gdown"></span></button></div>
     <div class="gtot money" id="f-total" style="font-size:34px">${brl(P.total)}</div>
     <div class="gll" id="f-cats" style="display:none"></div>
     <div class="au-st">${exists ? `<span class="au-ok">✓</span> salvo no Histórico${exists.savedAt ? ' em ' + new Date(exists.savedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : ''}${exists.auto ? ' (sozinho)' : ''}` : isNow ? `o app salva sozinho em ${endD}` : 'ainda não salvo'}</div>
   </div>

   <div data-k="act" class="au-act"><button class="gl" id="f-ap"><i><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></i><b>Aporte</b><small>ou retirada</small></button><button class="gl" id="f-div"><i><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></i><b>Dividendo</b><small>recebido</small></button></div>

   <div data-k="mes" class="gl">
     <div class="gll" style="margin-bottom:4px">Em ${mN.toLowerCase()}</div>
     <div class="au-row ${apL.length ? 'click' : ''}" id="f-ap-all"><span>Aportes</span><b>${apL.length ? `${apSum < 0 ? '−' : ''}${gbp(Math.abs(apSum))}` : d.aporteGBP === 0 ? 'nenhum' : '—'}</b><span class="gll">${apL.length ? `${apL.length}×` : d.aporteGBP === 0 ? '' : '<a href="#" id="f-ap0">não houve</a>'}</span>${apL.length ? '<span class="gch">›</span>' : ''}</div>
     <div class="au-row click" onclick="location.hash='#dividendos'"><span>Dividendos</span><b>${dvN || dvR ? brl(dvR) : '—'}</b><span class="gll">${dvN ? dvN + '×' : ''}</span><span class="gch">›</span></div>
   </div>

   <div data-k="saldos" class="gl">
     <div class="glh"><span class="gll">Saldos que você digita</span></div>
     ${bal('Trading 212 · caixa', 't212cash', 'GBP')}${bal('Renda fixa Brasil', 'rfBrasil', 'BRL')}${bal('Caixa', 'caixa', 'BRL')}
     ${!au.acoes ? bal('Ações', 'acoes', 'BRL') : ''}${!au.fiis ? bal('FIIs', 'fiis', 'BRL') : ''}${!au.stocks ? bal('Pie Stocks', 'pieStocks', 'GBP') + bal('Pie REITs', 'pieReits', 'GBP') + bal("Pie ETF's", 'pieEtfs', 'GBP') : ''}
   </div>

   <div data-k="auto" class="gl">
     <div class="glh"><span class="gll">Automático</span><span class="gll">${s5 ? 'atualizado ' + (fmtDate(p.updatedAt).split(' ')[1] || '') : '<span class="au-due">preços antigos</span>'}</span></div>
     ${au.acoes ? autoRow('Ações', 'acoes') : ''}${au.fiis ? autoRow('FIIs', 'fiis') : ''}${au.stocks ? autoRow('Exterior', 'stocks') : ''}
     <div class="au-row"><span>Libra <small class="gll">£1</small></span><b>R$ ${nf2.format(p.gbpbrl || 0)}</b><span class="gsp"></span></div>
     <div class="au-row"><span>Dólar <small class="gll">US$1</small></span><b>R$ ${nf2.format(p.usdbrl || 0)}</b><span class="gsp"></span></div>
     <div class="au-row click" onclick="location.hash='#cripto'"><span>Cripto</span><b class="money">${brl(P.v.crypto)}</b><span class="gch">›</span></div>
     <div id="fx-box" class="${FXEDIT ? 'au-fx' : 'hidden'}">${fieldRow('Libra → Real', 'p.gbpbrl', p.gbpbrl)}${fieldRow('Dólar → Real', 'p.usdbrl', p.usdbrl)}${COINS.map((c) => fieldRow(c.k + ' (US$)', 'p.' + c.k, p[c.k])).join('')}</div>
     <div class="au-two"><button class="gbtn2" id="f-prices"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/></svg> Buscar agora</button><button class="gbtn2" id="f-fxedit">${FXEDIT ? '✓ Pronto' : '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg> Corrigir'}</button></div>
   </div>

   ${isNow ? `<div class="gll" style="text-align:center;margin-top:4px">${mN} é salvo sozinho no ${endD}.</div>` : `<button class="gbtn2 au-save" id="f-save">Salvar ${mN.toLowerCase()}</button>
   <div class="gll" style="text-align:center;margin-top:-4px">O app não conseguiu fechar ${mN.toLowerCase()} sozinho (não foi aberto nos últimos dias do mês). Salve agora.</div>`}
  </div>`;
  if (!apL.length && $('#f-ap-all')) $('#f-ap-all').id = '';
  const stamp = async (keys) => { const t = new Date().toISOString(); for (const k of keys) balAt[k] = t; await save(); };
  $('#f-bal-ok') && ($('#f-bal-ok').onclick = async () => { await stamp([...manual, ...nonAuto]); toast('✓ Saldos conferidos'); render(); });
  $('#f-cls-ok') && ($('#f-cls-ok').onclick = async () => { await stamp(nonAuto); ATU.open = 0; render(); });
  $('#f-ap0') && ($('#f-ap0').onclick = async () => { d.aporteGBP = 0; await save(); ATU.open = 0; render(); });
  $('#f-div0') && ($('#f-div0').onclick = async () => { d.divOk = true; await save(); ATU.open = 0; render(); });
  $('#f-div') && ($('#f-div').onclick = () => editDiv(null));
  $('#f-ap') && ($('#f-ap').onclick = () => editAp(null));
  $('#f-ap-all') && ($('#f-ap-all').onclick = (e) => { e.preventDefault(); openApList(); });
  $('#f-ap0') && ($('#f-ap0').onclick = async (e) => { e.preventDefault(); e.stopPropagation(); d.aporteGBP = 0; await save(); render(); });
  $('#f-month').onclick = () => pickMonth(d.month, async (m) => {
    const h = DB.history.find((x) => x.month === m);
    DB.draft = { month: m, divFII: h?.divFII ?? null, divAcoes: h?.divAcoes ?? null, divStocks: h?.divStocks ?? null, aporteGBP: h?.aporteGBP ?? null };
    applyDivLog(m); applyApLog(m); ATU.open = undefined; await save(); render();
  });
  // live: every key typed updates the value, the totals on this page and is saved a moment later
  let saveT = null;
  const liveTotals = () => { const P3 = portfolio(); $('#f-total') && ($('#f-total').textContent = brl(P3.total));
    $('#f-cats') && ($('#f-cats').textContent = P3.alloc.map((a) => a.n + ' ' + brl(a.v)).join(' · ') + ' · Caixa ' + brl(num(DB.balances.caixa)));
    const gb = (k) => num(DB.balances[k]) * num(DB.prices.gbpbrl);
    for (const k of ['t212cash', 'pieStocks', 'pieReits', 'pieEtfs']) { const c = $(`[data-calc="b.${k}"]`); if (c) c.textContent = brl(gb(k)); } };
  $$('#view input[data-k]').forEach((inp) => inp.addEventListener('input', () => {
    const [grp, key] = inp.dataset.k.split('.'); if (grp !== 'b') return; const v = parsePT(inp.value);
    DB.balances[key] = v ?? 0; balAt[key] = new Date().toISOString(); liveTotals();
    clearTimeout(saveT); saveT = setTimeout(() => save(), 700);
  }));
  $$('#view input[data-k]').forEach((inp) => inp.addEventListener('change', async () => {
    const [grp, key] = inp.dataset.k.split('.'); const v = parsePT(inp.value);
    const target = grp === 'p' ? DB.prices : grp === 'b' ? DB.balances : DB.draft;
    target[key] = grp === 'd' ? v : (v ?? 0);
    if (grp === 'b') { balAt[key] = new Date().toISOString(); inp.value = showNum(inp.dataset.k, target[key]);   // no full redraw: a tap on a button right after typing still works
      const st = inp.closest('.au-bal')?.querySelector('.au-bl small'); if (st) { st.textContent = 'atualizado ' + last(key); st.classList.remove('au-due'); }
      await save(); return; }
    await save(); render();
  }));
  $('#f-prices') && ($('#f-prices').onclick = () => refreshPrices(false));
  $('#f-fxedit') && ($('#f-fxedit').onclick = () => { FXEDIT = !FXEDIT; render(); if (FXEDIT) setTimeout(() => $('#fx-box input')?.focus(), 50); });
  $('#f-save') && ($('#f-save').onclick = async () => {
    const P2 = portfolio(), d2 = DB.draft;
    if (d2.aporteGBP === null || d2.aporteGBP === undefined) {
      if (!(await ask('Você não preencheu o aporte. Salvar como £0 (nenhum dinheiro novo este mês)?'))) return;
      d2.aporteGBP = 0;
    }
    const entry = { month: d2.month, pat: Math.round(P2.total * 100) / 100, aporteGBP: d2.aporteGBP, divFII: d2.divFII, divAcoes: d2.divAcoes, divStocks: d2.divStocks, fx: DB.prices.gbpbrl || null, usd: DB.prices.usdbrl || null, cat: catNow(P2), nat: natNow(P2), savedAt: new Date().toISOString() };
    const i = DB.history.findIndex((h) => h.month === d2.month);
    if (i > -1) { if (!(await ask(`${ymLong(d2.month)} já existe. Substituir?`))) return; entry.note = DB.history[i].note; DB.history[i] = entry; }
    else DB.history.push(entry);
    DB.history.sort((a, b2) => a.month.localeCompare(b2.month));
    const nextM = ymAdd(d2.month, 1);
    await save(); doneTick(); toast(`✓ ${ymLong(d2.month)} salvo`);
    if (await ask(`Começar ${ymLong(nextM)} agora? (os campos de dividendos e aporte ficam vazios)`)) {
      DB.draft = { month: nextM, divFII: null, divAcoes: null, divStocks: null, aporteGBP: null }; applyDivLog(nextM); applyApLog(nextM); ATU.open = undefined; await save();
    }
    render();
  });
}

/* ----- Histórico ----- */
function vHistorico() {
  const H = histLive(), R = returnsData(), rByM = Object.fromEntries(R.months.map((m) => [m.month, m])), rByY = Object.fromEntries(R.years.map((y) => [y.year, y]));
  const years = [...new Set(H.map((h) => h.month.slice(0, 4)))].sort().reverse();
  let sel = years[0]; try { const v = localStorage.getItem('rumo.hsel'); if (years.includes(v) || v === 'all') sel = v; } catch {}
  const ALL = sel === 'all';
  // every amount in the currency chosen with ⇄ (same as the Painel), each month at its own rates
  let hc = 'BRL'; try { hc = { BRL: 1, GBP: 1, USD: 1 }[localStorage.getItem('rumo.cur')] ? localStorage.getItem('rumo.cur') : 'BRL'; } catch {}
  const pr = DB.prices, F = hc === 'GBP' ? gbp : hc === 'USD' ? usd : brl, sym = { BRL: 'R$', GBP: '£', USD: 'US$' }[hc];
  const cv = (v, h) => (hc === 'GBP' ? v / num(h?.fx || pr.gbpbrl || 1) : hc === 'USD' ? v / num(h?.usd || pr.usdbrl || 1) : v);
  const apC = (h) => { if (h.aporteGBP === null || h.aporteGBP === undefined) return null; if (hc === 'GBP') return num(h.aporteGBP); const b = apMonthBRL(h.month, h.fx || pr.gbpbrl, h.aporteGBP); return hc === 'USD' ? b / num(h.usd || pr.usdbrl || 1) : b; };
  const pts = H.filter((h) => typeof h.pat === 'number');
  const lastP = pts[pts.length - 1], firstP = pts[0];
  const M = ALL ? H : H.filter((h) => h.month.startsWith(sel)), Y = ALL ? { r: R.total, n: R.months.length } : rByY[sel], prevEnd = [...pts].filter((h) => h.month < sel + '-01').pop(), lastM = [...M].reverse().find((h) => typeof h.pat === 'number');
  const ap = M.reduce((a, h) => a + num(apC(h)), 0), dv = M.reduce((a, h) => a + cv(divTotal(h), h), 0), ro = Y ? Y.r : null;
  const chg = ALL ? (firstP && lastP && firstP !== lastP ? cv(lastP.pat, lastP) - cv(firstP.pat, firstP) : null) : lastM && prevEnd ? cv(lastM.pat, lastM) - cv(prevEnd.pat, prevEnd) : null;
  const mx = Math.max(0.01, ...M.map((h) => { const r = rByM[h.month]; return r ? Math.abs(r.r) : 0; }));
  const yRows = () => { const yr = years.map((y) => { const Yy = rByY[y], r = Yy ? Yy.r : null, lm = [...H].reverse().find((h) => h.month.startsWith(y) && typeof h.pat === 'number'), n = H.filter((h) => h.month.startsWith(y)).length; return { y, r, lm, n }; }), m2 = Math.max(0.01, ...yr.map((x) => Math.abs(x.r || 0)));
    return yr.map(({ y, r, lm, n }) => `<div class="hm click" data-y="${y}"><div class="hm-l"><b>${y}</b><small>${n} ${n === 1 ? 'mês' : 'meses'}</small></div>
      <div class="hm-b">${r !== null ? `<i class="${r < 0 ? 'neg' : 'pos'}" style="width:${Math.max(4, (Math.abs(r) / m2) * 100).toFixed(0)}%"></i>` : ''}</div>
      <div class="hm-r"><b class="money">${lm ? F(cv(lm.pat, lm)) : '–'}</b><small class="${r === null ? '' : r < 0 ? 'neg' : 'pos'}">${r !== null ? signed(pct, r) : '—'}</small></div><span class="gch">›</span></div>`).join(''); };
  const rows = ALL ? yRows() : [...M].reverse().map((h) => { const rm = rByM[h.month], r = rm ? rm.r : null, w = r === null ? 0 : Math.max(4, (Math.abs(r) / mx) * 100);
    return `<div class="hm click" data-m="${h.month}"><div class="hm-l"><b>${MONTHS[Number(h.month.slice(5)) - 1]}</b><small>${h.live ? '<span class="hlive">até hoje</span> · ' : ''}${h.aporteGBP ? (h.aporteGBP < 0 ? 'retirada ' : 'aporte ') + F(Math.abs(apC(h))) : h.aporteGBP === 0 ? 'sem aporte' : 'aporte não informado'}</small></div>
      <div class="hm-b">${r !== null ? `<i class="${r < 0 ? 'neg' : 'pos'}" style="width:${w.toFixed(0)}%"></i>` : ''}</div>
      <div class="hm-r"><b class="money">${typeof h.pat === 'number' ? F(cv(h.pat, h)) : '–'}</b><small class="${r === null ? '' : r < 0 ? 'neg' : 'pos'}">${r !== null ? signed(pct, r) : '—'}</small></div><span class="gch">›</span></div>`; }).join('');
  $('#view').innerHTML = `<div class="gwrap hi">
   <div class="gl">
     <div class="glh"><span class="gll">${lastP?.live ? 'Patrimônio hoje' : 'Patrimônio no fim de ' + (lastP ? ymLong(lastP.month).toLowerCase() : '')}</span><button class="gswap" id="h-swap" aria-label="Trocar moeda"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/></svg> ${sym}</button></div>
     <div class="gtot money" style="font-size:30px">${lastP ? F(cv(lastP.pat, lastP)) : '–'}</div>
     ${(() => { const y1 = lastP && pts.find((h) => h.month === ymAdd(lastP.month, -12)); if (!y1) return ''; const d = cv(lastP.pat, lastP) - cv(y1.pat, y1);
       return `<div class="gll" style="margin-top:4px"><span class="${d < 0 ? 'neg' : 'pos'}">${signed(F, d)}</span> desde ${ymLong(y1.month).toLowerCase()}, contando os aportes</div>`; })()}
   </div>
   ${years.length ? `<div class="hy"><button data-y="all" class="hall ${ALL ? 'on' : ''}">Tudo</button>${years.map((y) => `<button data-y="${y}" class="${y === sel ? 'on' : ''}">${y}</button>`).join('')}</div>
   <div class="gl">
     <div class="hsum">
       <div class="click" id="h-rend"><div class="gll">Rendimento${ALL ? '' : ' ' + sel} <svg class="hinfo" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9.5"/><path d="M12 11v5.5M12 7.6v.1"/></svg></div><b class="${ro === null ? '' : ro < 0 ? 'neg' : 'pos'}">${ro !== null ? signed(pct, ro) : '—'}</b>${Y && M.length && Y.n < M.filter((h) => typeof h.pat === 'number').length - (ALL ? 1 : 0) ? `<small class="hmeas">${Y.n} de ${M.filter((h) => typeof h.pat === 'number').length - (ALL ? 1 : 0)} meses</small>` : ''}</div>
       <div><div class="gll">Aportes</div><b class="money">${F(ap)}</b></div>
       <div><div class="gll">Dividendos</div><b class="money">${F(dv)}</b></div>
     </div>
     <div class="hpop" id="h-pop" hidden>Rendimento = só o resultado dos investimentos, sem aportes, medido em ${BSYM()} (com o câmbio).${chg !== null ? `<br>O patrimônio total ${chg < 0 ? 'caiu' : 'subiu'} <span class="money">${F(Math.abs(chg))}</span> ${ALL ? 'desde ' + ymLabel(firstP.month) : 'no ano'}, contando os aportes.` : ''}</div>
   </div>
   <div class="gl hlist">${rows}</div>` : '<div class="gl"><div class="gll">Nenhum mês salvo ainda. O app salva cada mês sozinho no dia 1º.</div></div>'}
   <button class="gbtn2" id="h-add"><svg style="vertical-align:-4px" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg> Adicionar mês à mão</button>
  </div>`;
  { const on = $('#view .hy .on'), bar = $('#view .hy'); if (on && bar) bar.scrollLeft = on.offsetLeft - bar.clientWidth / 2 + on.offsetWidth / 2; }   // keep the chosen year in view
  $$('#view .hy button').forEach((b) => (b.onclick = () => { try { localStorage.setItem('rumo.hsel', b.dataset.y); } catch {} render(); }));
  $$('#view .hm').forEach((el) => (el.onclick = () => { if (el.dataset.y) { try { localStorage.setItem('rumo.hsel', el.dataset.y); } catch {} render(); window.scrollTo(0, 0); } else monthCard(el.dataset.m); }));
  $('#h-add').onclick = () => editMonth(null);
  { const pop = $('#h-pop'), t = $('#h-rend'); if (pop && t) { t.onclick = (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; }; pop.onclick = () => { pop.hidden = true; }; } }
  $('#h-swap') && ($('#h-swap').onclick = () => { const nx = { BRL: 'GBP', GBP: 'USD', USD: 'BRL' }[hc]; try { localStorage.setItem('rumo.cur', nx); } catch {} render(); });
}
// tap a month in Histórico → summary card; tap outside to close, "Editar mês" for the form
function monthCard(m) {
  const HL = histLive(), i = HL.findIndex((h) => h.month === m), h = HL[i], prev = HL[i - 1]; if (!h) return;
  const varP = prev && typeof prev.pat === 'number' && typeof h.pat === 'number' && ymDiff(prev.month, h.month) === 1 ? h.pat - prev.pat : null;
  const ap = h.aporteGBP !== null && h.aporteGBP !== undefined && h.fx ? apMonthBRL(h.month, h.fx, h.aporteGBP) : null, rend = varP !== null && ap !== null ? varP - ap : null;
  const rm = returnsData().months.find((x) => x.month === m), nLog = (DB.divLog || []).filter((e) => e.date.slice(0, 7) === m).length;
  const row = (l, v, cls = '') => `<div class="mc-row"><span>${l}</span><b class="${cls}">${v}</b></div>`;
  const r = rm ? rm.r : null, rendC = rm ? fromB(rm.gain) : rend, rl = rm && rm.rl !== null && rm.rl !== undefined ? rm.rl : null, st = (l, v, cls = '') => `<div class="ps-step"><span>${l}</span><b class="${cls}">${v}</b></div>`;
  openSheet(`<div class="ps">
    <div class="ps-top"><div class="ps-sub">${prev ? 'vs ' + ymLong(prev.month) : 'primeiro mês'}</div><h3>${ymLong(m)}</h3>
      <div class="ps-big">${typeof h.pat === 'number' ? brl(h.pat) : '–'}</div>
      ${varP !== null ? `<div class="ps-sub">patrimônio ${varP < 0 ? 'caiu' : 'subiu'} <b class="${varP < 0 ? 'neg' : 'pos'}">${brl(Math.abs(varP))}</b> no mês</div>` : ''}</div>
    <div class="ps-card">
      ${st('Rendimento <small>em ' + BSYM() + '</small>', r !== null ? `${signed(pct, r)}${rendC !== null ? ' · ' + signed(brl, rendC) : ''}` : '<span class="muted">informe o aporte</span>', r === null ? '' : r < 0 ? 'neg' : 'pos')}
      ${rl !== null ? st('Sem câmbio <small>se a libra e o dólar não mudassem</small>', signed(pct, rl), rl < 0 ? 'neg' : 'pos') : ''}
      ${st(h.aporteGBP < 0 ? 'Retirada' : 'Aporte', h.aporteGBP === null || h.aporteGBP === undefined ? '—' : `${gbp(Math.abs(h.aporteGBP))}${ap ? ' <small>' + brl(Math.abs(ap)) + '</small>' : ''}`)}
      ${st('Dividendos', brl(divTotal(h), 2) + (nLog ? ` <small>${nLog}×</small>` : ''))}
      ${st('Câmbio', h.fx ? '£1 = R$ ' + nf2.format(h.fx) : '—')}
      ${h.note ? st('Nota', esc(h.note)) : ''}
    </div>
    ${prev && typeof prev.pat === 'number' && typeof h.pat === 'number' && ap !== null ? '<button class="btn block" id="mc-why" style="margin-top:14px">Por que subiu ou caiu?</button>' : ''}
    <div class="ask-b" style="margin-top:8px"><button class="btn" onclick="closeSheet()">Fechar</button><button class="btn primary" id="mc-edit">Editar mês</button></div></div>`, (el) => { $('#mc-edit', el).onclick = () => { closeSheet(); editMonth(m); };
    $('#mc-why', el) && ($('#mc-why', el).onclick = () => openSheet(breakHtml(growthBreak({ v: prev.pat, c: prev.cat }, { v: h.pat, c: h.cat }, ap, divTotal(h), h.live ? liveLocal(portfolio()) : localMonth(m)), ymLong(m), 'vs ' + ymLong(prev.month)))); });
}
function editMonth(m) {
  const h = m ? DB.history.find((x) => x.month === m) : { month: ym(), pat: null, aporteGBP: null, divFII: null, divAcoes: null, divStocks: null, fx: null, note: '' };
  const f = (label, k, v) => `<div class="field"><label>${label}</label><input data-e="${k}" inputmode="decimal" value="${v ?? ''}"></div>`;
  openSheet(`<h3>${m ? ymLong(m) : 'Novo mês'}</h3>
    ${m ? '' : `<div class="field"><label>Mês</label><select id="e-month">${monthOptions(h.month, true)}</select></div>`}
    ${f('Patrimônio (R$)', 'pat', h.pat)}${f('Aporte (£)', 'aporteGBP', h.aporteGBP)}${f('Div FIIs (R$)', 'divFII', h.divFII)}
    ${f('Div Ações (R$)', 'divAcoes', h.divAcoes)}${f('Div Stocks (£)', 'divStocks', h.divStocks)}${f('GBP/BRL do mês', 'fx', h.fx)}
    <div class="field"><label>Observação</label><input data-e="note" value="${esc(h.note || '')}" style="text-align:left"></div>
    <div class="small">Os dividendos dos Stocks só entram no total quando o mês tem o câmbio GBP/BRL.</div>
    <button class="btn primary block" id="e-save">Salvar</button>
    ${m ? '<button class="btn danger block" id="e-del">Apagar este mês</button>' : ''}
    <button class="btn block" onclick="closeSheet()">Cancelar</button>`, (el) => {
    $('#e-save', el).onclick = async () => {
      const out = { ...h };
      $$('[data-e]', el).forEach((i) => { out[i.dataset.e] = i.dataset.e === 'note' ? i.value : parseNum(i.value); });
      if (!m) {
        out.month = $('#e-month', el).value; if (!out.month) return toast('Escolha o mês');
        if (DB.history.find((x) => x.month === out.month)) return toast('Esse mês já existe — edite ele na lista');
        DB.history.push(out);
      } else DB.history[DB.history.indexOf(h)] = out;
      DB.history.sort((a, b) => a.month.localeCompare(b.month)); await save(); closeSheet(); render();
    };
    if (m) $('#e-del', el).onclick = async () => { if (!(await ask('Apagar ' + ymLong(m) + '?', { yes: 'Sim, apagar', danger: true }))) return; DB.history.splice(DB.history.indexOf(h), 1); await save(); closeSheet(); render(); };
  });
}

/* ----- Dividendos ----- */
function vDividendos() {
  const yrs = yearsList(), H = DB.history, thisY = String(new Date().getFullYear()), lastY = String(Number(thisY) - 1);
  const monthDiv = (m) => { const h = H.find((x) => x.month === m); if (h) return divTotal(h);
    if (DB.draft.month === m) return divTotal({ ...DB.draft, month: m, fx: DB.prices.gbpbrl }); return 0; };
  const cell = (y, mi) => monthDiv(`${y}-${String(mi + 1).padStart(2, '0')}`);
  let max = 0; yrs.forEach((y) => { for (let i = 0; i < 12; i++) max = Math.max(max, cell(y, i)); });
  const tot = yrs.map((y) => Array.from({ length: 12 }, (_, i) => cell(y, i)).reduce((a, b) => a + b, 0));
  const cnt = yrs.map((y) => Array.from({ length: 12 }, (_, i) => cell(y, i)).filter((v) => v > 0).length);
  const st = historyStats(), life = st.divLife, step = 10000;
  const mile = []; let acc = 0, k = 1, prevM = H[0]?.month;
  for (const h of H) { acc += divTotal(h); while (acc >= k * step) { mile.push({ v: k * step, m: h.month, n: ymDiff(prevM, h.month) }); prevM = h.month; k++; } }
  const last12 = Array.from({ length: 12 }, (_, i) => monthDiv(ymAdd(ym(), -i))).reduce((a, b) => a + b, 0);
  // this year vs the same months of last year
  const ty = Array.from({ length: 12 }, (_, i) => cell(thisY, i)), ly = Array.from({ length: 12 }, (_, i) => cell(lastY, i));
  const upTo = Math.max(0, ...ty.map((v, i) => (v > 0 ? i + 1 : 0))), tySum = ty.slice(0, upTo).reduce((a, b) => a + b, 0), lySum = ly.slice(0, upTo).reduce((a, b) => a + b, 0);
  const vs = lySum ? tySum / lySum - 1 : null, best = ty.reduce((b2, v, i) => (v > ty[b2] ? i : b2), 0), bMax = Math.max(1, ...ty, ...ly);
  // ranking by ticker
  let rk = 'mes'; try { rk = localStorage.getItem('rumo.rk') || 'mes'; } catch {}
  const from = rk === 'mes' ? ym() + '-01' : rk === '12m' ? ymAdd(ym(), -11) + '-01' : '0000';
  const byT = {}; for (const e of DB.divLog || []) { if (e.date < from) continue; const t = e.ticker || '(sem ticker)'; byT[t] = (byT[t] || 0) + divInField(e, 'divFII'); }
  const rank = Object.entries(byT).sort((a, b) => b[1] - a[1]), rMax = rank[0]?.[1] || 1;
  const rankRow = ([t, v], n) => `<div class="rk"><em>${n + 1}</em><b>${esc(t)}</b><div class="rkb"><i style="width:${(v / rMax) * 100}%"></i></div><span class="money">${brl(v, 2)}</span></div>`;
  const ld = lastDiv();
  let tblOpen = false; try { tblOpen = localStorage.getItem('rumo.dtbl') === '1'; } catch {}
  const nextV = (Math.floor(life / step) + 1) * step, mWin = [...mile.slice(-3).map((x) => ({ v: x.v, d: ymLabel(x.m), ok: true })), { v: nextV, d: 'faltam ' + nf0.format(Math.ceil(nextV - life)), ok: false }];
  $('#view').innerHTML = `<div class="gwrap dv">
   <div data-k="ano" class="gl">
     <div class="glh"><span class="gll">${thisY} até ${upTo ? MONTHS[upTo - 1].toLowerCase() : '–'}</span>${vs !== null ? `<span class="dchip ${vs < 0 ? 'neg' : 'pos'}">${vs < 0 ? '▼' : '▲'} ${pct(Math.abs(vs))} vs ${lastY}</span>` : ''}</div>
     <div class="gtot money dv-big">${brl(tySum)}</div>
     <div class="gll">média <span class="money">${brl(upTo ? tySum / upTo : 0)}</span>/mês${ty[best] ? ` · melhor: ${MONTHS[best].toLowerCase()}` : ''}</div>
     <div class="dvb2">${ty.map((v, i) => `<div class="c${i === new Date().getMonth() ? ' cur' : ''}" data-dm="${i}"><div class="bx"><i class="ly" style="height:${(ly[i] / bMax) * 100}%"></i><i class="ty" style="height:${(v / bMax) * 100}%"></i></div><span>${'JFMAMJJASOND'[i]}</span></div>`).join('')}</div>
     <div class="dvleg"><span><i class="ty"></i>${thisY}</span><span><i class="ly"></i>${lastY}</span><span id="dv-sel"></span></div>
   </div>

   <button data-k="add" class="gl dv-add" id="dv-add"><i><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></i><div><b>Dividendo recebido</b><small>${ld ? `último: ${dmy(ld.date)} · ${divLabel(ld)}${ld.ticker ? ' · ' + esc(ld.ticker) : ''}` : 'lance cada pagamento quando cair'}</small></div></button>

   <div data-k="vida" class="gl">
     <div class="glh"><span class="gll">Na vida</span><span class="gll">12 meses: <span class="money">${brl(last12)}</span></span></div>
     <div class="gk money" style="font-size:24px">${brl(life)}</div>
     <div class="gtrk" style="margin:10px 0 0"><i style="width:${(((life % step) / step) * 100).toFixed(1)}%;background:linear-gradient(90deg,var(--g-acc2),var(--g-acc1))"></i></div>
     <div class="gms" style="margin-top:12px">${mWin.map((m) => `<div class="${m.ok ? 'ok' : 'nx'}"><b></b>${nf0.format(m.v / 1000)} mil<small>${m.d}</small></div>`).join('')}</div>
   </div>

   <div data-k="quem" class="gl">
     <div class="glh"><span class="gll">Quem mais paga</span></div>
     <div class="hy dv-rk">${[['mes', 'Este mês'], ['12m', '12 meses'], ['all', 'Sempre']].map(([v, l]) => `<button class="${rk === v ? 'on' : ''}" data-rk="${v}">${l}</button>`).join('')}</div>
     ${rank.length ? rank.slice(0, 5).map(rankRow).join('') + (rank.length > 5 ? `<button class="gbtn2" id="rk-all">Ver todos (${rank.length})</button>` : '') : '<div class="gll" style="padding:8px 0">Nenhum dividendo neste período.</div>'}
   </div>

   <div data-k="ultimos" class="gl dvl">
     <div class="glh"><span class="gll">Últimos pagamentos</span></div>
     ${divLogList(5)}${(DB.divLog || []).length > 5 ? `<button class="gbtn2" id="dv-all">Ver todos (${DB.divLog.length})</button>` : ''}
   </div>

   <div data-k="tabela" class="gl">
     <div class="au-row click" id="tbl-tog" style="border:0;padding:2px 0"><span>Tabela por ano <small class="gll">${yrs[0]}–${yrs[yrs.length - 1]}</small></span><span class="gch">${tblOpen ? '⌄' : '›'}</span></div>
     ${tblOpen ? `<div class="tbl-wrap dvt" style="margin-top:10px"><table>
     <tr><th></th>${yrs.map((y) => `<th>${y}</th>`).join('')}</tr>
     ${MONTHS.map((mn, i) => `<tr><td>${MON3[i]}</td>${yrs.map((y) => { const v = cell(y, i); return `<td class="${v > 0 && v === max ? 'max' : ''}">${v ? nf0.format(v) : ''}</td>`; }).join('')}</tr>`).join('')}
     <tr class="tot"><td>Total</td>${tot.map((v) => `<td>${nf0.format(v)}</td>`).join('')}</tr>
     <tr><td>Média</td>${tot.map((v, i) => `<td>${cnt[i] ? nf0.format(v / cnt[i]) : ''}</td>`).join('')}</tr>
     <tr><td>Cresc.</td>${tot.map((v, i) => { const g = i && tot[i - 1] && cnt[i] === 12 ? v / tot[i - 1] - 1 : null; return `<td class="${g > 0 ? 'pos' : g < 0 ? 'neg' : ''}">${g === null ? '' : pct(g)}</td>`; }).join('')}</tr>
     </table></div><div class="gll" style="margin-top:6px;font-size:11.5px">Em destaque: o maior mês de todos. Crescimento só para anos completos.</div>` : ''}
   </div>
  </div>`;
  { const sel = $('#dv-sel'), show = (i) => { $$('.dvb2 .c').forEach((c) => c.classList.toggle('sel', Number(c.dataset.dm) === i)); sel.innerHTML = `${MONTHS[i]}: <b class="money">${brl(ty[i])}</b>${ly[i] ? ` <span class="money">· ${brl(ly[i])}</span>` : ''}`; };
    $$('.dvb2 .c').forEach((c) => (c.onclick = () => show(Number(c.dataset.dm)))); show(Math.max(0, upTo - 1)); }
  const tw = $('#view .tbl-wrap'); if (tw) tw.scrollLeft = tw.scrollWidth;
  const dm = $('#dmrow'); if (dm) dm.scrollLeft = dm.scrollWidth;
  $('#dv-add').onclick = () => editDiv(null); wireDivList();
  $$('#view [data-rk]').forEach((b) => (b.onclick = () => { try { localStorage.setItem('rumo.rk', b.dataset.rk); } catch {} render(); }));
  $('#tbl-tog').onclick = () => { try { localStorage.setItem('rumo.dtbl', tblOpen ? '0' : '1'); } catch {} render(); };
  $('#rk-all') && ($('#rk-all').onclick = () => openSheet(`<h3>Quem mais paga</h3>${rank.map(rankRow).join('')}<button class="btn block" onclick="closeSheet()" style="margin-top:10px">Fechar</button>`));
  $('#dv-all') && ($('#dv-all').onclick = () => openSheet(`<h3>Todos os dividendos</h3>${divLogList(100000)}<button class="btn block" onclick="closeSheet()" style="margin-top:10px">Fechar</button>`, (el) => $$('[data-div]', el).forEach((x) => (x.onclick = () => editDiv(x.dataset.div)))));
}

/* ----- Cripto ----- */
const COINMETA = { BTC: ['Bitcoin', '₿', '#F7931A'], ETH: ['Ethereum', 'Ξ', '#627EEA'], XRP: ['XRP', '✕', '#23292F'], SOL: ['Solana', '◎', 'linear-gradient(135deg,#9945FF,#14F195)'] };
// biggest coin as a large card (price, 24h, what you hold, share of your crypto); the rest as compact rows
function coinCards(cs, p) {
  const L = cs.coins.filter((x) => Math.abs(x.units) >= 1e-8).map((x) => ({ ...x, us: p.usdbrl ? x.valBRL / p.usdbrl : x.units * num(p[x.k]) })).sort((a, b) => b.us - a.us);
  if (!L.length) return '<p class="muted">Nenhuma moeda.</p>';
  const tot = L.reduce((t, x) => t + x.us, 0) || 1, px = (x) => usd(p[x.k], p[x.k] < 100 ? 2 : 0);
  const ch = (x, word) => { const c = p[x.k + '_24h']; return typeof c === 'number' ? `<span class="cchip ${c < 0 ? 'dn' : 'up'}">${c < 0 ? '▼' : '▲'} ${pct(Math.abs(c) / 100)}${word ? ' 24h' : ''}</span>` : ''; };
  const ic = (x, sm) => { const m = COINMETA[x.k] || [x.k, x.k[0], '#334155']; return `<span class="cic${sm ? ' sm' : ''}" style="background:${m[2]}">${m[1]}</span>`; };
  const qty = (x) => x.units.toLocaleString('pt-BR', { maximumFractionDigits: x.dec });
  // every coin gets the same card: icon · name · quantity | price · 24h, then what you hold and its share
  return L.map((b) => `<div class="ctile click" data-coin="${b.k}"><div class="ctop">${ic(b)}<div><div class="cn">${(COINMETA[b.k] || [b.k])[0]}</div><div class="small">${qty(b)} ${b.k}</div></div>
      <div class="cr"><div class="small">preço</div><div class="cpx">${px(b)}</div>${b.pl ? `<span class="cchip ${b.pl.pl < 0 ? 'dn' : 'up'}">${b.pl.pl < 0 ? '▼' : '▲'} ${pct(Math.abs(b.pl.plPct))}</span>` : '<span class="small cdef">definir preço médio</span>'}</div></div>
    <div class="chave"><span class="small">Você tem</span><b class="money">${CM(b.valBRL, 2)}</b></div></div>`).join('');
}
// tapping a coin: everything about it in one place
function coinSheet(k) {
  const cs = cryptoSummary(), b = cs.coins.find((x) => x.k === k), p = DB.prices, name = (COINMETA[k] || [k])[0], u = num(p.usdbrl);
  if (!b) return; const ch = p[k + '_24h'], tot = cs.totalBRL || 1, row = (l, v, cls = '') => `<div class="ps-step"><span>${l}</span><b class="${cls}">${v}</b></div>`;
  const per = k === 'BTC' && DB.crypto.people.length > 1 ? DB.crypto.people.map((w) => { const x = cs.btcPLby[w]; return x.qty ? row(`${esc(w)} <small>médio ${usd(x.avg)}</small>`, `${signed(pct, x.plPct)} · <span class="money">${signed((v) => CM(v), x.pl * u)}</span>`, x.pl < 0 ? 'neg' : 'pos') : ''; }).join('') : '';
  openSheet(`<div class="ps"><div class="ps-top"><div class="ps-sub">${b.units.toLocaleString('pt-BR', { maximumFractionDigits: b.dec })} ${k}</div><h3>${esc(name)}</h3>
      <div class="ps-big money">${CM(b.valBRL, 2)}</div>${b.pl ? `<div class="ps-sub">${plLine(b.pl.pl * u, b.pl.plPct)} desde a compra</div>` : ''}</div>
    <div class="ps-card">
      ${row('Preço agora', usd(p[k], p[k] < 100 ? 2 : 0))}
      ${typeof ch === 'number' ? row('Últimas 24h', signed(pct, ch / 100), ch < 0 ? 'neg' : 'pos') : ''}
      ${b.pl ? row('Preço médio <a class="cs-ed" data-ed-avg>Editar</a>', usd(b.pl.avg, b.pl.avg < 100 ? 2 : 0)) + row('Total pago', `<span class="money">${usd(b.pl.cost)}</span>`) + (b.pl.rec ? row('Recebidos (sem custo)', `${b.pl.rec.toLocaleString('pt-BR', { maximumFractionDigits: 8 })} ${k}`) : '') : row('Preço médio <a class="cs-ed" data-ed-avg>Definir</a>', '<span class="cdef">não definido</span>')}
      ${row('Parte da sua cripto', pct(b.valBRL / tot))}
    </div>
    ${per ? `<div class="ps-h">Por pessoa (compras do registro)</div><div class="ps-card">${per}</div>` : ''}
    <button class="btn block" id="cs-avg" style="margin-top:14px">${b.pl ? 'Editar preço médio' : 'Definir preço médio'}</button>
    <button class="btn block" onclick="closeSheet()">Fechar</button></div>`, (el) => { $$('#cs-avg, [data-ed-avg]', el).forEach((x) => (x.onclick = () => editBasis(k))); });
}
function vCripto() {
  const cs = cryptoSummary(), P = portfolio(), c = DB.crypto, p = DB.prices;
  const log = [...c.log].reverse();
  $('#view').innerHTML = `<div class="gwrap cw">${segBar('cripto')}
  
  
   <div class="gl cw-hero"><div class="lab">Cripto</div><div class="val money">${CM(cs.totalBRL, 2)}</div>
     ${cs.plTot ? `<div class="sub cw-pl">${plLine(cs.plTot.pl * num(p.usdbrl), cs.plTot.plPct)}</div>` : ''}</div>
   <div class="gl"><h2>Por moeda</h2>${coinCards(cs, p)}</div>
   <div class="gl"><h2>Bitcoin por pessoa</h2>
     ${c.people.map((w) => { const u = cs.coins[0].net[w]; return `<div class="row"><span class="l">${esc(w)} <span class="small">${u.toLocaleString('pt-BR', { maximumFractionDigits: 8 })} BTC</span></span><span class="r money">${CM(u * p.BTC * p.usdbrl, 2)}</span></div>`; }).join('')}
     ${cs.coins[0].fee ? `<div class="row"><span class="l small">Taxas de transferência</span><span class="r small">−${cs.coins[0].fee.toLocaleString('pt-BR', { maximumFractionDigits: 8 })} BTC</span></div>` : ''}</div>
  <div class="gl"><h2>Registro de operações</h2>
    <button class="btn primary block" id="c-add" style="margin:0 0 8px">+ Nova operação</button>
    ${log.map((x) => { const imp = x.op === 'Buy' && x.qty && x.price ? x.value / (x.qty * x.price) - 1 : null; const bad = imp !== null && (imp < -0.005 || imp > 0.06);
      return `<div class="item click" data-id="${x.id}"><div><div class="t">${x.op === 'Buy' ? 'Compra' : x.op === 'Sold' ? 'Venda' : 'Recebido'} · ${x.coin}</div><div class="s">${esc(x.name)} · ${x.date ? new Date(x.date + 'T12:00').toLocaleDateString('pt-BR') : ''}${bad ? ' · <span class="neg">⚠ confira os valores</span>' : ''}</div></div>
      <div class="r"><div class="t">${usd(x.value, 2)}</div><div class="s">${num(x.qty).toLocaleString('pt-BR', { maximumFractionDigits: 8 })} @ ${usd(x.price)}</div></div></div>`; }).join('') || '<p class="muted">Nenhuma operação.</p>'}
  </div></div>`;
  wireSeg();
  $$('#view [data-coin]').forEach((el) => (el.onclick = () => coinSheet(el.dataset.coin)));
  $('#c-add').onclick = () => editOp(null);
  $$('#view .item').forEach((el) => (el.onclick = () => editOp(el.dataset.id)));
}
function viewCur() { try { const c = localStorage.getItem('rumo.cur'); return c === 'GBP' || c === 'USD' ? c : 'BRL'; } catch { return 'BRL'; } }
function CM(vBRL, dec = 2) { const c = viewCur(); return c === 'GBP' ? gbp(vBRL / (DB.prices.gbpbrl || 1), dec) : c === 'USD' ? usd(vBRL / (DB.prices.usdbrl || 1), dec) : brl(vBRL, dec); }
// profit/loss: the % in a tinted pill, the value beside it in quiet text, so the two never read as one number
const plLine = (pl, pctV) => `<span class="plx"><span class="plp ${pl < 0 ? 'dn' : 'up'}">${pl < 0 ? '▼' : '▲'} ${pct(Math.abs(pctV))}</span><span class="plv money">${signed((v) => CM(v), pl)}</span></span>`;
function editBasis(k) {
  const c = DB.crypto, st = (c.basis || {})[k], cs = cryptoSummary(), co = cs.coins.find((x) => x.k === k), name = (COINMETA[k] || [k])[0];
  // coins held at the end of a day = today's total minus what was logged after that day
  const qtyAt = (d) => (co ? co.units : 0) - c.log.filter((x) => x.coin === k && (x.date || '') > d).reduce((t, x) => t + (x.op === 'Sold' ? -1 : 1) * num(x.qty), 0);
  const fromLog = k === 'BTC' && !st && co?.pl;
  openSheet(`<h3>Preço médio · ${esc(name)}</h3>
    <p class="small muted" style="margin:-4px 0 10px">${fromLog ? `Hoje o preço médio do Bitcoin vem das suas compras no registro: <b>${usd(co.pl.avg)}</b>. Só preencha aqui se quiser trocar pelo preço da corretora.<br><br>` : ''}Copie o <b>preço médio</b> da corretora (Coinbase → ${k} → Average cost) e <b>quantas moedas você tinha</b> nesse dia. O que você lançar depois (compras, vendas, recebidos) entra na conta sozinho.</p>
    <div class="field"><label>Preço médio (US$)</label><input id="b-avg" class="pt" inputmode="decimal" value="${st ? fmtN(st.avg, 2) : ''}"></div>
    <div class="field"><label>Data</label><input type="date" id="b-d" value="${st ? st.d : today()}"></div>
    <div class="field"><label>Moedas nesse dia<small>${k} · no fim do dia</small></label><input id="b-q" class="pt" inputmode="decimal" value="${fmtN(st ? st.qty : qtyAt(today()), 8)}"></div>
    <button class="btn primary block" id="b-save">Salvar</button>
    ${st ? '<button class="btn danger block" id="b-del">Remover preço médio</button>' : ''}
    <button class="btn block" onclick="closeSheet()">Cancelar</button>`, (el) => {
    $$('input.pt', el).forEach(liveFormat);
    let typed = !!st; $('#b-q', el).addEventListener('input', () => (typed = true));
    $('#b-d', el).onchange = () => { if (!typed) $('#b-q', el).value = fmtN(qtyAt($('#b-d', el).value || today()), 8); };
    $('#b-save', el).onclick = async () => { const avg = parsePT($('#b-avg', el).value), q = parsePT($('#b-q', el).value), d = $('#b-d', el).value || today();
      if (!(avg > 0) || !(q > 0)) return toast('Digite o preço médio e a quantidade');
      (c.basis ||= {})[k] = { avg, qty: q, d, ids: c.log.filter((x) => x.coin === k && x.date === d).map((x) => x.id) }; await save(); closeSheet(); render(); doneTick(); };
    $('#b-del', el) && ($('#b-del', el).onclick = async () => { delete c.basis[k]; await save(); closeSheet(); render(); });
  });
}
function editOp(id) {
  const c = DB.crypto, x = id ? c.log.find((o) => o.id === id) : { id: uid(), name: c.people[0], op: 'Buy', date: new Date().toISOString().slice(0, 10), coin: 'BTC', qty: null, value: null, price: DB.prices.BTC || null };
  openSheet(`<h3>${id ? 'Editar operação' : 'Nova operação'}</h3>
    <div class="field"><label>Quem</label><select id="o-name">${c.people.map((w) => `<option ${w === x.name ? 'selected' : ''}>${esc(w)}</option>`).join('')}</select></div>
    <div class="field"><label>Operação</label><select id="o-op">${[['Buy', 'Compra'], ['Sold', 'Venda'], ['Received', 'Recebido']].map(([v, l]) => `<option value="${v}" ${v === x.op ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="field"><label>Data</label><input type="date" id="o-date" value="${x.date || ''}"></div>
    <div class="field"><label>Cripto</label><select id="o-coin">${COINS.map((co) => `<option ${co.k === x.coin ? 'selected' : ''}>${co.k}</option>`).join('')}</select></div>
    <div class="field"><label>Quantidade<small id="o-have"></small></label><input id="o-qty" class="pt" inputmode="decimal" value="${fmtN(x.qty, 8)}"></div>
    <button class="btn block hidden" id="o-all" style="margin:-4px 0 10px">Vender tudo</button>
    <div class="field o-paid"><label id="o-val-l">Valor pago (US$)<small>com taxas</small></label><input id="o-val" class="pt" inputmode="decimal" value="${fmtN(x.value, 2)}"></div>
    <div class="field o-paid"><label>Preço da moeda (US$)</label><input id="o-price" class="pt" inputmode="decimal" value="${fmtN(x.price, 2)}"></div>
    <p class="small muted hidden" id="o-rec-note" style="margin:2px 0 12px">Recebido (staking, recompensa, presente) entra sem custo: aumenta suas moedas, não muda o preço médio e conta como lucro.</p>
    <button class="btn primary block" id="o-save">Salvar</button>
    ${id ? '<button class="btn danger block" id="o-del">Apagar</button>' : ''}
    <button class="btn block" onclick="closeSheet()">Cancelar</button>`, (el) => {
    $$('input.pt', el).forEach(liveFormat);
    // how much this person holds of the coin right now (ignoring the operation being edited)
    const holding = () => {
      const who = $('#o-name', el).value, coin = $('#o-coin', el).value;
      const saved = c.log; c.log = saved.filter((q) => q.id !== x.id);
      try { return Math.max(0, cryptoSummary().coins.find((q) => q.k === coin).net[who] || 0); } finally { c.log = saved; }
    };
    const sync = () => {
      const sell = $('#o-op', el).value === 'Sold', rec = $('#o-op', el).value === 'Received', h = holding(), coin = $('#o-coin', el).value;
      $$('.o-paid', el).forEach((f) => f.classList.toggle('hidden', rec)); $('#o-rec-note', el).classList.toggle('hidden', !rec);
      $('#o-all', el).classList.toggle('hidden', !sell || h <= 0);
      $('#o-have', el).textContent = sell ? `você tem ${fmtN(h, 8) || '0'} ${coin}` : '';
      $('#o-val-l', el).firstChild.textContent = sell ? 'Valor recebido (US$)' : 'Valor pago (US$)';
      $('#o-price', el).value = $('#o-price', el).value || fmtN(DB.prices[coin], 2);
    };
    const autoVal = () => { const q = parsePT($('#o-qty', el).value), pr = parsePT($('#o-price', el).value); if (q && pr && !$('#o-val', el).dataset.typed) $('#o-val', el).value = fmtN(q * pr, 2); };
    $('#o-val', el).addEventListener('input', () => ($('#o-val', el).dataset.typed = '1'));
    if (x.value) $('#o-val', el).dataset.typed = '1';
    ['#o-op', '#o-name'].forEach((k) => ($(k, el).onchange = sync));
    $('#o-coin', el).onchange = () => { $('#o-price', el).value = fmtN(DB.prices[$('#o-coin', el).value], 2); sync(); autoVal(); };
    $('#o-qty', el).addEventListener('input', autoVal); $('#o-price', el).addEventListener('input', autoVal);
    $('#o-all', el).onclick = () => { $('#o-qty', el).value = fmtN(holding(), 8); autoVal(); };
    sync();
    $('#o-save', el).onclick = async () => {
      const o = { id: x.id, name: $('#o-name', el).value, op: $('#o-op', el).value, date: $('#o-date', el).value, coin: $('#o-coin', el).value,
        qty: parsePT($('#o-qty', el).value), value: parsePT($('#o-val', el).value), price: parsePT($('#o-price', el).value) };
      if (o.op === 'Sold' && $('#o-qty', el).value === fmtN(holding(), 8)) o.qty = holding(); // "Vender tudo": use the exact amount, not the rounded one shown
      if (o.op === 'Sold' && o.qty > holding() * 1.000001 + 1e-12) return toast(`Você só tem ${fmtN(holding(), 8)} ${o.coin}`);
      if (!o.qty) return toast('Informe a quantidade');
      if (o.op === 'Received') { o.value = 0; o.price = num(DB.prices[o.coin]) || null; }   // no cost; price kept only as a note of the day
      const i = c.log.findIndex((q) => q.id === o.id); if (i > -1) c.log[i] = o; else c.log.push(o);
      c.log.sort((a, b) => (a.date || '').localeCompare(b.date || '')); await save(); closeSheet(); render();
    };
    if (id) $('#o-del', el).onclick = async () => { if (!(await ask('Apagar esta operação?', { yes: 'Sim, apagar', danger: true }))) return; c.log = c.log.filter((q) => q.id !== id); await save(); closeSheet(); render(); };
  });
}

/* ----- Ajustes ----- */
function keyBadge(prov) {
  const st = DB.settings.keyStatus?.[prov], has = !!DB.settings.keys?.[prov];
  if (!has) return '<div class="kst none">— sem chave</div>';
  if (!st) return '<div class="kst none">• ainda não testada</div>';
  return `<div class="kst ${st.ok ? 'ok' : 'bad'}">${st.ok ? '✓ Funcionando' : '✗ Não funcionou'} · ${esc(st.msg)} · ${fmtDate(st.at)}</div>`;
}
const ICO = {   // small line icons for the settings rows
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>', plus: '<path d="M12 5v14M5 12h14"/>', trend: '<path d="M4 18 10 12l4 4 6-8"/>',
  pie: '<path d="M12 3v9l7 4"/><circle cx="12" cy="12" r="9"/>', down: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>', up: '<path d="M12 21V9M7 14l5-5 5 5M5 3h14"/>',
  grid: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M10 4v16"/>', plug: '<path d="M7 7h10v10H7z"/><path d="M3 12h4M17 12h4M12 3v4M12 17v4"/>',
  coin: '<circle cx="12" cy="12" r="8"/><path d="M9.5 8h3.5a2 2 0 0 1 0 4H9.5zm0 4h4a2 2 0 0 1 0 4h-4zM9.5 6v12"/>', lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  face: '<path d="M8 4H6a2 2 0 0 0-2 2v2M16 4h2a2 2 0 0 1 2 2v2M8 20H6a2 2 0 0 1-2-2v-2M16 20h2a2 2 0 0 0 2-2v-2M9 10v1M15 10v1M10 15c1 .7 3 .7 4 0"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l2 2"/>', pin: '<rect x="4" y="6" width="16" height="12" rx="2"/><path d="M8 12h.01M12 12h.01M16 12h.01"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>', sync: '<path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4"/>',
  shield: '<path d="M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6z"/>', trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
};
// space this app uses on the phone. Safari allows about 5 MB; counted as 2 bytes per character to stay on the safe side
const STORE_LIMIT = 5 * 1024 * 1024;
function storeUse() { let c = 0; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('rumo')) c += k.length + (localStorage.getItem(k) || '').length; } } catch {} const b = c * 2; return { b, p: b / STORE_LIMIT }; }
const mbTxt = (b) => { const m = b / 1048576, d = m < 1 ? 2 : 1; return m.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' MB'; };
// price of one asset over the days the app kept its detail (about 60), from the daily records
function assetSpark(id, now) {
  const pts = (DB.daily || []).filter((x) => x.a && x.a[id] && x.a[id][0] > 0).map((x) => ({ d: x.d, v: x.a[id][0] }));
  if (now > 0) pts.push({ d: today(), v: now }); if (pts.length < 3) return '';
  const W = 300, H = 56, vs = pts.map((p) => p.v), mn = Math.min(...vs), mx = Math.max(...vs), sp = mx - mn || 1;
  const d = 'M' + pts.map((p, i) => `${((i / (pts.length - 1)) * W).toFixed(1)} ${(H - 4 - ((p.v - mn) / sp) * (H - 8)).toFixed(1)}`).join(' L'), ch = vs[vs.length - 1] / vs[0] - 1;
  return `<div class="aspark"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${d} L${W} ${H} L0 ${H} Z" fill="url(#asg)"/><path d="${d}" fill="none" stroke="var(--g-acc1)" stroke-width="1.8" vector-effect="non-scaling-stroke"/><defs><linearGradient id="asg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--g-acc2)" stop-opacity=".35"/><stop offset="1" stop-color="var(--g-acc2)" stop-opacity="0"/></linearGradient></defs></svg>
    <div class="asl"><span>${dmy(pts[0].d).slice(0, 5)}</span><span class="${ch < 0 ? 'neg' : 'pos'}">${signed(pct, ch)} em ${pts.length} dias</span><span>hoje</span></div></div>`;
}
const srow = (id, ico, bg, title, sub, right = '', cls = '') => `<div class="srow click ${cls}" id="${id}"><span class="sic" style="background:${bg}"><svg viewBox="0 0 24 24">${ICO[ico]}</svg></span>
  <span class="srt"><b>${title}</b>${sub ? `<span>${sub}</span>` : ''}</span>${right}<span class="schev">›</span></div>`;
const stog = (id, ico, bg, title, on, sub = '') => `<div class="srow click" id="${id}"><span class="sic" style="background:${bg}"><svg viewBox="0 0 24 24">${ICO[ico]}</svg></span>
  <span class="srt"><b>${title}</b>${sub ? `<span>${sub}</span>` : ''}</span><span class="stog ${on ? 'on' : ''}"></span></div>`;
function bindSettingInputs(root, after) {   // numbers typed in a settings sheet
  const c = DB.crypto;
  $$('input[data-k]', root).forEach((inp) => { liveFormat(inp); inp.addEventListener('change', async () => {
    const parts = inp.dataset.k.split('.'); const v = parsePT(inp.value) ?? 0;
    if (parts[0] === 's') DB.settings[parts[1]] = parts[1] === 'retornoAnual' ? v / 100 : v;
    else if (parts[0] === 't') DB.settings.targets[parts[1]] = v / 100;
    else if (parts[0] === 'pre') { (c.pre[parts[1]] ||= {})[parts.slice(2).join('.')] = v; }
    else if (parts[0] === 'fee') c.fees[parts[1]] = v;
    await save(); after && after();
  }); });
}
function keysSheet() {
  const s = DB.settings;
  openSheet(`<h3>Fontes de preço</h3><div class="small muted" style="margin-bottom:8px">Grátis. Ficam guardadas criptografadas neste aparelho e entram no backup.</div>
     <div class="field"><label>Google Sheets<small>link da sua planilha (Compartilhar → qualquer pessoa com o link)</small></label><input id="k-sheet" value="${esc(s.keys?.sheet || '')}" autocomplete="off" style="text-align:left" placeholder="https://docs.google.com/…"></div>
     ${keyBadge('sheet')}
     <div class="field"><label>brapi.dev (B3 ações)<small>brapi.dev → criar conta → copiar token</small></label><input id="k-brapi" value="${esc(s.keys?.brapi || '')}" autocomplete="off" style="text-align:left"></div>
     ${keyBadge('brapi')}
     ${(() => { const u = s.brapiUse; return u && u.m === ym() ? `<div class="small muted" style="margin:-4px 0 10px">Uso este mês: <b>${nf0.format(u.n)}</b> de 15.000 · hoje ${nf0.format(u.d === today() ? u.dn : 0)}</div>` : ''; })()}
     <div class="field"><label>Finnhub (EUA)<small>finnhub.io → Get free API key</small></label><input id="k-finn" value="${esc(s.keys?.finnhub || '')}" autocomplete="off" style="text-align:left"></div>
     ${keyBadge('finnhub')}
     ${s.keys?.alpha || (DB.assets || []).some((a) => a.market === 'EU') ? `<div class="field"><label>Alpha Vantage (opcional)<small>alphavantage.co → Get free API key</small></label><input id="k-alpha" value="${esc(s.keys?.alpha || '')}" autocomplete="off" style="text-align:left"></div>
     ${keyBadge('alpha')}` : ''}
     <div class="small muted" style="margin:6px 0 10px">Planilha: coluna E com <b>GOOGLEFINANCE(…; "closeyest")</b> dá o fechamento anterior para o "hoje".</div>
     <button class="btn primary block" id="k-test">Testar chaves</button>
     <button class="btn block" onclick="closeSheet()">Fechar</button>`, (el) => {
    const set = (id, k) => ($(id, el).onchange = async (e) => { DB.settings.keys[k] = e.target.value.trim(); delete DB.settings.keyStatus[k]; await save(); });
    set('#k-sheet', 'sheet'); set('#k-brapi', 'brapi'); set('#k-finn', 'finnhub'); $('#k-alpha', el) && set('#k-alpha', 'alpha');
    $('#k-test', el).onclick = async () => {
      const K = DB.settings.keys; K.brapi = $('#k-brapi', el).value.trim(); K.finnhub = $('#k-finn', el).value.trim(); if ($('#k-alpha', el)) K.alpha = $('#k-alpha', el).value.trim(); K.sheet = $('#k-sheet', el).value.trim();
      toast('Testando…'); for (const k in LASTERR) delete LASTERR[k];
      const sh = K.sheet ? await sheetQuotes(['HGLG11'], K.sheet) : null;
      if (sh) await setKeyStatus('sheet', (sheetQuotes.count || 0) > 0, `${sheetQuotes.count} tickers com preço${sh.HGLG11 ? ' · HGLG11 R$ ' + nf2.format(sh.HGLG11) : ''}`);
      const [b, f, a] = await Promise.all([K.brapi ? brapiQuotes(['PETR4'], K.brapi) : null, K.finnhub ? finnhubQuotes(['AAPL'], K.finnhub) : null, K.alpha ? alphaQuotes(['TSCO.LON'], K.alpha) : null]);
      if (b) await setKeyStatus('brapi', !!b.PETR4, 'PETR4 R$ ' + nf2.format(b.PETR4 || 0));
      if (f) await setKeyStatus('finnhub', !!f.AAPL, 'AAPL US$ ' + nf2.format(f.AAPL || 0));
      if (a) await setKeyStatus('alpha', !!a['TSCO.LON'], 'TSCO.LON ' + nf2.format(a['TSCO.LON'] || 0) + 'p');
      await save(); render(); keysSheet(); toast('Teste concluído');
    };
  });
}
function vAjustes() {
  const s = DB.settings, c = DB.crypto, meta = getMeta();
  const tsum = CLASSES.reduce((a, k) => a + num(s.targets[k.k]), 0);
  const allT = CLASSES.every((k) => Math.abs(num(s.targets[k.k]) - num(s.targets[CLASSES[0].k])) < 1e-9);
  const bOld = !s.lastBackup || Date.now() - new Date(s.lastBackup) > 30 * 864e5;
  const ks = ['sheet', 'brapi', 'finnhub', 'alpha'].filter((k) => s.keys?.[k]), kOk = ks.filter((k) => s.keyStatus?.[k]?.ok).length, kBad = ks.filter((k) => s.keyStatus?.[k] && !s.keyStatus[k].ok).length;
  const thN = { auto: 'Automático', light: 'Claro', dark: 'Escuro' }[getTheme()] || 'Automático';
  $('#view').innerHTML = `<div class="sets">
   <div class="ssec">Metas</div><div class="sgrp">
     ${srow('a-meta', 'target', '#2563EB', 'Meta de patrimônio', '', `<span class="srv">${brl(s.meta)}</span>`)}
     ${srow('a-plan', 'plus', '#0EA5A4', 'Aporte planejado', '', `<span class="srv">${gbp(s.aportePlanGBP)}/mês</span>`)}
     ${srow('a-ret', 'trend', '#8B5CF6', 'Retorno esperado', '', `<span class="srv">${pct(s.retornoAnual)} a.a.</span>`)}
     ${srow('a-base', 'trend', '#0F766E', 'Moeda base', 'rendimentos e resultados são medidos nela', `<span class="srv">${BASE() === 'GBP' ? '£ Libra' : 'R$ Real'}</span>`)}
     ${srow('a-tgt', 'pie', '#F59E0B', 'Alocação alvo', allT ? pct(num(s.targets[CLASSES[0].k])) + ' em cada classe' : CLASSES.map((k) => k.n + ' ' + pct(num(s.targets[k.k]))).join(' · '), Math.abs(tsum - 1) > 1e-6 ? '<span class="sbad w">soma ≠ 100%</span>' : '')}
   </div>
   <div class="ssec">Seus dados</div><div class="sgrp">
     ${srow('a-export', 'down', '#16A34A', 'Fazer backup', s.lastBackup ? 'último: ' + fmtDate(s.lastBackup) : 'arquivo criptografado', bOld ? `<span class="sbad w">${s.lastBackup ? 'há +30 dias' : 'nunca feito'}</span>` : '<span class="sbad ok">em dia</span>')}
     ${srow('a-import', 'up', '#475569', 'Importar backup', 'substitui os dados deste aparelho')}
     ${srow('a-excel', 'grid', '#15803D', 'Exportar Excel', 'cópia legível, não criptografada')}
     ${srow('a-layout', 'grid', '#475569', 'Organizar páginas', 'mudar a ordem dos cartões')}
     ${(() => { const u = storeUse(); return srow('a-space', 'pie', '#475569', 'Espaço usado', `${mbTxt(u.b)} de 5 MB<span class="spbar"><i class="${u.p >= 0.7 ? 'hi' : ''}" style="width:${Math.max(1, Math.min(100, u.p * 100)).toFixed(1)}%"></i></span>`, `<span class="srv">${Math.round(u.p * 100)}%</span>`); })()}
   </div>
   <div class="ssec">Preços</div><div class="sgrp">
     ${srow('a-keys', 'plug', '#0284C7', 'Fontes de preço', ks.length ? ks.map((k) => ({ sheet: 'Google Sheets', brapi: 'brapi', finnhub: 'Finnhub', alpha: 'Alpha Vantage' })[k]).join(' · ') : 'nenhuma configurada', ks.length ? `<span class="sbad ${kBad ? 'w' : 'ok'}">${kBad ? kBad + ' com erro' : kOk + ' ✓'}</span>` : '')}
     ${srow('a-auto', 'pie', '#0EA5A4', 'Patrimônio pelos ativos', ACLS.filter((k) => DB.settings.auto?.[k.k]).map((k) => k.n).join(' · ') || 'desligado')}
     ${srow('a-crypto', 'coin', '#F97316', 'Cripto', 'pessoas e saldos de antes do registro')}
   </div>
   <div class="ssec">Segurança</div><div class="sgrp">
     ${stog('a-pinT', 'lock', '#334155', 'Pedir PIN ao abrir', !meta?.open, meta?.open ? 'desligado — qualquer pessoa com o iPhone desbloqueado vê o app' : 'trava sozinho após 2 min fora da tela')}
     ${!meta?.open ? stog('a-face', 'face', '#334155', 'Face ID', !!meta?.face) + srow('a-pin', 'pin', '#334155', 'Trocar PIN', '') : ''}
     ${srow('a-rec', 'key', '#334155', 'Código de recuperação', 'gerar um novo (se esquecer o PIN)')}
   </div>
   <div class="ssec">App</div><div class="sgrp">
     ${srow('a-theme', 'moon', '#4F46E5', 'Tema', '', `<span class="srv">${thN}</span>`)}
     ${srow('a-update', 'sync', '#2563EB', 'Buscar atualização', 'versão ' + APP_VERSION)}
     ${srow('a-priv', 'shield', '#475569', 'Privacidade', 'seus dados nunca saem do iPhone')}
   </div>
   <div class="sgrp" style="margin-top:14px">${srow('a-wipe', 'trash', '#B91C1C', 'Apagar todos os dados', '', '', 'sdanger')}</div>
  </div>`;
  const one = (title, key, val, note) => openSheet(`<h3>${title}</h3>${fieldRow(title, key, val, note)}<button class="btn primary block" onclick="closeSheet()" style="margin-top:12px">Pronto</button>`, (el) => { bindSettingInputs(el, render); setTimeout(() => $('input', el)?.focus(), 250); });
  $('#a-meta').onclick = () => one('Meta de patrimônio (R$)', 's.meta', s.meta);
  $('#a-plan').onclick = () => one('Aporte mensal planejado (£)', 's.aportePlanGBP', s.aportePlanGBP, 'usado nas projeções da meta');
  $('#a-ret').onclick = () => one('Retorno anual esperado (%)', 's.retornoAnual', Math.round(s.retornoAnual * 1000) / 10, 'usado no cenário da meta');
  $('#a-tgt').onclick = () => { const draw = () => openSheet(`<h3>Alocação alvo (%)</h3>${CLASSES.map((k) => fieldRow(k.n, 't.' + k.k, Math.round(num(DB.settings.targets[k.k]) * 1000) / 10)).join('')}
      <div class="small" id="t-sum" style="margin:8px 0"></div><button class="btn primary block" onclick="closeSheet()">Pronto</button>`, (el) => { const upd = () => { const t = CLASSES.reduce((a, k) => a + num(DB.settings.targets[k.k]), 0); $('#t-sum', el).innerHTML = `<span class="${Math.abs(t - 1) > 1e-6 ? 'neg' : 'pos'}">Soma: ${pct(t)} ${Math.abs(t - 1) > 1e-6 ? '— precisa somar 100%' : '✓'}</span>`; }; upd(); bindSettingInputs(el, () => { upd(); render(); }); }); draw(); };
  $('#a-keys').onclick = keysSheet;
  $('#a-auto').onclick = () => openSheet(`<h3>Patrimônio pelos ativos</h3>
      <div class="small muted" style="margin-bottom:8px">Ligado: o total da classe vem dos ativos (preços ao vivo). Desligado: vale o total digitado em Atualizar.</div>
      ${ACLS.map((k) => { const n = (DB.assets || []).filter((a) => a.cls === k.k).length; return `<label class="toggle" style="margin:10px 0"><input type="checkbox" data-auto="${k.k}" ${DB.settings.auto?.[k.k] ? 'checked' : ''}><span><b>${k.n}</b><br><span class="small muted">${n} ${n === 1 ? 'ativo' : 'ativos'}</span></span></label>`; }).join('')}
      <button class="btn primary block" onclick="closeSheet()" style="margin-top:10px">Pronto</button>`, (el) => {
    $$('[data-auto]', el).forEach((cb) => (cb.onchange = async () => { const k = cb.dataset.auto;
      if (cb.checked && !(DB.assets || []).some((a) => a.cls === k)) { cb.checked = false; return toast('Adicione os ativos primeiro'); }
      (DB.settings.auto ||= {})[k] = cb.checked; await save(); render(); }));
  });
  $('#a-crypto').onclick = () => openSheet(`<h3>Cripto — saldos de antes do registro</h3>
      <div class="field"><label>Pessoas<small>separe por vírgula</small></label><input id="a-people" value="${esc(c.people.join(', '))}" style="text-align:left"></div>
      ${COINS.map((co) => c.people.map((w) => fieldRow(`${co.k} — ${esc(w)}`, `pre.${co.k}.${w}`, c.pre?.[co.k]?.[w] ?? 0)).join('') + fieldRow(`${co.k} — taxas de transferência`, `fee.${co.k}`, c.fees?.[co.k] ?? 0)).join('')}
      <button class="btn primary block" onclick="closeSheet()" style="margin-top:10px">Pronto</button>`, (el) => {
      bindSettingInputs(el, render);
      $('#a-people', el).onchange = async (e) => { const ps = e.target.value.split(',').map((x) => x.trim()).filter(Boolean); if (ps.length) { c.people = ps; await save(); render(); $('#a-crypto').click(); } };
    });
  $('#a-export').onclick = exportBackup;
  $('#a-excel').onclick = exportExcel;
  $('#a-layout') && ($('#a-layout').onclick = () => openLayout());
  $('#a-space').onclick = () => { const u = storeUse(); toast(`${mbTxt(u.b)} de cerca de 5 MB que o iPhone libera para o app (${Math.round(u.p * 100)}%). Cresce uns 0,4 MB por ano — o app avisa no Painel ao chegar em 70%.`, 7000); };
  $('#a-import').onclick = () => pickImport(false);
  $('#a-update').onclick = forceUpdate;
  $('#a-base').onclick = () => openSheet(`<h3>Moeda base</h3><p class="small muted" style="margin:-4px 0 12px">Escolha a moeda em que você vai gastar esse dinheiro. Todos os rendimentos, resultados do mês e do ano são calculados nela, contando a variação do câmbio. Seus valores não mudam — só a forma de medir. Dá para trocar quando quiser.</p>${[['BRL', 'R$ Real (vida no Brasil)'], ['GBP', '£ Libra (vida no Reino Unido)']].map(([v, l]) => `<button class="btn block ${BASE() === v ? 'primary' : ''}" data-base="${v}">${l}</button>`).join('')}<button class="btn block" onclick="closeSheet()">Fechar</button>`, (el) => $$('[data-base]', el).forEach((b) => (b.onclick = async () => { DB.settings.base = b.dataset.base; await save(); closeSheet(); render(); doneTick(); })));
  $('#a-theme').onclick = () => openSheet(`<h3>Tema</h3>${[['auto', 'Automático (igual ao iPhone)'], ['light', 'Claro'], ['dark', 'Escuro']].map(([v, l]) => `<button class="btn block ${getTheme() === v ? 'primary' : ''}" data-th="${v}">${l}</button>`).join('')}`, (el) => $$('[data-th]', el).forEach((b) => (b.onclick = () => { try { localStorage.setItem('rumo.theme', b.dataset.th); } catch {} applyTheme(); closeSheet(); render(); })));
  $('#a-priv').onclick = () => openSheet(`<h3>Privacidade</h3><div class="small" style="line-height:1.6">
     • Nenhum dado seu sai do aparelho. Ficam guardados criptografados (AES-256) com o seu PIN.<br>
     • A internet só é usada para buscar preços: CoinGecko (cripto), AwesomeAPI, Coinbase, Frankfurter/BCE e open.er-api (câmbio), Google Sheets, brapi, Finnhub e Alpha Vantage (ações e FIIs). Eles recebem apenas os tickers, nunca quantidades ou valores.<br>
     • ${getMeta()?.open ? 'O app está sem PIN (abre direto).' : 'O app trava sozinho após 2 minutos fora da tela.'}<br>
     • Face ID usa uma chave de acesso (passkey) do iPhone.<br>
     • O backup é um arquivo criptografado com senha. O Excel NÃO é criptografado.</div><button class="btn block" onclick="closeSheet()" style="margin-top:12px">Fechar</button>`);
  $('#a-pinT').onclick = async () => {
    if (getMeta()?.open) return showLock('setup');
    if (!(await ask('Abrir o app sem PIN?\n\nQualquer pessoa com o seu iPhone desbloqueado poderá ver seus investimentos. Você pode voltar a pedir PIN aqui quando quiser.'))) return;
    const m = getMeta(); m.open = b64(DKRAW); m.face = null; setMeta(m); render(); toast('🔓 O app agora abre sem PIN');
  };
  $('#a-pin') && ($('#a-pin').onclick = () => showLock('setup'));
  $('#a-face') && ($('#a-face').onclick = async () => {
    const m = getMeta();
    if (m.face) { if (!(await ask('Desativar o Face ID? O app volta a pedir só o PIN.'))) return; m.face = null; setMeta(m); render(); return toast('Face ID desativado'); }
    try { await enableFaceID(); render(); toast('✓ Face ID ativado — o PIN continua valendo como reserva'); }
    catch (e) {
      console.warn(e);
      if (e.name === 'NotAllowedError') return toast('Cancelado');
      toast(e.message === 'noprf' || e.message === 'unsupported' ? 'Este aparelho/navegador não suporta Face ID para apps web (precisa iOS 18 ou mais novo)' : 'Não foi possível ativar o Face ID', 4500);
    }
  });
  $('#a-rec').onclick = async () => {
    if (!(await ask('Gerar um novo código? O código antigo deixa de funcionar.'))) return;
    const code = newRecoveryCode(), m = getMeta(); m.rec = await wrapWithSecret(code.replace(/-/g, '')); setMeta(m); showRecovery(code);
  };
  $('#a-wipe').onclick = async () => {
    if (!(await ask('Isso apaga TODOS os dados deste aparelho. Você tem um backup?', { yes: 'Sim, apagar', danger: true }))) return;
    if (!(await ask('Tem certeza? Não dá para desfazer.', { yes: 'Sim, apagar', danger: true }))) return;
    localStorage.removeItem(K_DATA); localStorage.removeItem(K_META); DB = null; KEY = null; location.hash = ''; location.reload();
  };
}

/* ---------------- theme ---------------- */
function getTheme() { try { return localStorage.getItem('rumo.theme') || 'auto'; } catch { return 'auto'; } }
function applyTheme() {
  const t = getTheme(), dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', '#0B1F3A');
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { applyTheme(); if (DB) render(); });

/* ---------------- Excel export (readable copy, NOT encrypted) ---------------- */
function loadScript(src) { return new Promise((ok, bad) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = bad; document.head.appendChild(s); }); }
async function exportExcel() {
  if (!(await ask('O arquivo Excel NÃO é criptografado — qualquer pessoa com o arquivo consegue ler. Continuar?'))) return;
  try { if (!window.XLSX) await loadScript('xlsx.mini.min.js'); } catch { return toast('Não consegui carregar o gerador de Excel — tente com internet'); }
  const X = window.XLSX, wb = X.utils.book_new(), H = histLive(), R = returnsData(), P = portfolio(), cs = P.cs;
  const md = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo - 1, 1)); };
  const rByM = Object.fromEntries(R.months.map((m) => [m.month, m]));
  const add = (name, rows, widths, fmts = {}) => {
    const ws = X.utils.aoa_to_sheet(rows, { cellDates: true });
    ws['!cols'] = widths.map((w) => ({ wch: w }));
    const rg = X.utils.decode_range(ws['!ref']);
    for (let r = 1; r <= rg.e.r; r++) for (const [c, z] of Object.entries(fmts)) { const ref = X.utils.encode_cell({ r, c: Number(c) }); if (ws[ref]) ws[ref].z = z; }
    X.utils.book_append_sheet(wb, ws, name);
  };
  const BR = '"R$" #,##0.00', GB = '"£" #,##0.00', PC = '0.00%';
  if ((DB.apLog || []).length) add('Aportes', [['Data', 'Aporte (£)', 'GBP/BRL', 'Aporte (R$)', 'Nota'], ...[...DB.apLog].sort((a, b) => a.date.localeCompare(b.date)).map((e) => [new Date(e.date + 'T12:00:00Z'), e.gbp, e.g, Math.round(apBRL(e) * 100) / 100, e.note || ''])], [12, 12, 9, 13, 20], { 0: 'dd/mm/yyyy', 1: GB, 3: BR });
  if ((DB.divLog || []).length) add('Lançamentos div', [['Data', 'Tipo', 'Ticker', 'Valor', 'Moeda', 'Em R$'], ...[...DB.divLog].sort((a, b) => a.date.localeCompare(b.date)).map((e) => [new Date(e.date + 'T12:00:00Z'), DTYPES[e.type].n, e.ticker || '', e.amount, e.cur, Math.round(divInField(e, 'divFII') * 100) / 100])], [12, 10, 10, 12, 7, 12], { 0: 'dd/mm/yyyy', 5: BR });
  if ((DB.daily || []).length) add('Diário', [['Data', 'Patrimônio (R$)', 'GBP/BRL', 'USD/BRL'], ...DB.daily.map((x) => [new Date(x.d + 'T12:00:00Z'), x.v, x.g, x.u])], [12, 18, 10, 10], { 0: 'dd/mm/yyyy', 1: BR });
  add('Histórico', [['Mês', 'Patrimônio (R$)', 'Aporte (£)', 'GBP/BRL', 'Aporte (R$)', 'Div FIIs (R$)', 'Div Ações (R$)', 'Div Stocks (£)', 'Div total (R$)', 'Variação (R$)', `Rendimento sem aporte (${BSYM()})`, `Retorno do mês (em ${BSYM()})`, 'Observação'],
    ...H.map((h, i) => { const prev = H[i - 1], v = prev && typeof prev.pat === 'number' && typeof h.pat === 'number' && ymDiff(prev.month, h.month) === 1 ? h.pat - prev.pat : null, rm = rByM[h.month];
      return [md(h.month), h.pat ?? null, h.aporteGBP ?? null, h.fx ?? null, h.aporteGBP != null && h.fx ? apMonthBRL(h.month, h.fx, h.aporteGBP) : null, h.divFII ?? null, h.divAcoes ?? null, h.divStocks ?? null, divTotal(h), v, rm ? rm.gain : null, rm ? rm.r : null, h.note || null]; })],
    [10, 16, 11, 9, 13, 13, 13, 12, 13, 14, 18, 12, 30], { 0: 'mmm/yyyy', 1: BR, 2: GB, 3: '0.0000', 4: BR, 5: BR, 6: BR, 7: GB, 8: BR, 9: BR, 10: BR, 11: PC });
  const yrs = yearsList(), cell = (y, i) => { const h = H.find((x) => x.month === `${y}-${String(i + 1).padStart(2, '0')}`); return h ? divTotal(h) : null; };
  const dRows = [['Mês', ...yrs.map(Number)], ...MONTHS.map((m, i) => [m, ...yrs.map((y) => cell(y, i))]), ['Total', ...yrs.map((y) => MONTHS.reduce((a, _, i) => a + (cell(y, i) || 0), 0))]];
  add('Dividendos', dRows, [12, ...yrs.map(() => 11)], Object.fromEntries(yrs.map((_, i) => [i + 1, '#,##0.00'])));
  add('Rentabilidade', [['Ano', 'Meses medidos', `Aportes (${BSYM()})`, `Ganho sem aportes (${BSYM()})`, `Retorno em ${BSYM()} (com câmbio)`], ...R.years.map((y) => [Number(y.year), y.n, y.aporte, y.gain, y.r])], [8, 14, 14, 22, 22], { 2: BASE() === 'GBP' ? GB : BR, 3: BASE() === 'GBP' ? GB : BR, 4: PC });
  add('Carteira hoje', [['Classe', 'Valor (R$)', '% atual', 'Meta %'], ...P.alloc.map((a) => [a.n, a.v, a.cur, a.tgt]), ['Caixa', DB.balances.caixa, null, null], ['Total', P.total, null, null], [],
    ['Preços usados', 'Valor'], ['GBP/BRL', DB.prices.gbpbrl], ['USD/BRL', DB.prices.usdbrl], ...COINS.map((c) => [c.k + ' (US$)', DB.prices[c.k]]), ['Atualizados em', DB.prices.updatedAt ? new Date(DB.prices.updatedAt) : null]],
    [16, 16, 10, 10], { 1: '#,##0.00', 2: PC, 3: PC });
  add('Cripto', [['Data', 'Nome', 'Operação', 'Cripto', 'Quantidade', 'Valor (US$)', 'Preço (US$)'], ...DB.crypto.log.map((x) => [x.date ? new Date(x.date + 'T12:00:00Z') : null, x.name, x.op, x.coin, x.qty, x.value, x.price]), [],
    ['Saldo atual', '', '', 'Moeda', 'Quantidade', 'Valor (US$)', 'Valor (R$)'], ...cs.coins.map((c) => ['', '', '', c.k, c.units, c.valUSD, c.valBRL])],
    [11, 10, 10, 8, 14, 13, 13], { 0: 'dd/mm/yyyy', 4: '0.00000000', 5: '#,##0.00', 6: '#,##0.00' });
  if ((DB.assets || []).length) add('Ativos', [['Classe', 'Ticker', 'Tipo', 'Fonte do preço', 'Moeda', 'Quantidade', 'Preço', 'Preço médio', 'Valor (R$)', 'Lucro (R$)'],
    ...ACLS.flatMap((c) => assetRows(c.k).map((r) => [c.n, r.a.ticker, r.a.kind || '', r.a.market, r.cur, r.a.qty, r.pr, r.a.avg ?? null, r.value, r.pl]))],
    [10, 10, 8, 12, 7, 14, 12, 12, 14, 14], { 5: '0.########', 6: '#,##0.00', 7: '#,##0.00', 8: BR, 9: BR });
  const out = X.write(wb, { bookType: 'xlsx', type: 'array' });
  const name = `rumo-ao-milhao-${new Date().toISOString().slice(0, 10)}.xlsx`;
  const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const f = new File([blob], name, { type: blob.type });
  try {
    if (navigator.canShare && navigator.canShare({ files: [f] })) await navigator.share({ files: [f], title: name });
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
    toast('Excel criado');
  } catch (e) { if (e.name !== 'AbortError') toast('Não foi possível salvar o arquivo'); }
}

/* ---------------- boot ---------------- */
applyTheme();
if (!PREVIEW && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((r) => r.update()).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded && !DB) { reloaded = true; location.reload(); } });
}
async function forceUpdate() {
  if (!(await ask('Baixar a versão mais nova do app? Seus dados não são afetados.'))) return;
  try {
    for (const k of await caches.keys()) await caches.delete(k);
    for (const r of (await navigator.serviceWorker?.getRegistrations()) || []) await r.unregister();
  } catch {}
  location.replace(location.pathname + '?u=' + Date.now());
}
if (localStorage.getItem(K_META) && localStorage.getItem(K_DATA)) {
  const m0 = getMeta();
  if (m0?.v === 2 && m0.open) openWithRaw(unb64(m0.open)).then(enterApp).catch(() => showLock('unlock'));
  else showLock('unlock');
}
else { localStorage.removeItem(K_META); showLock('setup'); }
