// "Aset" screen for accounts with kind "exchange" (window.DAR_WS.kind), loaded by
// api/workspace.js after the dashboard script. The owner changes rupiah into pounds/dollars at
// prices he sets per person, so instead of logging every trade he types what he holds: rupiah
// per bank, foreign money per place (InstaPay, cash), valued at his own rate, all added up.
// Titipan tracks other people's money he holds.
//
// The buy/sell log below (no longer shown, kept for titipan "kirim rupiah"): every trade is kept; stock, the average purchase price (modal) and the profit of each sale
// are recomputed from all trades in date order, so editing or deleting one keeps everything
// consistent. Rupiah received or paid moves the chosen saldo account, like spendings do.
const FX_CURRENCIES = (window.DAR_WS && window.DAR_WS.currencies && window.DAR_WS.currencies.length ? window.DAR_WS.currencies : ['EGP', 'USD']);
const FX_NAMES = { IDR: 'Rupiah', EGP: 'Pound Mesir', USD: 'Dollar AS', SAR: 'Riyal Saudi', EUR: 'Euro', MYR: 'Ringgit' };
// Places in Aset may hold rupiah too (cash rupiah), besides the account's foreign currencies.
const HOLDING_CURRENCIES = ['IDR', ...FX_CURRENCIES];
const FX_LOCAL_KEY = 'dar-exchange';
const FX_TYPES = {
    jual: { label: 'Jual ke pelanggan', short: 'Jual' },
    beli: { label: 'Beli / restok valas', short: 'Beli' },
    koreksi: { label: 'Koreksi stok', short: 'Koreksi' }
};
// Titipan (other people's money). people: investors (rupiah), workers (salary in pounds),
// others (e.g. dollars). moves: setor (they leave money), ambil (they take it back in the same
// currency), kirim (a worker's foreign balance is paid out in rupiah: the foreign cash stays
// with the owner and becomes his own stock through a linked "beli" trade).
const FX_DEPOSIT_KINDS = {
    investor: { label: 'Investor', hint: 'Dana investor' },
    pekerja: { label: 'Pekerja', hint: 'Titip gaji (pound)' },
    pelanggan: { label: 'Belum diserahkan', hint: 'Pelanggan sudah transfer, dananya belum diserahkan' },
    lainnya: { label: 'Titipan', hint: 'Titipan lain (mis. dollar)' }
};
const FX_MOVE_TYPES = {
    setor: { label: 'Setor / nitip', short: 'Setor' },
    ambil: { label: 'Ambil uang', short: 'Ambil' },
    kirim: { label: 'Kirim rupiah', short: 'Kirim' }
};
const FX_DEPOSIT_CURRENCIES = ['IDR', ...FX_CURRENCIES];
const ASSET_HISTORY_FIELDS = ['total', 'pegangan', 'bank', 'valas', 'talangan', 'titipan', 'investor', 'hutang', 'profit', 'spent'];

let exchangeState = (() => {
    try { return normalizeExchange(JSON.parse(localStorage.getItem(FX_LOCAL_KEY) || 'null')); } catch (e) { return normalizeExchange(null); }
})();
let fxMonth = currentMonthKey();
let fxEditId = '';
// A limited login (users[].limited, e.g. the one who only enters records): the server sends
// just their own records, so this screen shows only entering and their own daily report.
const FX_LIMITED = !!(window.DAR_WS && window.DAR_WS.user && window.DAR_WS.user.limited);
let fxPane = FX_LIMITED ? 'laporan' : 'aset';

// Aset: foreign money the owner holds, per place (InstaPay, cash...), typed in directly and
// valued in rupiah at his own rate (assetRates, Rp per 1).
function defaultHoldings() {
    const first = FX_CURRENCIES[0];
    return [
        { id: 'hold-instapay', label: 'InstaPay', currency: first, amount: 0 },
        { id: 'hold-cash-' + first.toLowerCase(), label: 'Cash', currency: first, amount: 0 },
        ...FX_CURRENCIES.slice(1).map(c => ({ id: 'hold-cash-' + c.toLowerCase(), label: 'Cash', currency: c, amount: 0 }))
    ];
}

function normalizeExchange(value) {
    const out = { rates: {}, assetRates: {}, buyRates: {}, crossRates: {}, holdings: defaultHoldings(), deals: [], incomes: [], assetHistory: {}, assetDaily: {}, trades: {}, demo: false, deposits: { people: [], moves: [] } };
    FX_CURRENCIES.forEach(c => {
        const r = value && value.rates && value.rates[c];
        out.rates[c] = { sell: Math.max(0, Number(r && r.sell) || 0), buy: Math.max(0, Number(r && r.buy) || 0) };
        out.assetRates[c] = Math.max(0, Number(value && value.assetRates && value.assetRates[c]) || 0);
        // Kurs beli set under Update saldo (pound/dollar → rupiah).
        out.buyRates[c] = Math.max(0, Number(value && value.buyRates && value.buyRates[c]) || 0);
    });
    if (!value || typeof value !== 'object') return out;
    if (Array.isArray(value.holdings)) {
        out.holdings = value.holdings.filter(h => h && HOLDING_CURRENCIES.includes(h.currency)).slice(0, 40).map(h => ({
            id: String(h.id || 'hold-' + crypto.randomUUID()).slice(0, 80),
            label: String(h.label || '').slice(0, 40),
            // "orang": the owner's money that someone else holds (label = that person's name).
            kind: h.kind === 'orang' ? 'orang' : '',
            currency: h.currency,
            amount: Math.round((Number(h.amount) || 0) * 100) / 100
        }));
    }
    out.demo = value.demo === true;
    Object.entries(value.trades || {}).forEach(([month, list]) => {
        if (!/^\d{4}-\d{2}$/.test(month) || !Array.isArray(list)) return;
        out.trades[month] = list.filter(t => t && FX_TYPES[t.type] && FX_CURRENCIES.includes(t.currency) && /^\d{4}-\d{2}-\d{2}$/.test(t.date || '') && Number(t.qty))
            .map(t => ({
                id: String(t.id || 'fx-' + crypto.randomUUID()),
                type: t.type,
                date: t.date,
                currency: t.currency,
                qty: Math.round(Number(t.qty) * 100) / 100,
                rate: Math.max(0, Number(t.rate) || 0),
                idr: Math.round(Number(t.idr) || 0),
                customer: String(t.customer || '').slice(0, 80),
                note: String(t.note || '').slice(0, 160),
                bankKey: String(t.bankKey || '').slice(0, 40),
                bankDelta: Math.round(Number(t.bankDelta) || 0),
                linked: typeof t.linked === 'string' ? t.linked : '',
                demo: t.demo === true,
                createdAt: Number(t.createdAt) || Date.now()
            }));
    });
    out.deposits = normalizeDeposits(value.deposits);
    // Monthly asset report: the last known numbers of each month.
    out.assetHistory = {};
    Object.entries(value.assetHistory || {}).forEach(([month, s]) => {
        if (!/^\d{4}-\d{2}$/.test(month) || !s || typeof s !== 'object') return;
        out.assetHistory[month] = Object.fromEntries(ASSET_HISTORY_FIELDS.map(k => [k, Math.round(Number(s[k]) || 0)]));
        out.assetHistory[month].at = /^\d{4}-\d{2}-\d{2}$/.test(s.at || '') ? s.at : `${month}-01`;
    });
    // Daily report: the aset bersih at the end of each day (last 62 days kept).
    out.assetDaily = {};
    Object.keys(value.assetDaily || {}).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().slice(-62).forEach(day => {
        const s = value.assetDaily[day];
        if (s && typeof s === 'object') out.assetDaily[day] = { total: Math.round(Number(s.total) || 0), pegangan: Math.round(Number(s.pegangan) || 0) };
    });
    out.deals = (Array.isArray(value.deals) ? value.deals : []).filter(d => d && FX_CURRENCIES.includes(d.currency) && Number(d.qty) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(d.date || '')).map(d => ({
        id: String(d.id || 'deal-' + crypto.randomUUID()).slice(0, 80),
        date: d.date,
        name: String(d.name || '').slice(0, 80),
        currency: d.currency,
        qty: Math.round(Number(d.qty) * 100) / 100,
        holdingId: String(d.holdingId || ''),
        holdDelta: Math.round((Number(d.holdDelta) || 0) * 100) / 100,
        idr: Math.round(Number(d.idr) || 0),
        bankKey: String(d.bankKey || '').slice(0, 40),
        bankDelta: Math.round(Number(d.bankDelta) || 0),
        modal: Math.max(0, Number(d.modal) || 0),
        dir: d.dir === 'beli' ? 'beli' : (d.dir === 'swap' && FX_CURRENCIES.includes(d.currency2) && Number(d.qty2) > 0 ? 'swap' : 'jual'),
        // Foreign ↔ foreign ("swap"): the second currency that came in, and where it went.
        currency2: FX_CURRENCIES.includes(d.currency2) ? d.currency2 : '',
        qty2: Math.round((Number(d.qty2) || 0) * 100) / 100,
        holdingId2: String(d.holdingId2 || ''),
        holdDelta2: Math.round((Number(d.holdDelta2) || 0) * 100) / 100,
        modal2: Math.max(0, Number(d.modal2) || 0),
        // Restok (e.g. pound from a TKW): its kurs became the kurs modal.
        restock: d.dir === 'beli' && d.restock === true,
        by: String(d.by || '').slice(0, 40),
        demo: d.demo === true,
        createdAt: Number(d.createdAt) || Date.now()
    }));
    // Last kurs used per foreign pair, e.g. { "USD-EGP": 62.5 } (EGP per 1 USD).
    out.crossRates = {};
    Object.entries(value.crossRates || {}).forEach(([k, v]) => {
        if (/^[A-Z]{3}-[A-Z]{3}$/.test(k) && Number(v) > 0) out.crossRates[k] = Math.round(Number(v) * 100) / 100;
    });
    // Other income (not from tukar): rupiah into a bank. bankAdd is what was added to that bank.
    // amount = the rupiah value (0 for pounds/dollars while there is no kurs modal);
    // currency/fxAmount = the money itself; holdingId/holdAdd = the place in Aset it went to.
    const foreign = x => FX_CURRENCIES.includes(x.currency);
    out.incomes = (Array.isArray(value.incomes) ? value.incomes : []).filter(x => x && (Number(x.amount) > 0 || (foreign(x) && Number(x.fxAmount) > 0)) && /^\d{4}-\d{2}-\d{2}$/.test(x.date || '')).map(x => ({
        id: String(x.id || 'inc-' + crypto.randomUUID()).slice(0, 80),
        date: x.date,
        amount: Math.max(0, Math.round(Number(x.amount)) || 0),
        ...(foreign(x) ? { currency: x.currency, fxAmount: Math.round(Number(x.fxAmount) * 100) / 100, rate: Math.max(0, Number(x.rate) || 0) } : {}),
        ...(x.holdingId ? { holdingId: String(x.holdingId).slice(0, 80), holdAdd: Math.max(0, Math.round((Number(x.holdAdd) || 0) * 100) / 100) } : {}),
        note: String(x.note || '').slice(0, 160),
        bankKey: String(x.bankKey || '').slice(0, 40),
        bankAdd: Math.max(0, Math.round(Number(x.bankAdd) || 0)),
        by: String(x.by || '').slice(0, 40),
        createdAt: Number(x.createdAt) || Date.now()
    }));
    return out;
}

// ---------- Titipan: other people's money the money changer holds ----------
function normalizeDeposits(value) {
    const out = { people: [], moves: [] };
    if (!value || typeof value !== 'object') return out;
    out.people = (Array.isArray(value.people) ? value.people : []).filter(p => p && p.id && p.name).map(p => ({
        id: String(p.id).slice(0, 80),
        name: String(p.name).slice(0, 80),
        kind: FX_DEPOSIT_KINDS[p.kind] ? p.kind : 'lainnya',
        phone: String(p.phone || '').slice(0, 30),
        note: String(p.note || '').slice(0, 160),
        demo: p.demo === true,
        createdAt: Number(p.createdAt) || Date.now()
    }));
    const ids = new Set(out.people.map(p => p.id));
    out.moves = (Array.isArray(value.moves) ? value.moves : []).filter(m => m && ids.has(m.personId) && FX_MOVE_TYPES[m.type] && FX_DEPOSIT_CURRENCIES.includes(m.currency) && Number(m.amount) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(m.date || '')).map(m => ({
        id: String(m.id || 'dep-' + crypto.randomUUID()),
        personId: m.personId,
        type: m.type,
        currency: m.currency,
        amount: m.currency === 'IDR' ? Math.round(Number(m.amount)) : Math.round(Number(m.amount) * 100) / 100,
        rate: Math.max(0, Number(m.rate) || 0),
        idr: Math.round(Number(m.idr) || 0),
        date: m.date,
        bankKey: String(m.bankKey || '').slice(0, 40),
        bankDelta: Math.round(Number(m.bankDelta) || 0),
        tradeId: String(m.tradeId || ''),
        note: String(m.note || '').slice(0, 160),
        by: String(m.by || '').slice(0, 40),
        demo: m.demo === true,
        createdAt: Number(m.createdAt) || Date.now()
    }));
    return out;
}

// Balance per person and in total, per currency (IDR, EGP, USD...).
function depositBalances() {
    const empty = () => Object.fromEntries(FX_DEPOSIT_CURRENCIES.map(c => [c, 0]));
    const byPerson = Object.fromEntries(exchangeState.deposits.people.map(p => [p.id, empty()]));
    const totals = empty();
    exchangeState.deposits.moves.forEach(m => {
        const sign = m.type === 'setor' ? 1 : -1;
        if (byPerson[m.personId]) byPerson[m.personId][m.currency] += sign * m.amount;
        totals[m.currency] += sign * m.amount;
    });
    const round = o => Object.keys(o).forEach(c => { o[c] = c === 'IDR' ? Math.round(o[c]) : Math.round(o[c] * 100) / 100; });
    Object.values(byPerson).forEach(round);
    round(totals);
    return { byPerson, totals };
}

function fxAmount(amount, currency) {
    return currency === 'IDR' ? formatIDR(amount) : `${fxQty(amount)} ${currency}`;
}

// Currency pickers as flag buttons: the <select> stays (hidden) and keeps the logic; the
// buttons just set it.
const FX_CHIP_SELECTS = ['fxCurrency', 'fxMoveCurrency', 'fxStockCurrency'];

function renderFxChips() {
    FX_CHIP_SELECTS.forEach(id => {
        const select = document.getElementById(id);
        if (!select) return;
        let box = select.parentNode.querySelector(`.fx-cur-chips[data-for="${id}"]`);
        if (!box) {
            box = document.createElement('div');
            box.className = 'fx-cur-chips';
            box.dataset.for = id;
            select.classList.add('fx-hidden-select');
            select.after(box);
        }
        box.innerHTML = [...select.options].map(o => `
            <button type="button" class="${o.value === select.value ? 'active' : ''}" aria-pressed="${o.value === select.value}" onclick="pickFxChip('${id}', '${o.value}')">
                ${fxFlag(o.value, 'fx-flag is-lg')}<span>${o.value}</span>
            </button>`).join('');
    });
}

function pickFxChip(id, value) {
    const select = document.getElementById(id);
    if (!select || select.value === value) return;
    select.value = value;
    select.dispatchEvent(new Event('change'));
    renderFxChips();
}

function fxAllTrades() {
    return Object.values(exchangeState.trades).flat();
}

// Replay all trades in order: stock and average modal per currency, cost and profit per trade.
function computeExchange() {
    const stock = Object.fromEntries(FX_CURRENCIES.map(c => [c, { qty: 0, avg: 0 }]));
    const result = {};
    fxAllTrades().slice().sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt).forEach(t => {
        const s = stock[t.currency];
        if (!s) return;
        const adds = t.type === 'beli' || (t.type === 'koreksi' && t.qty > 0);
        if (adds) {
            const qty = Math.abs(t.qty);
            if (s.qty > 0) {
                s.avg = (s.qty * s.avg + qty * t.rate) / (s.qty + qty);
            } else {
                s.avg = t.rate; // empty (or oversold) stock: the new purchase sets the modal
            }
            s.qty += qty;
            result[t.id] = { cost: Math.round(qty * t.rate), profit: 0 };
        } else {
            const qty = Math.abs(t.qty);
            const cost = Math.round(qty * (s.avg || t.rate));
            s.qty -= qty;
            result[t.id] = { cost, profit: t.type === 'jual' ? t.idr - cost : 0 };
        }
    });
    return { stock, result };
}

// Small inline flags (emoji flags do not show on Windows).
const FX_FLAGS = {
    IDR: '<rect width="30" height="10" fill="#e70011"/><rect y="10" width="30" height="10" fill="#fff"/>',
    EGP: '<rect width="30" height="20" fill="#fff"/><rect width="30" height="6.67" fill="#ce1126"/><rect y="13.33" width="30" height="6.67" fill="#000"/><path d="M15 7.4l1.6 1.2-.4 2.6h-2.4l-.4-2.6z" fill="#c09300"/><rect x="13.6" y="11.3" width="2.8" height=".9" fill="#c09300"/>',
    USD: '<rect width="30" height="20" fill="#fff"/>' + [0, 2, 4, 6, 8, 10, 12].map(i => `<rect y="${(i * 20) / 13}" width="30" height="${20 / 13}" fill="#b22234"/>`).join('') + '<rect width="13" height="10.77" fill="#3c3b6e"/>' + [[2.2, 2], [5.4, 2], [8.6, 2], [11, 2], [3.8, 4.6], [7, 4.6], [10.2, 4.6], [2.2, 7.2], [5.4, 7.2], [8.6, 7.2], [11, 7.2]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".55" fill="#fff"/>`).join(''),
    SAR: '<rect width="30" height="20" fill="#006c35"/><rect x="8" y="12.5" width="14" height="1" fill="#fff"/>',
    EUR: '<rect width="30" height="20" fill="#039"/><circle cx="15" cy="10" r="5" fill="none" stroke="#fc0" stroke-width="1" stroke-dasharray="1 1.6"/>'
};

function fxFlag(c, cls = 'fx-flag') {
    const body = FX_FLAGS[c];
    return body ? `<svg class="${cls}" viewBox="0 0 30 20" aria-hidden="true"><clipPath id="fxf-${c}-${cls}"><rect width="30" height="20" rx="2.5"/></clipPath><g clip-path="url(#fxf-${c}-${cls})">${body}</g></svg>` : '';
}

// Rupiah value of a foreign amount at the owner's own rate (0 while no rate is set).
function assetIdr(amount, currency) {
    if (currency === 'IDR') return Math.round(Number(amount) || 0);
    return Math.round((Number(amount) || 0) * (exchangeState.assetRates[currency] || 0));
}

// Rupiah needs no kurs; pounds/dollars need the owner's kurs modal to be counted.
function rateKnown(currency) {
    return currency === 'IDR' || !!exchangeState.assetRates[currency];
}

// How a place is called on screen: "InstaPay", "Cash", or "Di Afifah" for money someone holds.
function placeName(h) {
    if (h.kind === 'orang') return `Di ${h.label || '…'}`;
    return h.label || h.currency;
}

// Everything added up, the way the owner keeps it in his notebook:
//   aset = pegangan (bank + pounds/dollars held) + talangan (what people owe him)
//          - uang orang (titipan, money he still has to hand over) - his own debts
// Investor money is shown apart and is NOT in the formula yet (to be confirmed by the owner).
function assetTotals() {
    const bank = BANK_ACCOUNTS.reduce((s, acc) => s + (Number(bankBalances[acc.key]) || 0), 0);
    // Places the owner holds (pounds, dollars, cash rupiah) and pockets of his money others hold.
    const valas = exchangeState.holdings.filter(h => h.kind !== 'orang').reduce((s, h) => s + assetIdr(h.amount, h.currency), 0);
    const orang = exchangeState.holdings.filter(h => h.kind === 'orang').reduce((s, h) => s + assetIdr(h.amount, h.currency), 0);
    const { totals: held, byPerson } = depositBalances();
    const inIdr = bal => bal.IDR + FX_CURRENCIES.reduce((s, c) => s + assetIdr(bal[c], c), 0);
    // Investor money is its own pos and stays out of the formula until the owner says how it
    // should count. Everything else people left with him is "uang orang".
    const investor = exchangeState.deposits.people.filter(p => p.kind === 'investor').reduce((s, p) => s + inIdr(byPerson[p.id]), 0);
    const titipan = inIdr(held) - investor;
    const open = (typeof debts !== 'undefined' && Array.isArray(debts) ? debts : []).filter(d => getDebtStatus(d) !== 'SETTLED');
    const left = d => Math.max(0, d.amount - (d.paid || 0));
    const talangan = open.filter(d => d.type === 'piutang').reduce((s, d) => s + debtIdr(left(d), d), 0);
    const hutang = open.filter(d => d.type === 'hutang').reduce((s, d) => s + debtIdr(left(d), d), 0);
    const used = new Set([
        ...exchangeState.holdings.filter(h => h.amount).map(h => h.currency),
        ...FX_CURRENCIES.filter(c => held[c]),
        ...open.map(debtCurrency)
    ]);
    const missingRate = FX_CURRENCIES.filter(c => !exchangeState.assetRates[c] && used.has(c));
    const pegangan = bank + valas + orang;
    return { bank, valas, orang, pegangan, talangan, titipan, investor, hutang, total: pegangan + talangan - titipan - hutang, missingRate };
}

// Foreign money shown under saldo next to the rupiah accounts, valued at the owner's rate.
function exchangeCashSummary() {
    let valueIdr = 0;
    const html = exchangeState.holdings.filter(h => h.amount).map(h => {
        const value = assetIdr(h.amount, h.currency);
        valueIdr += value;
        return `
        <div class="bank-item-card fx-cash-card">
            <div class="bank-item-top">
                <div class="bank-item-brand">${fxFlag(h.currency, 'fx-flag is-lg')}<span class="bank-tag-primary">${escapeHTML(placeName(h))}</span></div>
            </div>
            <div class="bank-account-num">${h.kind === 'orang' ? 'Dipegang orang · ' : ''}${FX_NAMES[h.currency] || h.currency}</div>
            <div class="bank-balance-amount">${fxAmount(h.amount, h.currency)}</div>
            <div class="fx-cash-value">${h.currency === 'IDR' ? 'Rupiah tunai' : exchangeState.assetRates[h.currency] ? `≈ ${formatIDR(value)} · kurs ${kursText(exchangeState.assetRates[h.currency], h.currency)}` : 'kurs belum diisi'}</div>
            <button type="button" class="bank-copy-btn" onclick="openHoldingAmountEdit('${escapeHTML(h.id)}')">Ubah jumlah</button>
        </div>`;
    }).join('');
    return { html, valueIdr };
}

function fxDefaultBank() {
    return defaultEntryBank();
}

function fxQty(n) {
    return (Number(n) || 0).toLocaleString('id-ID', { maximumFractionDigits: 2 });
}

function fxRate(n) {
    return 'Rp ' + (Number(n) || 0).toLocaleString('id-ID', { maximumFractionDigits: 2 });
}

// Pound ↔ rupiah is typed and shown the way Ziaud says it: pound per Rp 1 juta
// ("3.000" = 3.000 EGP for Rp 1.000.000). Inside, every kurs stays "Rp per 1 EGP".
const KURS_PER_JUTA = ['EGP'];
function isPerJuta(c) {
    return KURS_PER_JUTA.includes(c);
}

// A kurs (Rp per 1) as the number to put in an input.
function kursToField(rate, c) {
    if (!rate) return '';
    if (!isPerJuta(c)) return Math.round(rate * 100) / 100;
    const v = 1e6 / rate;
    return Math.abs(v - Math.round(v)) < 0.05 ? Math.round(v) : Math.round(v * 100) / 100;
}

// What was typed in an input, back to Rp per 1.
function kursFromField(value, c) {
    const n = Math.max(0, Number(value) || 0);
    return n && isPerJuta(c) ? 1e6 / n : n;
}

function kursText(rate, c) {
    if (!rate) return '-';
    return isPerJuta(c) ? `${fxQty(kursToField(rate, c))} ${c} per Rp 1 jt` : fxRate(rate);
}

function saveExchangeLocal() {
    try { localStorage.setItem(FX_LOCAL_KEY, JSON.stringify(exchangeState)); } catch (e) {}
}

function saveExchangeAndSync() {
    saveExchangeLocal();
    saveLocalBankBalances();
    renderBankBalancesUI();
    renderExchangeUI();
    persistBillingState();
}

// Cloud copy from api/billing-state.js. A cloud copy never saved yet comes back empty: keep
// trades made on this device until they sync.
function applyExchangeState(value) {
    const cloud = normalizeExchange(value);
    const hasData = s => fxAllTradesOf(s).length || s.deposits.people.length || Object.values(s.rates).some(r => r.sell || r.buy)
        || Object.values(s.assetRates).some(Boolean) || s.holdings.some(h => h.amount) || s.deals.length;
    // Don't overwrite numbers being typed on the Aset screen.
    if (assetSaveTimer) return;
    // Sample data removed on the server must not come back from this device's copy.
    const marked = s => s.demo || fxAllTradesOf(s).some(t => t.demo) || s.deposits.people.some(p => p.demo);
    if (hasData(cloud) || !hasData(exchangeState) || (marked(exchangeState) && !marked(cloud))) exchangeState = cloud;
    saveExchangeLocal();
    renderExchangeUI();
}

function fxAllTradesOf(state) {
    return Object.values(state.trades).flat();
}

// After a manual "Update saldo" the typed balances already include every trade so far.
function exchangeOnManualBankUpdate() {
    fxAllTrades().forEach(t => { t.bankDelta = 0; });
    exchangeState.deals.forEach(d => { d.bankDelta = 0; });
    exchangeState.deposits.moves.forEach(m => { m.bankDelta = 0; });
    exchangeState.incomes.forEach(x => { x.bankAdd = 0; });
    saveExchangeLocal();
}

// One bank changed from its card ("Ubah saldo"): like typing it in Update saldo.
function exchangeOnBankAmountEdit(key) {
    assetDirtyBanks.add(key);
    flushAssetSave();
    renderAssetPane();
    renderExchangeUI();
}

// One place in Aset changed from its card ("Ubah jumlah").
function openHoldingAmountEdit(id) {
    const h = exchangeState.holdings.find(x => x.id === id);
    if (!h) return;
    const name = placeName(h) || FX_NAMES[h.currency] || h.currency;
    openAmountDialog({
        title: `Ubah jumlah ${name}`,
        label: `${h.currency === 'IDR' ? 'Rupiah' : FX_NAMES[h.currency] || h.currency} di ${name} sekarang`,
        value: h.amount,
        currency: h.currency,
        hint: h.kind === 'orang' ? 'Uang kamu yang lagi dipegang orang ini.' : 'Ketik jumlah yang ada sekarang.',
        onSave: value => {
            h.amount = value;
            flushAssetSave();
            renderAssetPane();
            renderExchangeUI();
            showToast(`${name.toUpperCase()} JADI ${fxAmount(value, h.currency).toUpperCase()}`);
        }
    });
}

// Rupiah side of a titipan move: setor IDR adds to the account, ambil IDR and kirim take out.
function depositBankDeltaFor(m) {
    if (!isBankKey(m.bankKey)) return 0;
    if (bankBalancesUpdatedAt && m.date < bankBalancesUpdatedAt) return 0;
    if (m.type === 'kirim') return -m.idr;
    if (m.currency !== 'IDR') return 0;
    return m.type === 'setor' ? m.amount : -m.amount;
}

// Under a rupiah account: how much of it is investors' money.
function exchangeBankNote(key) {
    if (!BANK_ACCOUNTS.length || key !== BANK_ACCOUNTS[0].key) return '';
    const idr = depositBalances().totals.IDR;
    if (!idr) return '';
    const own = (Number(bankBalances[key]) || 0) - idr;
    return `<div class="fx-cash-split">titipan orang <b>${formatIDR(idr)}</b> · milik sendiri <b class="${own < 0 ? 'fx-minus' : ''}">${formatIDR(own)}</b></div>`;
}

function fxBankDeltaFor(t) {
    if (!isBankKey(t.bankKey) || t.type === 'koreksi') return 0;
    if (bankBalancesUpdatedAt && t.date < bankBalancesUpdatedAt) return 0;
    return t.type === 'jual' ? t.idr : -t.idr;
}

function fxApplyBank(t, sign) {
    if (!t.bankDelta || !isBankKey(t.bankKey)) return;
    bankBalances[t.bankKey] = (Number(bankBalances[t.bankKey]) || 0) + sign * t.bankDelta;
}

// ---------- UI ----------
function ensureExchangeUI() {
    if (document.getElementById('exchangeSection')) return;
    const nav = document.querySelector('.workspace-sidebar nav');
    if (nav && !nav.querySelector('[data-view="tukar"]')) {
        const button = document.createElement('button');
        button.className = 'sidebar-link';
        button.dataset.view = 'tukar';
        button.dataset.short = 'Aset';
        button.setAttribute('aria-pressed', 'false');
        button.onclick = () => setWorkspaceView('tukar');
        button.innerHTML = '<span aria-hidden="true"><svg class="nav-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/></svg></span> Aset';
        nav.insertBefore(button, nav.firstChild);
        // No invoices, no invoice-based report and no travel packing list here: Aset has its own
        // Laporan (untung tukar vs pengeluaran).
        ['pack', 'board', 'report'].forEach(view => {
            const link = nav.querySelector(`[data-view="${view}"]`);
            if (link) link.style.setProperty('display', 'none', 'important');
        });
        const sideNote = document.querySelector('.sidebar-note p');
        if (sideNote) sideNote.textContent = FX_LIMITED
            ? 'Catat tiap tukar, pemasukan, dan pengeluaran di sini. Laporan harianmu langsung terlihat di bawahnya.'
            : 'Saldo bank, pound & dollar diatur dari Update saldo. Tiap tukar dicatat lewat + Catat tukar.';
        if (FX_LIMITED) {
            button.dataset.short = 'Laporan';
            button.lastChild.textContent = ' Laporan saya';
        }
        // His word for money lent out is "talangan".
        const debtLink = nav.querySelector('[data-view="debt"]');
        if (debtLink) {
            const text = [...debtLink.childNodes].reverse().find(n => n.nodeType === 3 && n.textContent.trim());
            if (text) text.textContent = ' Talangan & hutang';
            debtLink.dataset.short = 'Talangan';
        }
    }
    // A spending saved from the Laporan tab shows up there right away.
    const expenseDialog = document.getElementById('expenseLogDialog');
    if (expenseDialog) expenseDialog.addEventListener('close', () => { if (document.body.dataset.view === 'tukar') renderExchangeUI(); });

    const section = document.createElement('div');
    section.id = 'exchangeSection';
    section.innerHTML = `
        <div class="fx-demo-banner" id="fxDemoBanner" hidden>
            <div><b>Ini data contoh.</b> Saldo, catat tukar, titipan, talangan, pengeluaran, dan laporan bulanan di sini cuma gambaran cara pakainya. Kalau mau mulai pakai beneran, klik Hapus data contoh.</div>
            <button type="button" class="month-pill-btn" onclick="clearFxDemo()">Hapus data contoh</button>
        </div>
        <div class="fx-pane-tabs" role="tablist" aria-label="Bagian aset">
            <button type="button" role="tab" data-fx-pane="aset" onclick="setFxPane('aset')">Aset</button>
            <button type="button" role="tab" data-fx-pane="laporan" onclick="setFxPane('laporan')">Laporan</button>
            <button type="button" role="tab" data-fx-pane="titipan" onclick="setFxPane('titipan')">Titipan <b id="fxDepositCount"></b></button>
        </div>
        <datalist id="fxNameList"></datalist>
        <div id="fxReportPane" hidden>
            <div class="fx-toolbar">
                <button type="button" class="create-invoice-btn" onclick="openDealDialog()">+ Catat tukar</button>
                <button type="button" class="month-pill-btn fx-in-btn" onclick="openIncomeDialog()">+ Pemasukan</button>
                <button type="button" class="month-pill-btn fx-out-btn" onclick="openReportExpense()">+ Pengeluaran</button>
            </div>
            <label class="fx-who-search">Riwayat per orang
                <input type="search" id="fxReportWho" list="fxNameList" autocomplete="off" placeholder="Ketik atau pilih nama" oninput="renderReportPane()">
            </label>
            <div class="fx-month-nav">
                <button type="button" class="plan-nav-btn" onclick="shiftReportMonth(-1)" aria-label="Bulan sebelumnya">‹</button>
                <span id="fxReportMonth"></span>
                <button type="button" class="plan-nav-btn" onclick="shiftReportMonth(1)" aria-label="Bulan berikutnya">›</button>
            </div>
            <div class="fx-stats" id="fxReportStats"></div>
            <div class="fx-daily-card" id="fxDailyReport"></div>
            <div id="fxReportList"></div>
        </div>
        <div id="fxAssetPane">
            <div class="stats-bar fx-asset-stats" id="fxAssetStats"></div>
            <button type="button" class="fx-investor-line" id="fxInvestorLine" onclick="setFxPane('titipan')" hidden></button>
            <div class="fx-toolbar">
                <button type="button" class="create-invoice-btn" onclick="openDealDialog()">+ Catat tukar</button>
                <button type="button" class="month-pill-btn fx-in-btn" onclick="openIncomeDialog()">+ Pemasukan</button>
                <button type="button" class="month-pill-btn fx-out-btn" onclick="openReportExpense()">+ Pengeluaran</button>
                <button type="button" class="month-pill-btn" onclick="setFxPane('laporan')">Lihat laporan</button>
            </div>
            <div class="bank-tracker-card fx-own is-expanded">
                <div class="bank-tracker-header">
                    <div class="bank-header-left">
                        <div class="bank-icon-badge" aria-hidden="true">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line></svg>
                        </div>
                        <div>
                            <div class="bank-tracker-title">Pegangan: Rekening &amp; Valas</div>
                            <div class="bank-tracker-subtitle" id="fxAssetSub"></div>
                        </div>
                    </div>
                    <div class="bank-header-right">
                        <div class="bank-total-pill">
                            <span class="bank-total-label">Total pegangan</span>
                            <span class="bank-total-val" id="fxPeganganVal">Rp 0</span>
                        </div>
                        <button type="button" class="bank-edit-btn" onclick="openAssetDialog()">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg> Update saldo
                        </button>
                    </div>
                </div>
                <div class="bank-grid" id="fxAssetGrid"></div>
            </div>
            <div class="bank-tracker-card fx-own is-expanded">
                <div class="bank-tracker-header">
                    <div class="bank-header-left">
                        <div class="bank-icon-badge" aria-hidden="true">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>
                        </div>
                        <div>
                            <div class="bank-tracker-title">Laporan Aset per Bulan</div>
                            <div class="bank-tracker-subtitle">Angka akhir tiap bulan. Bulan ini ikut berubah tiap ada catatan baru.</div>
                        </div>
                    </div>
                </div>
                <div id="fxAssetHistory"></div>
            </div>
        </div>
        <div id="fxDepositPane" hidden>
            <div class="fx-toolbar">
                <button type="button" class="create-invoice-btn" onclick="openDepositMoveDialog('setor')">+ Setor / nitip</button>
                <button type="button" class="month-pill-btn" onclick="openDepositMoveDialog('ambil')">Ambil uang</button>
                <button type="button" class="month-pill-btn" onclick="openDepositMoveDialog('kirim')">Kirim rupiah</button>
                <button type="button" class="month-pill-btn" onclick="openDepositPersonDialog()">+ Orang baru</button>
            </div>
            <div class="fx-stats" id="fxDepositTotals"></div>
            <div id="fxDepositList"></div>
        </div>
        <div id="fxTradePane">
        <div class="fx-quick">
            <div class="fx-quick-head"><b>Kurs hari ini</b><span>Dipakai otomatis waktu catat jual / beli.</span></div>
            <div class="fx-rate-rows">${FX_CURRENCIES.map(c => `
                <div class="fx-rate-row">
                    <span class="fx-rate-cur">${fxFlag(c, 'fx-flag is-lg')}<b>${c}</b></span>
                    <label>Jual<input type="number" min="0" step="0.01" inputmode="decimal" data-quick-rate="${c}:sell" onchange="saveQuickRate(this)"></label>
                    <label>Beli<input type="number" min="0" step="0.01" inputmode="decimal" data-quick-rate="${c}:buy" onchange="saveQuickRate(this)"></label>
                </div>`).join('')}
            </div>
        </div>
        <div class="fx-toolbar">
            <button type="button" class="create-invoice-btn" onclick="openFxDialog('jual')">+ Jual ke pelanggan</button>
            <button type="button" class="month-pill-btn" onclick="openFxDialog('beli')">+ Beli / restok</button>
            <button type="button" class="month-pill-btn" onclick="openFxRatesDialog()">Atur kurs</button>
            <button type="button" class="month-pill-btn" onclick="openFxStockDialog()">Koreksi stok</button>
        </div>
        <div class="fx-cards" id="fxCards"></div>
        <div class="fx-stats" id="fxStats"></div>
        <div class="fx-month-nav">
            <button type="button" class="plan-nav-btn" onclick="shiftFxMonth(-1)" aria-label="Bulan sebelumnya">‹</button>
            <span id="fxMonthLabel"></span>
            <button type="button" class="plan-nav-btn" onclick="shiftFxMonth(1)" aria-label="Bulan berikutnya">›</button>
        </div>
        <div id="fxList"></div>
        </div>`;
    const anchor = document.querySelector('.stats-bar');
    anchor.parentNode.insertBefore(section, anchor);

    // Typing the numbers happens here, like DAR's "Update saldo".
    const assetDialog = document.createElement('dialog');
    assetDialog.id = 'fxAssetDialog';
    assetDialog.className = 'invoice-manager-dialog';
    assetDialog.setAttribute('aria-labelledby', 'fxAssetDialogTitle');
    assetDialog.innerHTML = `
        <div class="manager-heading"><h2 id="fxAssetDialogTitle">Update saldo &amp; kurs</h2><button type="button" aria-label="Tutup" onclick="closeAssetDialog()">×</button></div>
        <div class="manager-content">
            <div class="fx-quick">
                <div class="fx-quick-head"><b>Kurs modal kamu</b><span>Harga stok kamu. Pound: berapa pound per Rp 1 juta (contoh 3000). Dollar: rupiah per 1 dollar. Otomatis ikut kurs restok terakhir di Catat tukar, tetap bisa diubah di sini. Dipakai buat ngerupiahin pound &amp; dollar dan hitung untung tiap tukar.</span></div>
                <div class="fx-asset-rates">${FX_CURRENCIES.map(c => `
                    <label class="fx-asset-rate">${fxFlag(c, 'fx-flag is-lg')}<b>${c}</b>
                        <input type="number" min="0" step="0.01" inputmode="decimal" data-asset-rate="${c}" placeholder="${isPerJuta(c) ? `${c} per Rp 1 juta` : `Rp per 1 ${c}`}" oninput="onAssetRate(this)">
                    </label>`).join('')}
                </div>
            </div>
            <div class="fx-quick">
                <div class="fx-quick-head"><b>Kurs beli</b><span>Kurs kalau orang nuker pound/dollar ke rupiah (pound per Rp 1 juta, rupiah per 1 dollar). Otomatis dipakai di Catat tukar, tetap bisa diubah per transaksi.</span></div>
                <div class="fx-asset-rates">${FX_CURRENCIES.map(c => `
                    <label class="fx-asset-rate">${fxFlag(c, 'fx-flag is-lg')}<b>${c}</b>
                        <input type="number" min="0" step="0.01" inputmode="decimal" data-buy-rate="${c}" placeholder="${isPerJuta(c) ? `${c} per Rp 1 juta` : `Rp per 1 ${c}`}" oninput="onBuyRate(this)">
                    </label>`).join('')}
                </div>
            </div>
            <div class="fx-asset-group">
                <div class="fx-asset-head"><b>Pegangan kamu</b><span id="fxValasSum"></span></div>
                <div id="fxHoldingList"></div>
                <div class="fx-asset-adds">
                    <button type="button" class="month-pill-btn fx-asset-add" onclick="addHolding()">+ Tambah tempat (mis. rekening Mesir)</button>
                    <button type="button" class="month-pill-btn fx-asset-add" onclick="addHolding('', 'IDR', 'Cash Rupiah')">+ Cash rupiah</button>
                </div>
            </div>
            <div class="fx-asset-group">
                <div class="fx-asset-head"><b>Dipegang orang</b><span>uang kamu yang ada di orang lain</span></div>
                <div id="fxHoldingOrangList"></div>
                <button type="button" class="month-pill-btn fx-asset-add" onclick="addHolding('orang')">+ Kantong dipegang orang</button>
            </div>
            <div class="fx-asset-group">
                <div class="fx-asset-head"><b>Rupiah di bank</b><span id="fxBankSum"></span></div>
                <div id="fxAssetBankList"></div>
            </div>
            <p class="bank-cut-hint">Tinggal ketik angkanya, semua otomatis tersimpan dan dijumlah. No. rekening buat tombol "Salin rekening" diatur di <button type="button" class="fx-link-btn" onclick="closeAssetDialog(); openBankBalanceModal()">No. rekening</button>.</p>
            <div class="pack-dialog-actions"><span style="flex:1"></span><button type="button" class="create-invoice-btn" onclick="closeAssetDialog()">Selesai</button></div>
        </div>
    `;
    document.body.appendChild(assetDialog);

    const dialog = document.createElement('dialog');
    dialog.id = 'fxDialog';
    dialog.className = 'invoice-manager-dialog';
    dialog.setAttribute('aria-labelledby', 'fxDialogTitle');
    dialog.innerHTML = `
        <div class="manager-heading"><h2 id="fxDialogTitle">Transaksi</h2><button type="button" aria-label="Tutup" onclick="document.getElementById('fxDialog').close()">×</button></div>
        <div class="manager-content">
            <form id="fxForm" onsubmit="handleFxSubmit(event)">
                <div class="fx-type-switch" role="radiogroup" aria-label="Jenis transaksi">
                    <button type="button" data-fx-type="jual" onclick="setFxType('jual')">Jual ke pelanggan</button>
                    <button type="button" data-fx-type="beli" onclick="setFxType('beli')">Beli / restok</button>
                </div>
                <div class="draft-fields">
                    <label class="wide-field">Mata uang<select id="fxCurrency" onchange="onFxCurrencyChange()">${FX_CURRENCIES.map(c => `<option value="${c}">${c} · ${FX_NAMES[c] || c}</option>`).join('')}</select></label>
                    <label>Jumlah valas<input type="number" id="fxQty" min="0.01" step="0.01" inputmode="decimal" required placeholder="Contoh: 30000" oninput="fxRecalc('qty')"></label>
                    <label>Kurs (Rp per 1)<input type="number" id="fxRate" min="0.01" step="0.01" inputmode="decimal" required oninput="fxRecalc('rate')"></label>
                </div>
                <div class="fx-preview" id="fxPreview"></div>
                <details class="fx-more" id="fxMore">
                    <summary>Lainnya (opsional): total, tanggal, rekening, nama</summary>
                    <div class="draft-fields">
                        <label class="wide-field" id="fxIdrLabel">Total rupiah<input type="number" id="fxIdr" min="1" step="1" inputmode="numeric" oninput="fxRecalc('idr')"></label>
                        <label>Tanggal<input type="date" id="fxDate" onchange="renderFxPreview()"></label>
                        <label id="fxBankLabel">Rupiah masuk ke<select id="fxBank" onchange="renderFxPreview()"></select></label>
                        <label>Nama<input type="text" id="fxCustomer" maxlength="80" placeholder="Opsional"></label>
                        <label>Catatan<input type="text" id="fxNote" maxlength="160" placeholder="Opsional"></label>
                    </div>
                </details>
                <p class="draft-error" id="fxError" role="alert"></p>
                <div class="pack-dialog-actions">
                    <button type="button" class="delete-invoice-btn" id="fxDeleteBtn" onclick="deleteFxTrade()">Hapus</button>
                    <button type="button" class="month-pill-btn" id="fxNotaBtn" onclick="copyFxNota()">Salin nota WA</button>
                    <span style="flex:1"></span>
                    <button type="submit" class="create-invoice-btn">Simpan</button>
                </div>
            </form>
        </div>`;
    document.body.appendChild(dialog);

    const rates = document.createElement('dialog');
    rates.id = 'fxRatesDialog';
    rates.className = 'invoice-manager-dialog';
    rates.innerHTML = `
        <div class="manager-heading"><h2>Atur kurs</h2><button type="button" aria-label="Tutup" onclick="document.getElementById('fxRatesDialog').close()">×</button></div>
        <div class="manager-content">
            <form onsubmit="handleFxRatesSubmit(event)">
                <p class="bank-cut-hint">Kurs jual dipakai otomatis saat jual ke pelanggan, kurs beli saat beli/restok. Modal dihitung dari harga rata-rata stok yang dibeli.</p>
                <div class="draft-fields" id="fxRatesFields"></div>
                <div class="pack-dialog-actions"><span style="flex:1"></span><button type="submit" class="create-invoice-btn">Simpan kurs</button></div>
            </form>
        </div>`;
    document.body.appendChild(rates);

    const stockDialog = document.createElement('dialog');
    stockDialog.id = 'fxStockDialog';
    stockDialog.className = 'invoice-manager-dialog';
    stockDialog.innerHTML = `
        <div class="manager-heading"><h2>Koreksi stok</h2><button type="button" aria-label="Tutup" onclick="document.getElementById('fxStockDialog').close()">×</button></div>
        <div class="manager-content">
            <form onsubmit="handleFxStockSubmit(event)">
                <p class="bank-cut-hint">Isi jumlah valas yang benar-benar ada sekarang (misalnya stok awal, atau setelah hitung uang). Selisihnya dicatat sebagai koreksi, saldo rekening tidak berubah.</p>
                <div class="draft-fields">
                    <label>Mata uang<select id="fxStockCurrency" onchange="fillFxStockForm()">${FX_CURRENCIES.map(c => `<option value="${c}">${c} · ${FX_NAMES[c] || c}</option>`).join('')}</select></label>
                    <label>Stok sebenarnya<input type="number" id="fxStockQty" min="0" step="0.01" inputmode="decimal" required></label>
                    <label class="wide-field">Modal per 1 (Rp), untuk tambahan stok<input type="number" id="fxStockRate" min="0" step="0.01" inputmode="decimal" required></label>
                </div>
                <p class="bank-cut-hint" id="fxStockInfo"></p>
                <div class="pack-dialog-actions"><span style="flex:1"></span><button type="submit" class="create-invoice-btn">Simpan stok</button></div>
            </form>
        </div>`;
    document.body.appendChild(stockDialog);

    const person = document.createElement('dialog');
    person.id = 'fxPersonDialog';
    person.className = 'invoice-manager-dialog';
    person.innerHTML = `
        <div class="manager-heading"><h2 id="fxPersonTitle">Orang baru</h2><button type="button" aria-label="Tutup" onclick="document.getElementById('fxPersonDialog').close()">×</button></div>
        <div class="manager-content">
            <form id="fxPersonForm" onsubmit="handleDepositPersonSubmit(event)">
                <div class="draft-fields">
                    <label class="wide-field">Nama<input type="text" id="fxPersonName" maxlength="80" required placeholder="Contoh: Pak Hasan, Rizki"></label>
                    <label>Jenis<select id="fxPersonKind">${Object.entries(FX_DEPOSIT_KINDS).map(([k, v]) => `<option value="${k}">${v.label} · ${v.hint}</option>`).join('')}</select></label>
                    <label>No. WA<input type="tel" id="fxPersonPhone" maxlength="30" placeholder="Opsional"></label>
                    <label class="wide-field">Catatan<input type="text" id="fxPersonNote" maxlength="160" placeholder="Opsional"></label>
                </div>
                <div class="pack-dialog-actions">
                    <button type="button" class="delete-invoice-btn" id="fxPersonDeleteBtn" onclick="deleteDepositPerson()">Hapus orang</button>
                    <span style="flex:1"></span>
                    <button type="submit" class="create-invoice-btn">Simpan</button>
                </div>
            </form>
        </div>`;
    document.body.appendChild(person);

    const move = document.createElement('dialog');
    move.id = 'fxMoveDialog';
    move.className = 'invoice-manager-dialog';
    move.innerHTML = `
        <div class="manager-heading"><h2 id="fxMoveTitle">Titipan</h2><button type="button" aria-label="Tutup" onclick="document.getElementById('fxMoveDialog').close()">×</button></div>
        <div class="manager-content">
            <form id="fxMoveForm" onsubmit="handleDepositMoveSubmit(event)">
                <div class="fx-type-switch is-3" role="radiogroup" aria-label="Jenis">
                    ${Object.entries(FX_MOVE_TYPES).map(([k, v]) => `<button type="button" data-fx-move="${k}" onclick="setDepositMoveType('${k}')">${v.short}</button>`).join('')}
                </div>
                <div class="draft-fields">
                    <label class="wide-field">Orang<select id="fxMovePerson" onchange="onDepositMoveChange()"></select></label>
                    <label>Mata uang<select id="fxMoveCurrency" onchange="onDepositMoveChange()"></select></label>
                    <label>Tanggal<input type="date" id="fxMoveDate" required onchange="renderDepositMovePreview()"></label>
                    <label id="fxMoveAmountLabel">Jumlah<input type="number" id="fxMoveAmount" min="0.01" step="0.01" inputmode="decimal" required oninput="depositRecalc('amount')"></label>
                    <label id="fxMoveRateLabel">Kurs (Rp per 1)<input type="number" id="fxMoveRate" min="0.01" step="0.01" inputmode="decimal" oninput="depositRecalc('rate')"></label>
                    <label class="wide-field" id="fxMoveIdrLabel">Rupiah yang dikirim<input type="number" id="fxMoveIdr" min="1" step="1" inputmode="numeric" oninput="depositRecalc('idr')"></label>
                    <label class="wide-field" id="fxMoveBankLabel">Rekening rupiah<select id="fxMoveBank" onchange="renderDepositMovePreview()"></select></label>
                    <label class="wide-field">Catatan<input type="text" id="fxMoveNote" maxlength="160" placeholder="Opsional"></label>
                </div>
                <div class="fx-preview" id="fxMovePreview"></div>
                <p class="draft-error" id="fxMoveError" role="alert"></p>
                <div class="pack-dialog-actions"><span style="flex:1"></span><button type="submit" class="create-invoice-btn">Simpan</button></div>
            </form>
        </div>`;
    document.body.appendChild(move);

    const history = document.createElement('dialog');
    history.id = 'fxHistoryDialog';
    history.className = 'invoice-manager-dialog';
    history.innerHTML = `
        <div class="manager-heading"><h2 id="fxHistoryTitle">Mutasi</h2><button type="button" aria-label="Tutup" onclick="document.getElementById('fxHistoryDialog').close()">×</button></div>
        <div class="manager-content">
            <div id="fxHistoryBalance" class="fx-history-balance"></div>
            <div class="fx-history-actions">
                <button type="button" class="create-invoice-btn" onclick="openDepositMoveDialog('setor', fxHistoryPerson)">+ Setor</button>
                <button type="button" class="month-pill-btn" onclick="openDepositMoveDialog('ambil', fxHistoryPerson)">Ambil</button>
                <button type="button" class="month-pill-btn" onclick="openDepositMoveDialog('kirim', fxHistoryPerson)">Kirim rupiah</button>
                <button type="button" class="month-pill-btn" onclick="copyDepositStatement()">Salin saldo WA</button>
                <button type="button" class="month-pill-btn" onclick="openDepositPersonDialog(fxHistoryPerson)">Ubah data</button>
            </div>
            <div id="fxHistoryList"></div>
        </div>`;
    document.body.appendChild(history);
}

function shiftFxMonth(delta) {
    const [y, m] = fxMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    fxMonth = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    renderExchangeUI();
}

function fxHasDemo() {
    return exchangeState.demo || fxAllTrades().some(t => t.demo) || exchangeState.deposits.people.some(p => p.demo)
        || exchangeState.deals.some(d => d.demo) || debts.some(d => d.demo);
}

// Remove the sample data from api/_seeds.js (everything marked demo: tukar, titipan, talangan,
// spending, plans; and while the account is still the sample one, its saldo, kurs, valas and
// monthly report). What the owner entered himself stays.
function clearFxDemo() {
    if (!confirm('Hapus semua data contoh? Saldo bank, pound & dollar, kurs, laporan bulanan, catat tukar, titipan, talangan, dan pengeluaran contoh dihapus. Yang kamu catat sendiri tetap ada.')) return;
    const demoPeople = new Set(exchangeState.deposits.people.filter(p => p.demo).map(p => p.id));
    exchangeState.deposits.moves.filter(m => m.demo || demoPeople.has(m.personId)).forEach(m => removeDepositMove(m, false));
    exchangeState.deposits.people = exchangeState.deposits.people.filter(p => !demoPeople.has(p.id));
    Object.keys(exchangeState.trades).forEach(month => {
        exchangeState.trades[month] = exchangeState.trades[month].filter(t => !t.demo);
        if (!exchangeState.trades[month].length) delete exchangeState.trades[month];
    });
    exchangeState.deals = exchangeState.deals.filter(d => !d.demo);
    debts = debts.filter(d => !d.demo);
    Object.keys(expenseLogs).forEach(month => {
        expenseLogs[month] = expenseLogs[month].filter(l => !l.demo);
        if (!expenseLogs[month].length) delete expenseLogs[month];
    });
    Object.keys(expensePlans).forEach(month => {
        expensePlans[month] = (expensePlans[month] || []).filter(p => !p.demo);
    });
    if (exchangeState.demo) {
        FX_CURRENCIES.forEach(c => { exchangeState.rates[c] = { sell: 0, buy: 0 }; exchangeState.assetRates[c] = 0; });
        exchangeState.holdings.forEach(h => { h.amount = 0; });
        exchangeState.assetHistory = {};
        exchangeState.assetDaily = {};
        BANK_ACCOUNTS.forEach(acc => { bankBalances[acc.key] = 0; });
        bankBalancesUpdatedAt = '';
    }
    exchangeState.demo = false;
    saveLocalBillingState();
    renderDebtUI();
    if (document.body.dataset.view === 'plan') renderPlanUI();
    saveExchangeAndSync();
    showToast('DATA CONTOH DIHAPUS · SIAP DIPAKAI');
}

function renderExchangeUI() {
    ensureExchangeUI();
    document.getElementById('fxDemoBanner').hidden = !fxHasDemo();
    document.querySelectorAll('[data-fx-pane]').forEach(b => {
        b.classList.toggle('active', b.dataset.fxPane === fxPane);
        b.setAttribute('aria-selected', String(b.dataset.fxPane === fxPane));
    });
    document.getElementById('fxTradePane').hidden = fxPane !== 'trade';
    document.getElementById('fxAssetPane').hidden = fxPane !== 'aset';
    document.getElementById('fxReportPane').hidden = fxPane !== 'laporan';
    document.getElementById('fxDepositPane').hidden = fxPane !== 'titipan';
    renderAssetPane();
    renderReportPane();
    renderDepositUI();
    renderFxQuick();
    const held = depositBalances().totals;
    const { stock, result } = computeExchange();
    document.getElementById('fxCards').innerHTML = FX_CURRENCIES.map(c => {
        const s = stock[c];
        const rate = exchangeState.rates[c] || { sell: 0, buy: 0 };
        const margin = rate.sell && s.avg ? rate.sell - s.avg : 0;
        return `
        <div class="fx-card">
            <div class="fx-card-head">${fxFlag(c, 'fx-flag is-lg')}<b>${c}</b><span>${FX_NAMES[c] || ''}</span></div>
            <div class="fx-stock-label">${held[c] ? 'Stok milik sendiri' : 'Simpanan cash'}</div>
            <div class="fx-stock${s.qty < 0 ? ' is-minus' : ''}">${fxQty(s.qty)} <small>${c}</small></div>
            ${held[c] ? `<div class="fx-cash-split">+ titipan orang <b>${fxQty(held[c])}</b> · total cash di tangan <b>${fxQty(Math.round((s.qty + held[c]) * 100) / 100)}</b></div>` : ''}
            <div class="fx-rows">
                <div><span>Kurs jual</span><b>${rate.sell ? fxRate(rate.sell) : '<em>belum diatur</em>'}</b></div>
                <div><span>Modal rata-rata</span><b>${s.avg ? fxRate(s.avg) : '-'}</b></div>
                <div><span>Untung per ${c}</span><b class="${margin < 0 ? 'is-minus' : ''}">${margin ? fxRate(Math.round(margin * 100) / 100) : '-'}</b></div>
                <div><span>Nilai stok (modal)</span><b>${formatIDR(Math.round(Math.max(0, s.qty) * s.avg))}</b></div>
            </div>
        </div>`;
    }).join('');

    const today = localDateKey();
    const all = fxAllTrades();
    const monthTrades = (exchangeState.trades[fxMonth] || []).slice().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
    const sales = monthTrades.filter(t => t.type === 'jual');
    const profitOf = list => list.reduce((s, t) => s + ((result[t.id] || {}).profit || 0), 0);
    const todaySales = all.filter(t => t.type === 'jual' && t.date === today);
    document.getElementById('fxStats').innerHTML = `
        <div><span>Untung hari ini</span><b>${formatIDR(profitOf(todaySales))}</b><small>${todaySales.length} transaksi jual</small></div>
        <div><span>Untung ${escapeHTML(monthLabelOf(fxMonth))}</span><b>${formatIDR(profitOf(sales))}</b><small>${sales.length} transaksi jual</small></div>
        <div><span>Rupiah masuk (jual)</span><b>${formatIDR(sales.reduce((s, t) => s + t.idr, 0))}</b><small>${FX_CURRENCIES.map(c => fxQty(sales.filter(t => t.currency === c).reduce((s, t) => s + t.qty, 0)) + ' ' + c).join(' · ')}</small></div>
        <div><span>Rupiah keluar (beli)</span><b>${formatIDR(monthTrades.filter(t => t.type === 'beli').reduce((s, t) => s + t.idr, 0))}</b><small>${monthTrades.filter(t => t.type === 'beli').length} transaksi beli</small></div>`;
    document.getElementById('fxMonthLabel').textContent = monthLabelOf(fxMonth);

    const listEl = document.getElementById('fxList');
    if (!monthTrades.length) {
        listEl.innerHTML = `<div class="log-empty">Belum ada transaksi di ${escapeHTML(monthLabelOf(fxMonth))}. ${all.length ? '' : 'Mulai dengan <b>Atur kurs</b> dan <b>Koreksi stok</b> untuk isi stok awal, lalu catat penukaran lewat <b>+ Jual ke pelanggan</b>.'}</div>`;
        return;
    }
    const days = [];
    monthTrades.forEach(t => {
        let d = days[days.length - 1];
        if (!d || d.date !== t.date) { d = { date: t.date, trades: [] }; days.push(d); }
        d.trades.push(t);
    });
    listEl.innerHTML = days.map(d => {
        const dayProfit = profitOf(d.trades.filter(t => t.type === 'jual'));
        const [yy, mm, dd] = d.date.split('-').map(Number);
        const label = new Date(yy, mm - 1, dd).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short' });
        return `
        <div class="log-day">
            <div class="log-day-head"><span>${d.date === today ? 'Hari ini · ' : ''}${escapeHTML(label)}</span><b>untung ${formatIDR(dayProfit)}</b></div>
            ${d.trades.map(t => {
                const r = result[t.id] || {};
                const sub = t.type === 'jual' ? `untung ${formatIDR(r.profit || 0)}` : t.type === 'beli' ? `modal ${fxRate(t.rate)}` : 'koreksi stok';
                return `
                <button type="button" class="log-row fx-row is-${t.type}" onclick="openFxDialog('', '${escapeHTML(t.id)}')">
                    <span class="log-row-main">
                        <span class="log-row-title"><em class="fx-tag">${FX_TYPES[t.type].short}</em> ${fxFlag(t.currency)} ${fxQty(Math.abs(t.qty))} ${t.currency}${t.customer ? ' · ' + escapeHTML(t.customer) : ''}</span>
                        <span class="log-row-pos">${t.type === 'koreksi' ? (t.qty > 0 ? '+' : '−') + fxQty(Math.abs(t.qty)) + ' ' + t.currency : 'kurs ' + fxRate(t.rate)} · ${sub}${t.bankKey ? ' · ' + escapeHTML(bankNameOf(t.bankKey)) : ''}</span>
                    </span>
                    <span class="log-row-amount">${t.type === 'koreksi' ? '' : (t.type === 'jual' ? '+' : '−') + formatIDR(t.idr)}</span>
                </button>`;
            }).join('')}
        </div>`;
    }).join('');
}

// ---------- Kurs hari ini ----------
function renderFxQuick() {
    document.querySelectorAll('[data-quick-rate]').forEach(input => {
        if (input === document.activeElement) return;
        const [c, field] = input.dataset.quickRate.split(':');
        const value = (exchangeState.rates[c] || {})[field];
        input.value = value || '';
        input.placeholder = field === 'sell' ? 'kurs jual' : 'kurs beli';
    });
}

function saveQuickRate(input) {
    const [c, field] = input.dataset.quickRate.split(':');
    const value = Math.max(0, Number(input.value) || 0);
    exchangeState.rates[c] = exchangeState.rates[c] || { sell: 0, buy: 0 };
    if (exchangeState.rates[c][field] === value) return;
    exchangeState.rates[c][field] = value;
    saveExchangeAndSync();
    showToast(value ? `KURS ${field === 'sell' ? 'JUAL' : 'BELI'} ${c} JADI ${fxRate(value).toUpperCase()}` : `KURS ${c} DIKOSONGKAN`);
}

// ---------- Trade dialog ----------
// Kept simple: amount + kurs, and the form says how much rupiah must come in and the profit.
// The total can be changed under "Lainnya" (e.g. rounded), which leaves the amount alone.
let fxType = 'jual';

function setFxType(type) {
    fxType = type;
    document.querySelectorAll('[data-fx-type]').forEach(b => b.classList.toggle('active', b.dataset.fxType === type));
    document.getElementById('fxBankLabel').firstChild.textContent = type === 'jual' ? 'Rupiah masuk ke' : 'Rupiah keluar dari';
    document.getElementById('fxIdrLabel').firstChild.textContent = type === 'jual' ? 'Total rupiah diterima' : 'Total rupiah dibayar';
    if (!fxEditId) onFxCurrencyChange();
    renderFxPreview();
}

function onFxCurrencyChange() {
    renderFxChips();
    const c = document.getElementById('fxCurrency').value;
    const rate = exchangeState.rates[c] || {};
    const { stock } = computeExchange();
    const value = fxType === 'jual' ? rate.sell : (rate.buy || Math.round((stock[c] || {}).avg * 100) / 100);
    if (value) document.getElementById('fxRate').value = value;
    fxRecalc('rate');
}

function fxRecalc(field) {
    if (field !== 'idr') {
        const qty = Number(document.getElementById('fxQty').value) || 0;
        const rate = Number(document.getElementById('fxRate').value) || 0;
        document.getElementById('fxIdr').value = qty && rate ? Math.round(qty * rate) : '';
    }
    renderFxPreview();
}

function renderFxPreview() {
    const el = document.getElementById('fxPreview');
    const c = document.getElementById('fxCurrency').value;
    const qty = Number(document.getElementById('fxQty').value) || 0;
    const idr = Math.round(Number(document.getElementById('fxIdr').value) || 0);
    const bankKey = document.getElementById('fxBank').value;
    const date = document.getElementById('fxDate').value;
    const editing = fxAllTrades().find(t => t.id === fxEditId);
    const { stock } = computeExchange();
    let s = { ...stock[c] };
    // While editing, judge against the stock without this trade.
    if (editing && editing.currency === c) s.qty += editing.type === 'jual' ? editing.qty : -editing.qty;
    const lines = [];
    if (fxType === 'jual' && qty) {
        const cost = Math.round(qty * (s.avg || 0));
        const profit = idr - cost;
        lines.push(`<div class="fx-must-get"><span>Harus terima <b>${formatIDR(idr)}</b></span>${s.avg ? `<span>untung bersih <b class="is-profit ${profit < 0 ? 'is-minus' : ''}">${formatIDR(profit)}</b></span>` : ''}</div>`);
        lines.push(s.avg ? `Modal ${fxRate(Math.round(s.avg * 100) / 100)} × ${fxQty(qty)} ${c} = ${formatIDR(cost)}` : 'Modal belum diketahui: isi stok lewat <b>Beli / restok</b> atau <b>Koreksi stok</b> dulu.');
        lines.push(`Stok ${c}: ${fxQty(s.qty)} → <b class="${s.qty - qty < 0 ? 'is-minus' : ''}">${fxQty(s.qty - qty)}</b>`);
        const held = depositBalances().totals[c];
        if (s.qty - qty < 0 && held > 0) lines.push(`<b class="is-minus">Melebihi stok milikmu ${fxQty(Math.min(held, qty - Math.max(0, s.qty)))} ${c}: ini pakai uang titipan orang.</b>`);
    } else if (fxType === 'beli' && qty) {
        const newQty = Math.max(0, s.qty) + qty;
        const newAvg = (Math.max(0, s.qty) * s.avg + idr) / newQty;
        lines.push(`<div class="fx-must-get"><span>Bayar <b>${formatIDR(idr)}</b></span></div>`);
        lines.push(`Stok ${c}: ${fxQty(s.qty)} → <b>${fxQty(s.qty + qty)}</b> · modal rata-rata jadi ${fxRate(Math.round(newAvg * 100) / 100)}`);
    }
    if (isBankKey(bankKey) && idr) {
        const skip = bankBalancesUpdatedAt && date && date < bankBalancesUpdatedAt;
        const now = (Number(bankBalances[bankKey]) || 0) - (editing ? (editing.bankKey === bankKey ? editing.bankDelta : 0) : 0);
        lines.push(skip
            ? `Saldo ${escapeHTML(bankNameOf(bankKey))} tidak berubah: saldonya diperbarui setelah tanggal ini.`
            : `Saldo ${escapeHTML(bankNameOf(bankKey))} ${formatIDR(now)} → ${formatIDR(now + (fxType === 'jual' ? idr : -idr))}`);
    }
    el.innerHTML = lines.map(l => `<div>${l}</div>`).join('');
}

function openFxDialog(type, editId = '') {
    ensureExchangeUI();
    const trade = editId ? fxAllTrades().find(t => t.id === editId) : null;
    if (trade && trade.linked) {
        const move = exchangeState.deposits.moves.find(m => m.id === trade.linked);
        alert(`Ini pencairan titipan ${trade.customer || ''} (kirim rupiah). Ubah atau hapus lewat tab Titipan.`);
        if (move) { fxPane = 'titipan'; renderExchangeUI(); openDepositHistory(move.personId); }
        return;
    }
    if (trade && trade.type === 'koreksi') {
        if (confirm(`Koreksi stok ${trade.qty > 0 ? '+' : '−'}${fxQty(Math.abs(trade.qty))} ${trade.currency} (${formatShortDate(trade.date)}). Hapus koreksi ini?`)) {
            exchangeState.trades[trade.date.slice(0, 7)] = (exchangeState.trades[trade.date.slice(0, 7)] || []).filter(t => t.id !== trade.id);
            saveExchangeAndSync();
            showToast('KOREKSI STOK DIHAPUS');
        }
        return;
    }
    fxEditId = trade ? trade.id : '';
    document.getElementById('fxForm').reset();
    document.getElementById('fxError').textContent = '';
    document.getElementById('fxDialogTitle').textContent = trade ? 'Ubah transaksi' : 'Transaksi baru';
    document.getElementById('fxDeleteBtn').hidden = !trade;
    document.getElementById('fxNotaBtn').hidden = !trade;
    document.getElementById('fxBank').innerHTML = bankOptionsHTML(trade ? trade.bankKey : fxDefaultBank());
    document.getElementById('fxDate').value = trade ? trade.date : localDateKey();
    if (trade) {
        document.getElementById('fxCurrency').value = trade.currency;
        renderFxChips();
        document.getElementById('fxQty').value = trade.qty;
        document.getElementById('fxRate').value = trade.rate;
        document.getElementById('fxIdr').value = trade.idr;
        document.getElementById('fxCustomer').value = trade.customer;
        document.getElementById('fxNote').value = trade.note;
    }
    document.getElementById('fxMore').open = false;
    setFxType(trade ? trade.type : (type || 'jual'));
    document.getElementById('fxDialog').showModal();
    if (!trade) setTimeout(() => document.getElementById('fxQty').focus(), 30);
}

function handleFxSubmit(event) {
    event.preventDefault();
    const error = document.getElementById('fxError');
    const c = document.getElementById('fxCurrency').value;
    const qty = Math.round((Number(document.getElementById('fxQty').value) || 0) * 100) / 100;
    const rate = Number(document.getElementById('fxRate').value) || 0;
    const idr = Math.round(Number(document.getElementById('fxIdr').value) || 0);
    const date = document.getElementById('fxDate').value || localDateKey();
    if (qty <= 0 || rate <= 0 || idr <= 0) { error.textContent = 'Isi jumlah valas dan kurs.'; return; }
    const bankKey = document.getElementById('fxBank').value;
    rememberExpenseBank(bankKey);

    const old = fxAllTrades().find(t => t.id === fxEditId);
    if (old) {
        fxApplyBank(old, -1);
        exchangeState.trades[old.date.slice(0, 7)] = (exchangeState.trades[old.date.slice(0, 7)] || []).filter(t => t.id !== old.id);
    }
    const trade = {
        id: old ? old.id : 'fx-' + crypto.randomUUID(),
        type: fxType,
        date,
        currency: c,
        qty,
        rate: Math.round(idr / qty * 100) / 100,
        idr,
        customer: document.getElementById('fxCustomer').value.trim().slice(0, 80),
        note: document.getElementById('fxNote').value.trim().slice(0, 160),
        bankKey: isBankKey(bankKey) ? bankKey : '',
        bankDelta: 0,
        createdAt: old ? old.createdAt : Date.now()
    };
    // An edited trade that was already inside a later "Update saldo" stays there.
    trade.bankDelta = old && !old.bankDelta && old.bankKey === trade.bankKey && old.bankKey ? 0 : fxBankDeltaFor(trade);
    fxApplyBank(trade, 1);
    const month = date.slice(0, 7);
    exchangeState.trades[month] = (exchangeState.trades[month] || []).concat(trade);
    if (fxType === 'jual' && !exchangeState.rates[c].sell) exchangeState.rates[c].sell = trade.rate;
    if (fxType === 'beli') exchangeState.rates[c].buy = trade.rate;
    fxMonth = month;
    document.getElementById('fxDialog').close();
    saveExchangeAndSync();
    const r = computeExchange().result[trade.id] || {};
    showToast(fxType === 'jual' ? `TERCATAT · UNTUNG ${formatIDR(r.profit || 0)}` : `STOK ${c} BERTAMBAH ${fxQty(qty)}`);
}

function deleteFxTrade() {
    const t = fxAllTrades().find(x => x.id === fxEditId);
    if (!t) return;
    const refund = t.bankDelta ? `\nSaldo ${bankNameOf(t.bankKey)} dikembalikan ${formatIDR(Math.abs(t.bankDelta))}.` : '';
    if (!confirm(`Hapus transaksi ${FX_TYPES[t.type].short.toLowerCase()} ${fxQty(t.qty)} ${t.currency} (${formatIDR(t.idr)})?${refund}`)) return;
    fxApplyBank(t, -1);
    exchangeState.trades[t.date.slice(0, 7)] = (exchangeState.trades[t.date.slice(0, 7)] || []).filter(x => x.id !== t.id);
    document.getElementById('fxDialog').close();
    saveExchangeAndSync();
    showToast('TRANSAKSI DIHAPUS');
}

function copyFxNota() {
    const t = fxAllTrades().find(x => x.id === fxEditId);
    if (!t) return;
    const name = (window.DAR_WS && window.DAR_WS.name) || '';
    const lines = [
        `*NOTA PENUKARAN VALAS${name ? ' · ' + name.toUpperCase() : ''}*`,
        `Tanggal: ${formatShortDate(t.date)}`,
        t.customer ? `Nama: ${t.customer}` : '',
        t.type === 'jual'
            ? `Tukar: ${formatIDR(t.idr)} → *${fxQty(t.qty)} ${t.currency}*`
            : `Kami beli: ${fxQty(t.qty)} ${t.currency} → *${formatIDR(t.idr)}*`,
        `Kurs: ${fxRate(t.rate)} / ${t.currency}`,
        t.note ? `Catatan: ${t.note}` : '',
        '',
        'Terima kasih sudah menukar di sini 🙏'
    ].filter((l, i, a) => l !== '' || (i > 0 && a[i - 1] !== ''));
    copyText(lines.join('\n')).then(ok => showToast(ok ? 'NOTA DISALIN, TINGGAL TEMPEL DI WA' : 'GAGAL MENYALIN NOTA'));
}

// ---------- Rates & stock ----------
function openFxRatesDialog() {
    ensureExchangeUI();
    const { stock } = computeExchange();
    document.getElementById('fxRatesFields').innerHTML = FX_CURRENCIES.map(c => {
        const r = exchangeState.rates[c] || {};
        return `
            <label>Kurs jual ${c} (Rp)<input type="number" data-fx-rate="${c}:sell" min="0" step="0.01" inputmode="decimal" value="${r.sell || ''}" placeholder="Harga ke pelanggan"></label>
            <label>Kurs beli ${c} (Rp)<input type="number" data-fx-rate="${c}:buy" min="0" step="0.01" inputmode="decimal" value="${r.buy || ''}" placeholder="${stock[c].avg ? 'Modal sekarang ' + Math.round(stock[c].avg * 100) / 100 : 'Harga beli/restok'}"></label>`;
    }).join('');
    document.getElementById('fxRatesDialog').showModal();
}

function handleFxRatesSubmit(event) {
    event.preventDefault();
    document.querySelectorAll('[data-fx-rate]').forEach(input => {
        const [c, field] = input.dataset.fxRate.split(':');
        exchangeState.rates[c] = exchangeState.rates[c] || { sell: 0, buy: 0 };
        exchangeState.rates[c][field] = Math.max(0, Number(input.value) || 0);
    });
    document.getElementById('fxRatesDialog').close();
    saveExchangeAndSync();
    showToast('KURS DISIMPAN');
}

function openFxStockDialog(currency) {
    ensureExchangeUI();
    if (currency) document.getElementById('fxStockCurrency').value = currency;
    fillFxStockForm();
    document.getElementById('fxStockDialog').showModal();
}

function fillFxStockForm() {
    renderFxChips();
    const c = document.getElementById('fxStockCurrency').value;
    const s = computeExchange().stock[c];
    document.getElementById('fxStockQty').value = Math.round(s.qty * 100) / 100;
    document.getElementById('fxStockRate').value = s.avg ? Math.round(s.avg * 100) / 100 : ((exchangeState.rates[c] || {}).buy || '');
    document.getElementById('fxStockInfo').textContent = `Tercatat sekarang: ${fxQty(s.qty)} ${c}${s.avg ? ', modal rata-rata ' + fxRate(Math.round(s.avg * 100) / 100) : ''}.`;
}

function handleFxStockSubmit(event) {
    event.preventDefault();
    const c = document.getElementById('fxStockCurrency').value;
    const target = Math.round((Number(document.getElementById('fxStockQty').value) || 0) * 100) / 100;
    const rate = Number(document.getElementById('fxStockRate').value) || 0;
    const s = computeExchange().stock[c];
    const delta = Math.round((target - s.qty) * 100) / 100;
    if (!delta) { document.getElementById('fxStockDialog').close(); return; }
    if (delta > 0 && rate <= 0) { document.getElementById('fxStockInfo').textContent = 'Isi modal per 1 untuk tambahan stok.'; return; }
    const date = localDateKey();
    const trade = { id: 'fx-' + crypto.randomUUID(), type: 'koreksi', date, currency: c, qty: delta, rate: delta > 0 ? rate : (s.avg || rate), idr: 0, customer: '', note: '', bankKey: '', bankDelta: 0, createdAt: Date.now() };
    exchangeState.trades[date.slice(0, 7)] = (exchangeState.trades[date.slice(0, 7)] || []).concat(trade);
    document.getElementById('fxStockDialog').close();
    saveExchangeAndSync();
    showToast(`STOK ${c} JADI ${fxQty(target)}`);
}

// ---------- Titipan UI ----------
let fxMoveType = 'setor';
let fxMoveLast = 'amount';
let fxHistoryPerson = '';
let fxPersonEditId = '';

// The owner wanted no buy/sell bookkeeping: the screen is Aset + Titipan. The trade pane
// stays in the code (titipan "kirim rupiah" still records a linked trade) but has no tab.
function setFxPane(pane) {
    fxPane = FX_LIMITED ? 'laporan' : (['titipan', 'laporan'].includes(pane) ? pane : 'aset');
    renderExchangeUI();
}

// ---------- Aset ----------
// Rows are built once and then only their numbers change while typing; changes are saved a
// moment after the last keystroke.
function renderAssetPane() {
    // Don't rebuild the rows under someone typing in the Update saldo dialog.
    const pane = document.getElementById('fxAssetDialog');
    if (!pane) return;
    const typing = document.activeElement && pane.contains(document.activeElement) && /^(INPUT|SELECT)$/.test(document.activeElement.tagName);
    if (!typing) {
        document.querySelectorAll('[data-asset-rate]').forEach(input => {
            input.value = kursToField(exchangeState.assetRates[input.dataset.assetRate], input.dataset.assetRate);
        });
        document.querySelectorAll('[data-buy-rate]').forEach(input => {
            input.value = kursToField(exchangeState.buyRates[input.dataset.buyRate], input.dataset.buyRate);
        });
        const row = h => `
            <div class="fx-asset-row" data-holding="${escapeHTML(h.id)}">
                <span class="fx-asset-flag">${fxFlag(h.currency, 'fx-flag is-lg')}</span>
                <span class="fx-asset-name-cell">${h.kind === 'orang' ? '<span class="fx-asset-prefix">Di</span>' : ''}<input type="text" class="fx-asset-label" maxlength="40" value="${escapeHTML(h.label)}" placeholder="${h.kind === 'orang' ? 'Nama orang' : 'Nama tempat'}" aria-label="${h.kind === 'orang' ? 'Nama orang yang pegang' : 'Nama tempat'}" oninput="onHoldingInput('${escapeHTML(h.id)}', 'label', this)"></span>
                <span class="fx-asset-amount">
                    <input type="number" min="0" step="${h.currency === 'IDR' ? '1' : '0.01'}" inputmode="decimal" value="${h.amount || ''}" placeholder="0" aria-label="Jumlah ${h.currency}" oninput="onHoldingInput('${escapeHTML(h.id)}', 'amount', this)">
                    <select aria-label="Mata uang" onchange="onHoldingInput('${escapeHTML(h.id)}', 'currency', this)">${HOLDING_CURRENCIES.map(c => `<option value="${c}"${c === h.currency ? ' selected' : ''}>${c}</option>`).join('')}</select>
                </span>
                <span class="fx-asset-idr" data-holding-idr="${escapeHTML(h.id)}"></span>
                <button type="button" class="fx-asset-remove" aria-label="Hapus ${escapeHTML(placeName(h))}" onclick="removeHolding('${escapeHTML(h.id)}')">×</button>
            </div>`;
        document.getElementById('fxHoldingList').innerHTML = exchangeState.holdings.filter(h => h.kind !== 'orang').map(row).join('') || '<div class="log-empty">Belum ada. Klik <b>+ Tambah tempat</b>.</div>';
        document.getElementById('fxHoldingOrangList').innerHTML = exchangeState.holdings.filter(h => h.kind === 'orang').map(row).join('') || '<div class="log-empty">Belum ada. Klik <b>+ Kantong dipegang orang</b>, isi nama orangnya dan jumlahnya.</div>';
        document.getElementById('fxAssetBankList').innerHTML = BANK_ACCOUNTS.map(acc => `
            <div class="fx-asset-row is-bank">
                <span class="fx-asset-flag"><img class="bank-logo-img" src="${acc.logo}" alt="" loading="lazy"></span>
                <span class="fx-asset-name">${escapeHTML(acc.name)}</span>
                <span class="fx-asset-amount"><em>Rp</em><input type="text" inputmode="numeric" value="${(Number(bankBalances[acc.key]) || 0) ? (Number(bankBalances[acc.key]) || 0).toLocaleString('id-ID') : ''}" placeholder="0" aria-label="Saldo ${escapeHTML(acc.name)}" oninput="onAssetBank('${acc.key}', this)"></span>
            </div>`).join('');
    }
    renderAssetNumbers();
}

// Logos for foreign-money places, matched on the name the owner gave the place.
const PLACE_LOGOS = [
    { match: /insta\s*pay/i, src: '/bank-logos/instapay.png' }
];

const FX_STAT_ICONS = {
    total: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>',
    pegangan: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line></svg>',
    talangan: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>',
    titipan: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"></path></svg>'
};

// The Aset screen in DAR's dashboard style: four stat cards on top, then the "Status saldo"
// card with one tile per bank and per foreign-money place. Numbers are typed in the dialog.
function renderAssetNumbers() {
    const t = assetTotals();
    exchangeState.holdings.forEach(h => {
        const el = document.querySelector(`[data-holding-idr="${CSS.escape(h.id)}"]`);
        if (!el) return;
        el.innerHTML = !h.amount || h.currency === 'IDR' ? '' : exchangeState.assetRates[h.currency] ? `= ${formatIDR(assetIdr(h.amount, h.currency))}` : '<i>isi kurs</i>';
    });
    document.getElementById('fxValasSum').textContent = formatIDR(t.valas);
    const orangSum = document.querySelector('#fxHoldingOrangList') && document.querySelector('#fxHoldingOrangList').previousElementSibling.querySelector('span');
    if (orangSum) orangSum.textContent = t.orang ? formatIDR(t.orang) : 'uang kamu yang ada di orang lain';
    document.getElementById('fxBankSum').textContent = formatIDR(t.bank);
    const today = localDateKey();
    const profitToday = dealProfitSum(exchangeState.deals.filter(d => d.date === today));
    const profitMonth = dealProfitSum(exchangeState.deals.filter(d => d.date.slice(0, 7) === today.slice(0, 7)));

    const card = (cls, icon, title, value, note, onclick) => `
        <div class="stat-card ${cls}"${onclick ? ` role="button" tabindex="0" onclick="${onclick}"` : ''}>
            <div class="stat-icon">${FX_STAT_ICONS[icon]}</div>
            <div>
                <div class="stat-info-title">${title}</div>
                <div class="stat-info-val">${value}</div>
                <div class="stat-note">${note}</div>
            </div>
        </div>`;
    document.getElementById('fxAssetStats').innerHTML = [
        card('profit-stat', 'total', 'Total aset bersih', formatIDR(t.total), `untung tukar hari ini ${formatIDR(profitToday)} · bulan ini ${formatIDR(profitMonth)}`),
        card('total-stat', 'pegangan', 'Pegangan', formatIDR(t.pegangan), `bank ${formatIDR(t.bank)} · valas & cash ${formatIDR(t.valas)}${t.orang ? ` · di orang ${formatIDR(t.orang)}` : ''}`, 'openAssetDialog()'),
        card('paid-stat', 'talangan', '+ Talangan', formatIDR(t.talangan), 'orang ngutang ke kamu', "setWorkspaceView('debt')"),
        card('unpaid-stat', 'titipan', '− Uang orang', formatIDR(t.titipan + t.hutang), t.hutang ? `titipan ${formatIDR(t.titipan)} · hutang ${formatIDR(t.hutang)}` : 'masih harus diserahkan', "setFxPane('titipan')")
    ].join('');
    const investorEl = document.getElementById('fxInvestorLine');
    investorEl.hidden = !t.investor;
    investorEl.innerHTML = `<b>Dana investor ${formatIDR(t.investor)}</b> <span>· pos terpisah, belum ikut dihitung di total aset bersih (cara hitungnya nunggu konfirmasi)</span>`;

    document.getElementById('fxPeganganVal').textContent = formatIDR(t.pegangan);
    const rates = FX_CURRENCIES.map(c => `${c} ${exchangeState.assetRates[c] ? kursText(exchangeState.assetRates[c], c) : 'belum diisi'}`).join(' · ');
    document.getElementById('fxAssetSub').innerHTML = `Kurs modal: ${rates}` + (t.missingRate.length ? ` <b class="fx-sub-warn">· isi kurs ${t.missingRate.join(' & ')} biar ikut dihitung</b>` : '');

    // Same tiles as DAR's bank cards; the share bar is of the whole pegangan.
    const tile = (brand, tag, pct, sub, amount, extra, button) => `
        <div class="bank-item-card">
            <div class="bank-item-top">
                <div class="bank-item-brand">${brand}<span class="bank-tag-primary">${tag}</span></div>
                <span class="bank-item-pct">${pct}%</span>
            </div>
            <div class="bank-account-num${sub.empty ? ' is-empty' : ''}">${sub.text}</div>
            <div class="bank-balance-amount">${amount}</div>
            ${extra}
            <div class="bank-progress-bar"><div class="bank-progress-fill" style="width:${pct}%;"></div></div>
            ${button}
        </div>`;
    const pctOf = v => t.pegangan > 0 ? (v > 0 && Math.round(v / t.pegangan * 100) === 0 ? '&lt;1' : Math.round(v / t.pegangan * 100)) : 0;
    const banks = BANK_ACCOUNTS.map(acc => {
        const val = Number(bankBalances[acc.key]) || 0;
        const { number } = accountDetail(acc.key);
        return tile(`<img class="bank-logo-img" src="${acc.logo}" alt="${escapeHTML(acc.name)}" loading="lazy">`, acc.tag, pctOf(val),
            { text: number ? escapeHTML(number) : 'No. rekening belum diisi', empty: !number },
            formatIDR(val), '',
            bankCardActions(acc.key));
    });
    const places = exchangeState.holdings.map(h => {
        const idr = assetIdr(h.amount, h.currency);
        // Places with a known logo show it, like the bank tiles; others show the flag and name.
        const logo = h.kind === 'orang' ? null : PLACE_LOGOS.find(p => p.match.test(h.label || ''));
        const brand = logo
            ? `<img class="bank-logo-img" src="${logo.src}" alt="${escapeHTML(h.label)}" loading="lazy">`
            : `${fxFlag(h.currency, 'fx-flag is-lg')}<b class="fx-tile-name">${escapeHTML(placeName(h))}</b>`;
        return tile(brand, h.kind === 'orang' ? `Dipegang orang · ${FX_NAMES[h.currency] || h.currency}` : (FX_NAMES[h.currency] || h.currency), pctOf(idr),
            { text: h.currency === 'IDR' ? 'Rupiah tunai' : rateKnown(h.currency) ? `≈ ${formatIDR(idr)}` : 'kurs belum diisi', empty: !rateKnown(h.currency) },
            fxAmount(h.amount, h.currency), '',
            `<button type="button" class="bank-copy-btn" onclick="openHoldingAmountEdit('${escapeHTML(h.id)}')">Ubah jumlah</button>`);
    });
    document.getElementById('fxAssetGrid').innerHTML = banks.concat(places).join('');
    renderAssetHistory(t);
}

// ---------- Laporan aset per bulan ----------
// The current month's numbers are kept up to date as things change; when a month is over its
// last numbers stay as that month's line. Months before this started have no line.
function snapshotAssets(t) {
    const month = currentMonthKey();
    const spent = (expenseLogs[month] || []).reduce((s, l) => s + moneyIdr(l), 0);
    const snap = {
        total: t.total, pegangan: t.pegangan, bank: t.bank, valas: t.valas, talangan: t.talangan,
        titipan: t.titipan, investor: t.investor, hutang: t.hutang,
        profit: dealProfitSum(exchangeState.deals.filter(d => d.date.slice(0, 7) === month)), spent
    };
    const old = exchangeState.assetHistory[month];
    // Nothing entered yet: no line for an empty account.
    if (!old && !t.pegangan && !t.talangan && !t.titipan && !t.investor) return;
    const day = localDateKey();
    const daily = exchangeState.assetDaily[day];
    const dailyChanged = !daily || daily.total !== Math.round(t.total) || daily.pegangan !== Math.round(t.pegangan);
    if (dailyChanged) {
        exchangeState.assetDaily[day] = { total: Math.round(t.total), pegangan: Math.round(t.pegangan) };
        const days = Object.keys(exchangeState.assetDaily).sort();
        days.slice(0, Math.max(0, days.length - 62)).forEach(d => delete exchangeState.assetDaily[d]);
    }
    if (old && ASSET_HISTORY_FIELDS.every(k => old[k] === Math.round(snap[k] || 0))) {
        if (dailyChanged) saveExchangeLocal();
        return;
    }
    exchangeState.assetHistory[month] = { ...Object.fromEntries(ASSET_HISTORY_FIELDS.map(k => [k, Math.round(snap[k] || 0)])), at: localDateKey() };
    saveExchangeLocal(); // goes to the cloud with the next save
}

function renderAssetHistory(t) {
    snapshotAssets(t);
    const el = document.getElementById('fxAssetHistory');
    const months = Object.keys(exchangeState.assetHistory).sort().reverse().slice(0, 12);
    if (!months.length) {
        el.innerHTML = '<div class="log-empty">Laporan bulanan mulai terisi begitu saldo diisi lewat <b>Update saldo</b>.</div>';
        return;
    }
    const now = currentMonthKey();
    const change = (month, key) => {
        const prev = exchangeState.assetHistory[prevMonthKey(month)];
        if (!prev) return '';
        const d = exchangeState.assetHistory[month][key] - prev[key];
        return `<small class="${d < 0 ? 'is-down' : 'is-up'}">${d < 0 ? '▼' : '▲'} ${formatIDR(Math.abs(d))}</small>`;
    };
    el.innerHTML = `
        <div class="fx-history-table" role="table">
            <div class="fx-history-row is-head" role="row">
                <span role="columnheader">Bulan</span><span role="columnheader">Aset bersih</span><span role="columnheader">Pegangan</span>
                <span role="columnheader">+ Talangan</span><span role="columnheader">− Uang orang</span><span role="columnheader">Untung tukar</span><span role="columnheader">Pengeluaran</span>
            </div>
            ${months.map(m => {
                const s = exchangeState.assetHistory[m];
                return `
                <div class="fx-history-row" role="row">
                    <span role="cell" data-label="Bulan"><b>${escapeHTML(monthLabelOf(m))}</b>${m === now ? '<small>berjalan</small>' : `<small>per ${escapeHTML(formatShortDate(s.at))}</small>`}</span>
                    <span role="cell" data-label="Aset bersih" class="is-total"><b class="${s.total < 0 ? 'is-minus' : ''}">${formatIDR(s.total)}</b>${change(m, 'total')}</span>
                    <span role="cell" data-label="Pegangan">${formatIDR(s.pegangan)}</span>
                    <span role="cell" data-label="+ Talangan">${formatIDR(s.talangan)}</span>
                    <span role="cell" data-label="− Uang orang">${formatIDR(s.titipan + s.hutang)}</span>
                    <span role="cell" data-label="Untung tukar">${formatIDR(s.profit)}</span>
                    <span role="cell" data-label="Pengeluaran">${formatIDR(s.spent)}</span>
                </div>`;
            }).join('')}
        </div>
        ${months.some(m => exchangeState.assetHistory[m].investor) ? '<p class="bank-cut-hint">Dana investor tidak termasuk di aset bersih (masih nunggu konfirmasi cara hitungnya).</p>' : ''}`;
}

function openAssetDialog() {
    ensureExchangeUI();
    const dialog = document.getElementById('fxAssetDialog');
    document.activeElement && document.activeElement.blur && document.activeElement.blur();
    renderAssetPane();
    if (!dialog.open) dialog.showModal();
}

function closeAssetDialog() {
    const dialog = document.getElementById('fxAssetDialog');
    if (dialog.open) dialog.close();
    if (assetSaveTimer) flushAssetSave();
    renderAssetPane();
}
let assetSaveTimer = null;
const assetDirtyBanks = new Set();

function queueAssetSave() {
    renderAssetNumbers();
    clearTimeout(assetSaveTimer);
    assetSaveTimer = setTimeout(flushAssetSave, 700);
}

function flushAssetSave() {
    clearTimeout(assetSaveTimer);
    assetSaveTimer = null;
    if (assetDirtyBanks.size) {
        // A typed balance already includes everything recorded so far for that account, so
        // deleting an older spending later must not move it again.
        bankBalancesUpdatedAt = localDateKey();
        Object.values(expenseLogs).forEach(list => list.forEach(log => { if (assetDirtyBanks.has(log.bankKey)) log.bankCut = 0; }));
        fxAllTrades().forEach(t => { if (assetDirtyBanks.has(t.bankKey)) t.bankDelta = 0; });
        exchangeState.deposits.moves.forEach(m => { if (assetDirtyBanks.has(m.bankKey)) m.bankDelta = 0; });
        exchangeState.incomes.forEach(x => { if (assetDirtyBanks.has(x.bankKey)) x.bankAdd = 0; });
        exchangeState.deals.forEach(d => { if (assetDirtyBanks.has(d.bankKey)) d.bankDelta = 0; });
        assetDirtyBanks.clear();
    }
    saveExchangeLocal();
    saveLocalBillingState();
    saveLocalBankBalances();
    renderBankBalancesUI();
    persistBillingState();
}

function onAssetRate(input) {
    exchangeState.assetRates[input.dataset.assetRate] = kursFromField(input.value, input.dataset.assetRate);
    queueAssetSave();
}

// Kurs beli: what the owner pays per 1 when someone swaps pounds/dollars into rupiah.
function onBuyRate(input) {
    exchangeState.buyRates[input.dataset.buyRate] = kursFromField(input.value, input.dataset.buyRate);
    queueAssetSave();
}

function onHoldingInput(id, field, input) {
    const h = exchangeState.holdings.find(x => x.id === id);
    if (!h) return;
    if (field === 'amount') h.amount = Math.max(0, Math.round((Number(input.value) || 0) * 100) / 100);
    else if (field === 'label') h.label = input.value.slice(0, 40);
    else if (HOLDING_CURRENCIES.includes(input.value)) {
        h.currency = input.value;
        const row = input.closest('.fx-asset-row');
        row.querySelector('.fx-asset-flag').innerHTML = fxFlag(h.currency, 'fx-flag is-lg');
    }
    queueAssetSave();
}

function onAssetBank(key, input) {
    const value = Math.round(Number(String(input.value).replace(/[^0-9]/g, '')) || 0);
    const caretAtEnd = input.selectionStart === input.value.length;
    input.value = value ? value.toLocaleString('id-ID') : '';
    if (caretAtEnd) input.setSelectionRange(input.value.length, input.value.length);
    bankBalances[key] = value;
    assetDirtyBanks.add(key);
    queueAssetSave();
}

// kind "orang": a pocket of the owner's money that someone else holds, named after them.
function addHolding(kind = '', currency = FX_CURRENCIES[0], label = '') {
    exchangeState.holdings.push({ id: 'hold-' + crypto.randomUUID(), label, kind: kind === 'orang' ? 'orang' : '', currency, amount: 0 });
    document.activeElement && document.activeElement.blur();
    renderAssetPane();
    const rows = document.querySelectorAll(`#${kind === 'orang' ? 'fxHoldingOrangList' : 'fxHoldingList'} ${label ? 'input[type=number]' : '.fx-asset-label'}`);
    if (rows.length) rows[rows.length - 1].focus();
    queueAssetSave();
}

function removeHolding(id) {
    const h = exchangeState.holdings.find(x => x.id === id);
    if (!h) return;
    if (h.amount && !confirm(`Hapus ${placeName(h)} (${fxAmount(h.amount, h.currency)})?`)) return;
    exchangeState.holdings = exchangeState.holdings.filter(x => x.id !== id);
    document.activeElement && document.activeElement.blur();
    renderAssetPane();
    flushAssetSave();
}

// ---------- Catat tukar ----------
// One line per exchange, in any direction between rupiah and the account's currencies:
// - "jual"  kasih pound/dollar, terima rupiah (currency/qty/holdingId out, idr/bankKey in)
// - "beli"  kasih rupiah, terima pound/dollar (idr/bankKey out, currency/qty/holdingId in)
// - "swap"  kasih one foreign currency, terima another (currency/qty/holdingId out,
//           currency2/qty2/holdingId2 in)
// The place or bank on each side moves by its amount. Profit compares both sides at the owner's
// kurs modal of the moment the line was first saved.
const FX_STRENGTH = { IDR: 0, EGP: 1, MYR: 2, SAR: 2, USD: 3, EUR: 4 };
const DEAL_CURRENCIES = ['IDR', ...FX_CURRENCIES];

// A line saved before any kurs modal was set uses today's kurs modal instead, so its profit
// shows up as soon as the owner fills the kurs in.
function dealModal(d, which = 1) {
    const saved = which === 2 ? d.modal2 : d.modal;
    if (saved) return saved;
    const c = which === 2 ? d.currency2 : d.currency;
    return (typeof exchangeState === 'object' && exchangeState.assetRates && exchangeState.assetRates[c]) || 0;
}

function dealProfit(d) {
    const modal = dealModal(d);
    if (d.dir === 'swap') { const modal2 = dealModal(d, 2); return modal && modal2 ? Math.round(d.qty2 * modal2 - d.qty * modal) : 0; }
    if (!modal) return 0;
    const atModal = Math.round(d.qty * modal);
    return d.dir === 'beli' ? atModal - d.idr : d.idr - atModal;
}

// Rupiah in from "jual" minus rupiah out for "beli" (a swap moves no rupiah).
function dealRupiahNet(list) {
    return list.reduce((s, d) => s + (d.dir === 'beli' ? -d.idr : d.dir === 'swap' ? 0 : d.idr), 0);
}

function dealProfitSum(list) {
    return list.reduce((s, d) => s + dealProfit(d), 0);
}

// What leaves and what arrives, whatever the direction.
function dealSides(d) {
    if (d.dir === 'beli') return { out: { c: 'IDR', amount: d.idr }, in: { c: d.currency, amount: d.qty } };
    if (d.dir === 'swap') return { out: { c: d.currency, amount: d.qty }, in: { c: d.currency2, amount: d.qty2 } };
    return { out: { c: d.currency, amount: d.qty }, in: { c: 'IDR', amount: d.idr } };
}

// The kurs is always "weaker per 1 stronger": Rp per 1 EGP, Rp per 1 USD, EGP per 1 USD.
function dealPairOf(outC, inC) {
    const outStrong = (FX_STRENGTH[outC] ?? 1) > (FX_STRENGTH[inC] ?? 1);
    return { strong: outStrong ? outC : inC, weak: outStrong ? inC : outC, outStrong };
}

// Unrounded, so a kurs typed as pound per Rp 1 juta comes back as the same round number.
function dealRateOf(d) {
    const s = dealSides(d);
    const p = dealPairOf(s.out.c, s.in.c);
    const strongAmt = p.outStrong ? s.out.amount : s.in.amount;
    const weakAmt = p.outStrong ? s.in.amount : s.out.amount;
    return strongAmt ? weakAmt / strongAmt : 0;
}

function dealRateText(rate, weak, strong) {
    if (weak === 'IDR') return isPerJuta(strong) ? kursText(rate, strong) : `${fxRate(rate)} per 1 ${strong}`;
    return `${fxQty(rate)} ${weak} per 1 ${strong}`;
}

// The kurs field of Catat tukar: pound ↔ rupiah is typed as pound per Rp 1 juta.
function dealFieldPerJuta() {
    const { outC, inC } = dealPair();
    const p = dealPairOf(outC, inC);
    return p.weak === 'IDR' && isPerJuta(p.strong) ? p.strong : '';
}

function setDealRateField(rate) {
    const c = dealFieldPerJuta();
    document.getElementById('fxDealRate').value = !rate ? '' : c ? kursToField(rate, c) : Math.round(rate * 100) / 100;
}

let dealEditId = '';
let dealLastTyped = 'rate';

function ensureDealDialog() {
    if (document.getElementById('fxDealDialog')) return;
    const dialog = document.createElement('dialog');
    dialog.id = 'fxDealDialog';
    dialog.className = 'invoice-manager-dialog';
    dialog.setAttribute('aria-labelledby', 'fxDealTitle');
    const options = DEAL_CURRENCIES.map(c => `<option value="${c}">${c}</option>`).join('');
    dialog.innerHTML = `
        <div class="manager-heading"><h2 id="fxDealTitle">Catat tukar</h2><button type="button" aria-label="Tutup" onclick="document.getElementById('fxDealDialog').close()">×</button></div>
        <div class="manager-content">
            <form onsubmit="handleDealSubmit(event)">
                <div class="draft-fields">
                    <div class="wide-field fx-pair-head" id="fxDealPairHead" aria-live="polite"></div>
                    <label class="wide-field">Dengan siapa<input type="text" id="fxDealName" maxlength="80" list="fxNameList" autocomplete="off" placeholder="Pilih atau ketik nama, contoh: Buust"></label>
                    <div class="fx-side is-in">
                        <label>Dari <small>(uang yang orang kasih ke kamu)</small><select id="fxDealIn" onchange="onDealPair('in')">${options}</select></label>
                        <label>Jumlah<input type="text" id="fxDealInAmt" inputmode="decimal" required autocomplete="off" oninput="onDealAmount('in', this)"></label>
                        <label><span id="fxDealInToLabel">Masuk ke</span><select id="fxDealInTo" onchange="renderDealPreview()"></select></label>
                    </div>
                    <div class="fx-side is-out">
                        <label>Ke <small>(uang yang orang terima dari kamu)</small><select id="fxDealOut" onchange="onDealPair('out')">${options}</select></label>
                        <label>Jumlah<input type="text" id="fxDealOutAmt" inputmode="decimal" required autocomplete="off" oninput="onDealAmount('out', this)"></label>
                        <label><span id="fxDealOutFromLabel">Diambil dari</span><select id="fxDealOutFrom" onchange="renderDealPreview()"></select></label>
                    </div>
                    <button type="button" class="month-pill-btn fx-flip" onclick="flipDeal()">⇄ Balik arah</button>
                    <label><span class="fx-label-flag"><span id="fxDealRateFlags"></span><span id="fxDealRateLabel">Kurs</span></span><input type="text" id="fxDealRate" inputmode="decimal" autocomplete="off" placeholder="Contoh: 340" oninput="onDealRate()"></label>
                    <label>Tanggal<input type="date" id="fxDealDate" required></label>
                    <label class="wide-field fx-restock" id="fxDealRestockRow"><input type="checkbox" id="fxDealRestock" checked onchange="renderDealPreview()"><span>Ini restok (mis. dari TKW): kurs ini jadi <b>kurs modal</b> buat hitung untung jual berikutnya</span></label>
                </div>
                <div class="fx-preview" id="fxDealPreview"></div>
                <p class="draft-error" id="fxDealError" role="alert"></p>
                <div class="pack-dialog-actions">
                    <button type="button" class="delete-invoice-btn" id="fxDealDelete" onclick="deleteDeal()">Hapus</button>
                    <span style="flex:1"></span>
                    <button type="submit" class="create-invoice-btn">Simpan</button>
                </div>
            </form>
        </div>`;
    document.body.appendChild(dialog);
    ['fxDealOut', 'fxDealIn'].forEach(id => { if (!FX_CHIP_SELECTS.includes(id)) FX_CHIP_SELECTS.push(id); });
}

// Rupiah is typed as 13.600.000; pounds/dollars may have decimals (1.250,50 or 1250.5).
function parseDealAmount(text, currency) {
    const raw = String(text || '').trim();
    if (currency === 'IDR') return Math.round(Number(raw.replace(/[^0-9]/g, '')) || 0);
    const clean = raw.replace(/\s/g, '');
    const normal = /,\d{1,2}$/.test(clean) ? clean.replace(/\./g, '').replace(',', '.') : clean.replace(/,/g, '');
    return Math.round((Number(normal) || 0) * 100) / 100;
}

function showDealAmount(n, currency) {
    if (!n) return '';
    return currency === 'IDR' ? Math.round(n).toLocaleString('id-ID') : String(Math.round(n * 100) / 100);
}

// Where one side's money comes from or goes to: a bank for rupiah, a place in Aset otherwise.
function dealSourceOptions(currency, selected, side) {
    if (currency === 'IDR') return bankOptionsHTML(selected);
    const list = exchangeState.holdings.filter(h => h.currency === currency);
    return list.map(h => `<option value="${escapeHTML(h.id)}"${h.id === selected ? ' selected' : ''}>${escapeHTML(placeName(h))}${FX_LIMITED ? '' : ` · ${fxQty(h.amount)} ${h.currency}`}</option>`).join('')
        + `<option value=""${selected === '' ? ' selected' : ''}>${side === 'in' ? 'Tidak ke tempat di Aset' : 'Tidak dari tempat di Aset'}</option>`;
}

function dealDefaultSource(currency) {
    if (currency === 'IDR') return lastExpenseBank() || (BANK_ACCOUNTS[0] || {}).key || '';
    // The owner's own place first; a pocket someone else holds only when it is the only one.
    const own = exchangeState.holdings.find(h => h.currency === currency && h.kind !== 'orang');
    return ((own || exchangeState.holdings.find(h => h.currency === currency)) || {}).id || '';
}

function dealPair() {
    return { outC: document.getElementById('fxDealOut').value, inC: document.getElementById('fxDealIn').value };
}

// Default kurs for a pair: kasih valas → its last kurs; terima valas → kurs beli; valas ↔ valas →
// the last kurs used for that pair.
function dealDefaultRate(outC, inC) {
    if (inC === 'IDR') return exchangeState.rates[outC] ? exchangeState.rates[outC].sell || 0 : 0;
    if (outC === 'IDR') return exchangeState.buyRates[inC] || 0;
    const p = dealPairOf(outC, inC);
    return exchangeState.crossRates[`${p.strong}-${p.weak}`] || 0;
}

// Names as Ziaud says them: what the customer hands over → what they get ("Indo → Cai").
const DEAL_PLACE_NAMES = { IDR: 'Indo', EGP: 'Cai', USD: 'Dollar' };
const DEAL_CURRENCY_NAMES = { IDR: 'Rupiah', EGP: 'Pound', USD: 'Dollar' };

function renderDealLabels() {
    const { outC, inC } = dealPair();
    const p = dealPairOf(outC, inC);
    const name = c => DEAL_CURRENCY_NAMES[c] || FX_NAMES[c] || c;
    document.getElementById('fxDealPairHead').innerHTML = `${fxFlag(inC, 'fx-flag is-lg')}<span class="fx-pair-arrow" aria-hidden="true">→</span>${fxFlag(outC, 'fx-flag is-lg')}<b>${escapeHTML(name(inC))} ke ${escapeHTML(name(outC))}</b><span>${escapeHTML(DEAL_PLACE_NAMES[inC] || inC)} → ${escapeHTML(DEAL_PLACE_NAMES[outC] || outC)}</span>`;
    document.getElementById('fxDealOutFromLabel').textContent = outC === 'IDR' ? 'Dari bank' : 'Diambil dari';
    document.getElementById('fxDealInToLabel').textContent = inC === 'IDR' ? 'Masuk ke bank' : 'Masuk ke';
    document.getElementById('fxDealOutAmt').placeholder = outC === 'IDR' ? 'Contoh: 3.400.000' : 'Contoh: 10000';
    document.getElementById('fxDealInAmt').placeholder = inC === 'IDR' ? 'Contoh: 3.400.000' : 'Contoh: 10000';
    document.getElementById('fxDealRateFlags').innerHTML = fxFlag(p.weak) + fxFlag(p.strong);
    const perJuta = dealFieldPerJuta();
    document.getElementById('fxDealRateLabel').textContent = perJuta ? `Kurs (${perJuta} per Rp 1 juta)` : p.weak === 'IDR' ? `Kurs (Rp per 1 ${p.strong})` : `Kurs (${p.weak} per 1 ${p.strong})`;
    document.getElementById('fxDealRate').placeholder = perJuta ? 'Contoh: 2950' : p.weak === 'IDR' ? 'Contoh: 16500' : 'Contoh: 50';
    document.getElementById('fxDealRestockRow').hidden = outC !== 'IDR';
}

function setDealSources(keepOut, keepIn) {
    const { outC, inC } = dealPair();
    const outSel = document.getElementById('fxDealOutFrom');
    const inSel = document.getElementById('fxDealInTo');
    outSel.innerHTML = dealSourceOptions(outC, keepOut !== undefined ? keepOut : dealDefaultSource(outC), 'out');
    inSel.innerHTML = dealSourceOptions(inC, keepIn !== undefined ? keepIn : dealDefaultSource(inC), 'in');
}

// Picking a currency: the two sides must differ and one of them is at most rupiah once.
function onDealPair(changed) {
    const outSel = document.getElementById('fxDealOut');
    const inSel = document.getElementById('fxDealIn');
    if (outSel.value === inSel.value) {
        const other = changed === 'out' ? inSel : outSel;
        const mine = changed === 'out' ? outSel.value : inSel.value;
        other.value = mine === 'IDR' ? FX_CURRENCIES[0] : 'IDR';
    }
    setDealSources();
    setDealRateField(dealDefaultRate(outSel.value, inSel.value));
    dealLastTyped = 'rate';
    fillDealFromRate('out');
    renderDealLabels();
    renderFxChips();
    renderDealPreview();
}

function flipDeal() {
    const outSel = document.getElementById('fxDealOut');
    const inSel = document.getElementById('fxDealIn');
    const outAmt = document.getElementById('fxDealOutAmt');
    const inAmt = document.getElementById('fxDealInAmt');
    [outSel.value, inSel.value] = [inSel.value, outSel.value];
    [outAmt.value, inAmt.value] = [inAmt.value, outAmt.value];
    setDealSources();
    // Flipping keeps the same pair, so the typed kurs still reads the same way.
    setDealRateField(dealDefaultRate(outSel.value, inSel.value) || readDealRate());
    dealLastTyped = 'rate';
    fillDealFromRate('out');
    renderDealLabels();
    renderFxChips();
    renderDealPreview();
}

// Always Rp per 1 (or weaker per 1 stronger), whatever way it was typed.
function readDealRate() {
    const typed = parseDealAmount(document.getElementById('fxDealRate').value, 'EGP');
    const c = dealFieldPerJuta();
    return c ? kursFromField(typed, c) : typed;
}

// From one side's amount and the kurs, work out the other side.
function fillDealFromRate(from) {
    const { outC, inC } = dealPair();
    const p = dealPairOf(outC, inC);
    const rate = readDealRate();
    const src = document.getElementById(from === 'out' ? 'fxDealOutAmt' : 'fxDealInAmt');
    const dst = document.getElementById(from === 'out' ? 'fxDealInAmt' : 'fxDealOutAmt');
    const srcC = from === 'out' ? outC : inC;
    const dstC = from === 'out' ? inC : outC;
    const amount = parseDealAmount(src.value, srcC);
    if (!amount || !rate) return;
    const srcStrong = from === 'out' ? p.outStrong : !p.outStrong;
    dst.value = showDealAmount(srcStrong ? amount * rate : amount / rate, dstC);
}

function fillDealRateFromAmounts() {
    const { outC, inC } = dealPair();
    const p = dealPairOf(outC, inC);
    const outAmt = parseDealAmount(document.getElementById('fxDealOutAmt').value, outC);
    const inAmt = parseDealAmount(document.getElementById('fxDealInAmt').value, inC);
    if (!outAmt || !inAmt) return;
    const strongAmt = p.outStrong ? outAmt : inAmt;
    const weakAmt = p.outStrong ? inAmt : outAmt;
    setDealRateField(weakAmt / strongAmt);
}

// The side typed first is the one given; the kurs fills the other. Typing the second side too
// (e.g. the exact transfer) works the kurs out instead.
let dealFirstSide = 'out';
function onDealAmount(side, input) {
    const { outC, inC } = dealPair();
    const c = side === 'out' ? outC : inC;
    if (c === 'IDR') {
        const n = parseDealAmount(input.value, 'IDR');
        input.value = n ? n.toLocaleString('id-ID') : '';
    }
    if (dealLastTyped === 'rate' || dealFirstSide === side) {
        dealFirstSide = side;
        dealLastTyped = 'rate';
        fillDealFromRate(side);
    } else {
        dealLastTyped = 'amount';
        fillDealRateFromAmounts();
    }
    renderDealPreview();
}

function onDealRate() {
    dealLastTyped = 'rate';
    fillDealFromRate(dealFirstSide);
    renderDealPreview();
}

function openDealDialog(id = '') {
    ensureExchangeUI();
    ensureDealDialog();
    const d = id ? exchangeState.deals.find(x => x.id === id) : null;
    dealEditId = d ? d.id : '';
    document.getElementById('fxDealTitle').textContent = d ? 'Ubah catatan tukar' : 'Catat tukar';
    document.getElementById('fxDealDelete').hidden = !d;
    document.getElementById('fxDealError').textContent = '';
    document.getElementById('fxDealName').value = d ? d.name : '';
    document.getElementById('fxDealDate').value = d ? d.date : localDateKey();
    renderNameList();
    if (d) {
        const s = dealSides(d);
        document.getElementById('fxDealOut').value = s.out.c;
        document.getElementById('fxDealIn').value = s.in.c;
        document.getElementById('fxDealOutAmt').value = showDealAmount(s.out.amount, s.out.c);
        document.getElementById('fxDealInAmt').value = showDealAmount(s.in.amount, s.in.c);
        document.getElementById('fxDealRestock').checked = !!d.restock;
        setDealRateField(dealRateOf(d));
        const outSrc = d.dir === 'beli' ? d.bankKey : d.holdingId;
        const inSrc = d.dir === 'beli' ? d.holdingId : d.dir === 'swap' ? d.holdingId2 : d.bankKey;
        setDealSources(outSrc, inSrc);
        dealLastTyped = 'amount';
        dealFirstSide = 'out';
    } else {
        const outC = document.getElementById('fxDealOut').value;
        if (!outC || outC === document.getElementById('fxDealIn').value || !DEAL_CURRENCIES.includes(outC)) {
            document.getElementById('fxDealOut').value = FX_CURRENCIES[0];
            document.getElementById('fxDealIn').value = 'IDR';
        }
        document.getElementById('fxDealOutAmt').value = '';
        document.getElementById('fxDealInAmt').value = '';
        setDealSources();
        document.getElementById('fxDealRestock').checked = true;
        setDealRateField(dealDefaultRate(dealPair().outC, dealPair().inC));
        dealLastTyped = 'rate';
        dealFirstSide = 'out';
    }
    renderDealLabels();
    renderFxChips();
    renderDealPreview();
    document.getElementById('fxDealDialog').showModal();
    if (!d) setTimeout(() => { if (!/^(INPUT|SELECT)$/.test((document.activeElement || {}).tagName || '')) document.getElementById('fxDealName').focus(); }, 30);
}

// The form as a deal record (without ids, deltas and modal).
function readDeal() {
    const { outC, inC } = dealPair();
    const outAmt = parseDealAmount(document.getElementById('fxDealOutAmt').value, outC);
    const inAmt = parseDealAmount(document.getElementById('fxDealInAmt').value, inC);
    const outSrc = document.getElementById('fxDealOutFrom').value;
    const inSrc = document.getElementById('fxDealInTo').value;
    const base = { name: document.getElementById('fxDealName').value.trim().slice(0, 80), date: document.getElementById('fxDealDate').value || localDateKey() };
    if (inC === 'IDR') return { ...base, dir: 'jual', currency: outC, qty: outAmt, holdingId: outSrc, idr: inAmt, bankKey: inSrc };
    if (outC === 'IDR') return { ...base, dir: 'beli', currency: inC, qty: inAmt, holdingId: inSrc, idr: outAmt, bankKey: outSrc, restock: document.getElementById('fxDealRestock').checked };
    return { ...base, dir: 'swap', currency: outC, qty: outAmt, holdingId: outSrc, currency2: inC, qty2: inAmt, holdingId2: inSrc, idr: 0, bankKey: '' };
}

// A restok is bought at its own kurs: no profit on it, and that kurs becomes the kurs modal.
function dealModals(d) {
    if (d.dir === 'beli' && d.restock && d.qty > 0 && d.idr > 0) return { modal: d.idr / d.qty, modal2: 0 };
    return { modal: exchangeState.assetRates[d.currency] || 0, modal2: d.dir === 'swap' ? (exchangeState.assetRates[d.currency2] || 0) : 0 };
}

function renderDealPreview() {
    const d = readDeal();
    const s = dealSides(d);
    const lines = [];
    if (FX_LIMITED) {
        // No kurs modal, profit or balances for a limited login: just the kurs of this exchange.
        if (s.out.amount && s.in.amount) {
            const p = dealPairOf(s.out.c, s.in.c);
            lines.push(`<div class="fx-must-get"><span>Kurs <b>${dealRateText(dealRateOf(d), p.weak, p.strong)}</b></span></div>`);
            if (d.restock) lines.push(`Restok: kurs ini jadi kurs modal ${d.currency}.`);
        }
        document.getElementById('fxDealPreview').innerHTML = lines.map(l => `<div>${l}</div>`).join('');
        return;
    }
    if (s.out.amount && s.in.amount && d.restock) {
        const p = dealPairOf(s.out.c, s.in.c);
        const was = exchangeState.assetRates[d.currency];
        lines.push(`<div class="fx-must-get"><span>Kurs <b>${dealRateText(dealRateOf(d), p.weak, p.strong)}</b></span><span>restok, belum ada untung</span></div>`);
        lines.push(`Kurs modal ${d.currency}: ${was ? kursText(was, d.currency) : 'kosong'} → <b>${kursText(d.idr / d.qty, d.currency)}</b>. Untung dihitung pas pound/dollar ini dijual.`);
    } else if (s.out.amount && s.in.amount) {
        const m = dealModals(d);
        const p = dealPairOf(s.out.c, s.in.c);
        const profit = dealProfit({ ...d, ...m });
        const known = d.dir === 'swap' ? m.modal && m.modal2 : m.modal;
        lines.push(`<div class="fx-must-get"><span>Kurs <b>${dealRateText(dealRateOf(d), p.weak, p.strong)}</b></span>${known ? `<span>untung <b class="is-profit ${profit < 0 ? 'is-minus' : ''}">${formatIDR(profit)}</b></span>` : ''}</div>`);
        if (!known) {
            const missing = d.dir === 'swap' ? [d.currency, d.currency2].filter(c => !exchangeState.assetRates[c]) : [d.currency];
            lines.push(`Isi <b>kurs modal ${missing.join(' & ')}</b> di Aset biar untungnya kehitung.`);
        } else if (d.dir === 'swap') {
            lines.push(`Nilai di kurs modal: terima ${formatIDR(Math.round(d.qty2 * m.modal2))} − kasih ${formatIDR(Math.round(d.qty * m.modal))}`);
        } else {
            lines.push(`Modal ${kursText(m.modal, d.currency)} × ${fxQty(d.qty)} ${d.currency} = ${formatIDR(Math.round(d.qty * m.modal))}`);
        }
    }
    const old = exchangeState.deals.find(x => x.id === dealEditId);
    const placeLine = (id, amount, currency, sign) => {
        const h = exchangeState.holdings.find(x => x.id === id);
        if (!h || !amount) return;
        let back = 0;
        if (old && old.holdingId === id) back += old.holdDelta || 0;
        if (old && old.holdingId2 === id) back -= old.holdDelta2 || 0;
        const now = Math.round((h.amount + back) * 100) / 100;
        const after = Math.round((now + sign * amount) * 100) / 100;
        lines.push(`${escapeHTML(placeName(h))}: ${fxQty(now)} → <b class="${after < 0 ? 'is-minus' : ''}">${fxQty(after)} ${currency}</b>`);
    };
    if (d.dir === 'jual') placeLine(d.holdingId, d.qty, d.currency, -1);
    if (d.dir === 'beli') placeLine(d.holdingId, d.qty, d.currency, 1);
    if (d.dir === 'swap') { placeLine(d.holdingId, d.qty, d.currency, -1); placeLine(d.holdingId2, d.qty2, d.currency2, 1); }
    if (isBankKey(d.bankKey) && d.idr) {
        const now = (Number(bankBalances[d.bankKey]) || 0) - (old && old.bankKey === d.bankKey ? old.bankDelta : 0);
        const after = now + (d.dir === 'beli' ? -d.idr : d.idr);
        lines.push(`Saldo ${escapeHTML(bankNameOf(d.bankKey))} ${formatIDR(now)} → <b class="${after < 0 ? 'is-minus' : ''}">${formatIDR(after)}</b>`);
    }
    document.getElementById('fxDealPreview').innerHTML = lines.map(l => `<div>${l}</div>`).join('');
}

// Undo (sign -1) or apply (+1) a deal's effect on the places and the bank.
// holdDelta leaves holdingId (negative when it arrives there), holdDelta2 arrives in holdingId2.
function applyDeal(d, sign) {
    const h = exchangeState.holdings.find(x => x.id === d.holdingId);
    if (h && d.holdDelta) h.amount = Math.round((h.amount - sign * d.holdDelta) * 100) / 100;
    const h2 = d.holdingId2 ? exchangeState.holdings.find(x => x.id === d.holdingId2) : null;
    if (h2 && d.holdDelta2) h2.amount = Math.round((h2.amount + sign * d.holdDelta2) * 100) / 100;
    if (d.bankDelta && isBankKey(d.bankKey)) bankBalances[d.bankKey] = (Number(bankBalances[d.bankKey]) || 0) + sign * d.bankDelta;
}

function handleDealSubmit(event) {
    event.preventDefault();
    const input = readDeal();
    const error = document.getElementById('fxDealError');
    const s = dealSides(input);
    if (!(s.out.amount > 0) || !(s.in.amount > 0)) { error.textContent = 'Isi jumlah yang kamu kasih dan yang kamu terima.'; return; }
    const old = exchangeState.deals.find(x => x.id === dealEditId);
    if (old) {
        applyDeal(old, -1);
        exchangeState.deals = exchangeState.deals.filter(x => x.id !== old.id);
    }
    if (isBankKey(input.bankKey)) rememberExpenseBank(input.bankKey);
    const isPlace = id => exchangeState.holdings.some(h => h.id === id);
    const counts = !(bankBalancesUpdatedAt && input.date < bankBalancesUpdatedAt);
    const m = dealModals(input);
    const sameAsOld = old && old.dir === input.dir && old.currency === input.currency && (input.dir !== 'swap' || old.currency2 === input.currency2);
    const deal = {
        id: old ? old.id : 'deal-' + crypto.randomUUID(),
        ...input,
        bankKey: isBankKey(input.bankKey) ? input.bankKey : '',
        holdDelta: isPlace(input.holdingId) ? (input.dir === 'beli' ? -input.qty : input.qty) : 0,
        holdDelta2: input.dir === 'swap' && isPlace(input.holdingId2) ? input.qty2 : 0,
        // Same rule as spendings: a date before the last typed balance is already inside it.
        bankDelta: isBankKey(input.bankKey) && counts ? (input.dir === 'beli' ? -input.idr : input.idr) : 0,
        by: old ? (old.by || '') : recordedBy(),
        // Keep the kurs modal of the first save, so changing the kurs later leaves old profits.
        // A restok always uses its own kurs.
        modal: !input.restock && sameAsOld && old.modal && !old.restock ? old.modal : m.modal,
        modal2: sameAsOld && old.modal2 ? old.modal2 : m.modal2,
        createdAt: old ? old.createdAt : Date.now()
    };
    applyDeal(deal, 1);
    exchangeState.deals.push(deal);
    // The next exchange of the same kind starts from this kurs (kurs beli has its own setting).
    if (deal.dir === 'jual') exchangeState.rates[deal.currency].sell = dealRateOf(deal);
    if (deal.dir === 'swap') { const p = dealPairOf(deal.currency, deal.currency2); exchangeState.crossRates[`${p.strong}-${p.weak}`] = dealRateOf(deal); }
    // The newest restok sets the kurs modal (an older one edited later leaves it alone).
    const newestRestock = deal.restock && !exchangeState.deals.some(x => x.id !== deal.id && x.restock && x.currency === deal.currency
        && (x.date > deal.date || (x.date === deal.date && x.createdAt > deal.createdAt)));
    if (newestRestock && !FX_LIMITED) exchangeState.assetRates[deal.currency] = deal.idr / deal.qty;
    reportMonth = deal.date.slice(0, 7);
    document.getElementById('fxDealDialog').close();
    saveExchangeAndSync();
    if (deal.restock) { showToast(`TERCATAT · KURS MODAL ${deal.currency} ${kursText(deal.idr / deal.qty, deal.currency).toUpperCase()}`); return; }
    const known = deal.dir === 'swap' ? dealModal(deal) && dealModal(deal, 2) : dealModal(deal);
    showToast(known ? `TERCATAT · UNTUNG ${formatIDR(dealProfit(deal))}` : 'TERCATAT');
}

function deleteDeal() {
    const d = exchangeState.deals.find(x => x.id === dealEditId);
    if (!d) return;
    const s = dealSides(d);
    if (!confirm(`Hapus catatan tukar ${d.name ? d.name + ': ' : ''}${fxAmount(s.in.amount, s.in.c)} → ${fxAmount(s.out.amount, s.out.c)}?\nJumlah di Aset dan saldo bank dikembalikan.`)) return;
    applyDeal(d, -1);
    exchangeState.deals = exchangeState.deals.filter(x => x.id !== d.id);
    document.getElementById('fxDealDialog').close();
    saveExchangeAndSync();
    showToast('CATATAN TUKAR DIHAPUS');
}

// ---------- Pemasukan & pengeluaran: rupiah, pound or dollar, from/to a bank or a place ----------
// One dialog for both. The money is kept as it is (currency + fxAmount, or amount for rupiah)
// and moves the chosen bank (rupiah only) or place in Aset (Cash Rupiah, InstaPay, Cash pound…).
// "amount" stays the rupiah value, so plans and rupiah totals keep working: for pounds/dollars
// it is worked out at the kurs modal of the moment (0 while there is none; the report then uses
// today's kurs modal).
// Pemasukan live in exchangeState.incomes (bankAdd / holdAdd), pengeluaran in expenseLogs per
// month (bankCut / holdCut), like the plan screen's spendings. A bank is not moved by a record
// dated before the last "Update saldo" (it is already inside that balance).
let moneyKind = 'in';
let moneyEditId = '';

function moneyCur(x) {
    return x && FX_CURRENCIES.includes(x.currency) ? x.currency : 'IDR';
}

function moneyQty(x) {
    return moneyCur(x) === 'IDR' ? Number(x.amount) || 0 : Number(x.fxAmount) || 0;
}

// Rupiah value of an income or spending (pounds/dollars at their saved kurs, else today's).
function moneyIdr(x) {
    const c = moneyCur(x);
    if (c === 'IDR') return Number(x.amount) || 0;
    return Math.round(moneyQty(x) * (Number(x.rate) || exchangeState.assetRates[c] || 0));
}

function moneyText(x) {
    return moneyCur(x) === 'IDR' ? formatIDR(moneyQty(x)) : fxAmount(moneyQty(x), moneyCur(x));
}

function moneyPlaceText(x, kind) {
    const h = x.holdingId ? exchangeState.holdings.find(p => p.id === x.holdingId) : null;
    if (h) return `${kind === 'in' ? 'masuk ke' : 'dari'} ${escapeHTML(placeName(h))}`;
    if (isBankKey(x.bankKey)) return `${kind === 'in' ? 'masuk ke' : 'dari'} ${escapeHTML(bankNameOf(x.bankKey))}`;
    return 'tunai';
}

function findSpend(id) {
    for (const [month, list] of Object.entries(expenseLogs)) {
        const log = (list || []).find(l => l.id === id);
        if (log) return { month, log };
    }
    return null;
}

function ensureMoneyDialog() {
    if (document.getElementById('fxMoneyDialog')) return;
    const dialog = document.createElement('dialog');
    dialog.id = 'fxMoneyDialog';
    dialog.className = 'invoice-manager-dialog';
    dialog.setAttribute('aria-labelledby', 'fxMoneyTitle');
    dialog.innerHTML = `
        <div class="manager-heading"><h2 id="fxMoneyTitle">Catat pemasukan</h2><button type="button" aria-label="Tutup" onclick="document.getElementById('fxMoneyDialog').close()">×</button></div>
        <div class="manager-content">
            <form onsubmit="handleMoneySubmit(event)">
                <div class="draft-fields">
                    <label class="wide-field">Mata uang<select id="fxMoneyCur" onchange="onMoneyCurrency()">${['IDR', ...FX_CURRENCIES].map(c => `<option value="${c}">${c}</option>`).join('')}</select></label>
                    <label>Nominal <span id="fxMoneyUnit"></span><input type="text" id="fxMoneyAmount" inputmode="decimal" required autocomplete="off" oninput="onMoneyAmount(this)"></label>
                    <label>Tanggal<input type="date" id="fxMoneyDate" required onchange="onMoneyDate()"></label>
                    <label class="wide-field">Keterangan<input type="text" id="fxMoneyNote" maxlength="120" list="fxNameList" autocomplete="off"></label>
                    <label class="wide-field" id="fxMoneyPosRow">Masuk ke pos<select id="fxMoneyPos"></select></label>
                    <label class="wide-field"><span id="fxMoneySrcLabel">Masuk ke</span><select id="fxMoneySrc" onchange="renderMoneyPreview()"></select></label>
                </div>
                <div class="fx-preview" id="fxMoneyPreview"></div>
                <p class="draft-error" id="fxMoneyError" role="alert"></p>
                <div class="pack-dialog-actions">
                    <button type="button" class="delete-invoice-btn" id="fxMoneyDelete" onclick="deleteMoney()">Hapus</button>
                    <span style="flex:1"></span>
                    <button type="submit" class="create-invoice-btn">Simpan</button>
                </div>
            </form>
        </div>`;
    document.body.appendChild(dialog);
    if (!FX_CHIP_SELECTS.includes('fxMoneyCur')) FX_CHIP_SELECTS.push('fxMoneyCur');
}

// Where the money goes to / comes from: banks (rupiah only), the places in Aset holding this
// currency, or cash that is not in Aset.
function moneySourceOptions(c, selected) {
    const opt = (value, label) => `<option value="${escapeHTML(value)}"${value === selected ? ' selected' : ''}>${escapeHTML(label)}</option>`;
    const banks = c === 'IDR' ? BANK_ACCOUNTS.map(acc => opt('bank:' + acc.key, acc.name + (FX_LIMITED ? '' : ` · saldo ${formatIDR(Number(bankBalances[acc.key]) || 0)}`))) : [];
    const places = exchangeState.holdings.filter(h => h.currency === c).map(h => opt('hold:' + h.id, placeName(h) + (FX_LIMITED ? '' : ` · ${fxAmount(h.amount, c)}`)));
    return [...banks, ...places, opt('', moneyKind === 'in' ? 'Tunai, tidak masuk ke Aset' : 'Tunai, bukan dari Aset')].join('');
}

function moneyDefaultSource(c) {
    if (c === 'IDR') { const k = lastExpenseBank() || (BANK_ACCOUNTS[0] || {}).key || ''; return k ? 'bank:' + k : ''; }
    // Pounds/dollars in or out by hand are usually cash: the owner's "Cash" place first.
    const cash = exchangeState.holdings.find(h => h.currency === c && h.kind !== 'orang' && /cash|tunai/i.test(h.label || ''));
    const id = cash ? cash.id : dealDefaultSource(c);
    return id ? 'hold:' + id : '';
}

function readMoneySource() {
    const v = document.getElementById('fxMoneySrc').value || '';
    return { bankKey: v.startsWith('bank:') ? v.slice(5) : '', holdingId: v.startsWith('hold:') ? v.slice(5) : '' };
}

function readMoneyAmount() {
    return parseDealAmount(document.getElementById('fxMoneyAmount').value, document.getElementById('fxMoneyCur').value);
}

function onMoneyAmount(input) {
    if (document.getElementById('fxMoneyCur').value === 'IDR') {
        const n = parseDealAmount(input.value, 'IDR');
        input.value = n ? n.toLocaleString('id-ID') : '';
    }
    renderMoneyPreview();
}

function renderMoneyLabels() {
    const c = document.getElementById('fxMoneyCur').value;
    document.getElementById('fxMoneyUnit').textContent = c === 'IDR' ? '(Rp)' : `(${c})`;
    document.getElementById('fxMoneyAmount').placeholder = c === 'IDR' ? 'Contoh: 500.000' : 'Contoh: 1000';
}

function onMoneyCurrency() {
    const c = document.getElementById('fxMoneyCur').value;
    document.getElementById('fxMoneyAmount').value = '';
    document.getElementById('fxMoneySrc').innerHTML = moneySourceOptions(c, moneyDefaultSource(c));
    renderMoneyLabels();
    renderFxChips();
    renderMoneyPreview();
    document.getElementById('fxMoneyAmount').focus();
}

function fillMoneyPos(selected) {
    const row = document.getElementById('fxMoneyPosRow');
    const select = document.getElementById('fxMoneyPos');
    const month = (document.getElementById('fxMoneyDate').value || localDateKey()).slice(0, 7);
    const hasPlans = moneyKind === 'out' && typeof planItemsOf === 'function' && planItemsOf(month).length > 0;
    row.hidden = !hasPlans;
    if (hasPlans) fillLogPosSelect(select, month, selected);
    else select.innerHTML = '<option value="">Di luar rencana</option>';
}

function onMoneyDate() {
    fillMoneyPos(document.getElementById('fxMoneyPos').value);
    renderMoneyPreview();
}

function moneyEditRecord() {
    if (!moneyEditId) return null;
    if (moneyKind === 'in') return exchangeState.incomes.find(x => x.id === moneyEditId) || null;
    const found = findSpend(moneyEditId);
    return found ? found.log : null;
}

function renderMoneyPreview() {
    const el = document.getElementById('fxMoneyPreview');
    const c = document.getElementById('fxMoneyCur').value;
    const q = readMoneyAmount();
    const date = document.getElementById('fxMoneyDate').value;
    const { bankKey, holdingId } = readMoneySource();
    const sign = moneyKind === 'in' ? 1 : -1;
    const lines = [];
    if (q && !FX_LIMITED) {
        const old = moneyEditRecord();
        if (c !== 'IDR') {
            const rate = exchangeState.assetRates[c];
            lines.push(rate ? `≈ <b>${formatIDR(Math.round(q * rate))}</b> di kurs modal ${kursText(rate, c)}` : `Kurs modal ${c} belum diisi, nilai rupiahnya dihitung setelah diisi.`);
        }
        if (bankKey && isBankKey(bankKey)) {
            const back = old && old.bankKey === bankKey ? (moneyKind === 'in' ? -(old.bankAdd || 0) : (old.bankCut || 0)) : 0;
            const now = (Number(bankBalances[bankKey]) || 0) + back;
            lines.push(bankBalancesUpdatedAt && date < bankBalancesUpdatedAt
                ? `Saldo ${escapeHTML(bankNameOf(bankKey))} tidak berubah: tanggalnya sebelum saldo terakhir diperbarui.`
                : `Saldo ${escapeHTML(bankNameOf(bankKey))} ${formatIDR(now)} → <b class="${now + sign * q < 0 ? 'is-minus' : ''}">${formatIDR(now + sign * q)}</b>`);
        }
        const h = holdingId ? exchangeState.holdings.find(x => x.id === holdingId) : null;
        if (h) {
            const back = old && old.holdingId === h.id ? (moneyKind === 'in' ? -(old.holdAdd || 0) : (old.holdCut || 0)) : 0;
            const now = Math.round(((Number(h.amount) || 0) + back) * 100) / 100;
            const after = Math.round((now + sign * q) * 100) / 100;
            lines.push(`${escapeHTML(placeName(h))}: ${fxAmount(now, c)} → <b class="${after < 0 ? 'is-minus' : ''}">${fxAmount(after, c)}</b>`);
        }
    }
    el.innerHTML = lines.map(l => `<div>${l}</div>`).join('');
}

// kind: 'in' (pemasukan) or 'out' (pengeluaran); posId pre-picks a plan line for a spending.
function openMoneyDialog(kind = 'in', id = '', posId = '') {
    ensureExchangeUI();
    ensureMoneyDialog();
    moneyKind = kind === 'out' ? 'out' : 'in';
    moneyEditId = id || '';
    const x = moneyEditRecord();
    if (id && !x) moneyEditId = '';
    const c = x ? moneyCur(x) : 'IDR';
    const word = moneyKind === 'in' ? 'pemasukan' : 'pengeluaran';
    document.getElementById('fxMoneyTitle').textContent = x ? `Ubah ${word}` : `Catat ${word}`;
    document.getElementById('fxMoneyDelete').hidden = !x;
    document.getElementById('fxMoneyError').textContent = '';
    document.getElementById('fxMoneyCur').value = c;
    document.getElementById('fxMoneyAmount').value = x ? showDealAmount(moneyQty(x), c) : '';
    document.getElementById('fxMoneyDate').value = x ? x.date : localDateKey();
    document.getElementById('fxMoneyNote').value = x ? (x.note || x.merchant || '') : '';
    document.getElementById('fxMoneyNote').placeholder = moneyKind === 'in' ? 'Contoh: fee jasa, transfer dari Bang Ja' : 'Contoh: diambil Azam, makan, transport';
    document.getElementById('fxMoneySrcLabel').textContent = moneyKind === 'in' ? 'Masuk ke' : 'Dibayar dari';
    const src = x ? (x.holdingId ? 'hold:' + x.holdingId : isBankKey(x.bankKey) ? 'bank:' + x.bankKey : '') : moneyDefaultSource(c);
    document.getElementById('fxMoneySrc').innerHTML = moneySourceOptions(c, src);
    fillMoneyPos(x ? x.posId : posId);
    renderNameList();
    renderMoneyLabels();
    renderFxChips();
    renderMoneyPreview();
    document.getElementById('fxMoneyDialog').showModal();
    if (!x) setTimeout(() => document.getElementById('fxMoneyAmount').focus(), 30);
}

// Undo (sign -1) or apply (+1) what a record did to its bank and place.
function moveMoney(x, kind, sign) {
    const bankField = kind === 'in' ? 'bankAdd' : 'bankCut';
    const holdField = kind === 'in' ? 'holdAdd' : 'holdCut';
    const dir = kind === 'in' ? 1 : -1;
    if (sign < 0) {
        if (x[bankField] > 0 && isBankKey(x.bankKey)) bankBalances[x.bankKey] = (Number(bankBalances[x.bankKey]) || 0) - dir * x[bankField];
        const h = x.holdingId ? exchangeState.holdings.find(p => p.id === x.holdingId) : null;
        if (h && x[holdField] > 0) h.amount = Math.round((h.amount - dir * x[holdField]) * 100) / 100;
        x[bankField] = 0;
        if (x.holdingId) x[holdField] = 0;
        return;
    }
    const c = moneyCur(x);
    const q = moneyQty(x);
    x[bankField] = 0;
    if (c === 'IDR' && isBankKey(x.bankKey) && !x.keepBank && !(bankBalancesUpdatedAt && x.date < bankBalancesUpdatedAt)) {
        bankBalances[x.bankKey] = (Number(bankBalances[x.bankKey]) || 0) + dir * q;
        x[bankField] = q;
    }
    delete x.keepBank;
    if (x.holdingId) {
        x[holdField] = 0;
        const h = exchangeState.holdings.find(p => p.id === x.holdingId && p.currency === c);
        if (h) { h.amount = Math.round((h.amount + dir * q) * 100) / 100; x[holdField] = q; }
    }
}

function handleMoneySubmit(event) {
    event.preventDefault();
    const c = document.getElementById('fxMoneyCur').value;
    const q = readMoneyAmount();
    const date = document.getElementById('fxMoneyDate').value;
    const error = document.getElementById('fxMoneyError');
    if (!q || !date) { error.textContent = 'Isi nominal dan tanggalnya.'; return; }
    const { bankKey, holdingId } = readMoneySource();
    if (bankKey) rememberExpenseBank(bankKey);
    const rate = c === 'IDR' ? 0 : (exchangeState.assetRates[c] || 0);
    const note = document.getElementById('fxMoneyNote').value.trim().slice(0, 120);
    const fields = {
        date,
        amount: c === 'IDR' ? Math.round(q) : Math.round(q * rate),
        note,
        bankKey: c === 'IDR' && isBankKey(bankKey) ? bankKey : '',
        holdingId: holdingId || ''
    };
    if (c !== 'IDR') Object.assign(fields, { currency: c, fxAmount: q, rate });
    const old = moneyEditRecord();
    // A record already inside a later "Update saldo" stays there unless its bank changes.
    const keepBank = old && old.bankKey && old.bankKey === fields.bankKey && moneyCur(old) === 'IDR' && c === 'IDR'
        && !(moneyKind === 'in' ? old.bankAdd : old.bankCut);
    let x;
    if (moneyKind === 'in') {
        if (old) {
            moveMoney(old, 'in', -1);
            ['currency', 'fxAmount', 'rate', 'holdingId', 'holdAdd'].forEach(k => delete old[k]);
            x = Object.assign(old, fields);
        } else {
            x = { id: 'inc-' + crypto.randomUUID(), ...fields, bankAdd: 0, by: recordedBy(), createdAt: Date.now() };
            exchangeState.incomes.push(x);
        }
        if (!x.holdingId) delete x.holdingId;
        if (keepBank) x.keepBank = true;
        moveMoney(x, 'in', 1);
    } else {
        const month = date.slice(0, 7);
        let base = { id: 'log-' + crypto.randomUUID(), by: recordedBy(), createdAt: Date.now(), merchant: '', source: 'manual' };
        if (old) {
            const found = findSpend(old.id);
            applyLogToPos(found.month, old.posId, -old.amount);
            moveMoney(old, 'out', -1);
            expenseLogs[found.month] = logsOf(found.month).filter(l => l.id !== old.id);
            base = { id: old.id, by: old.by || '', createdAt: old.createdAt, merchant: old.merchant || '', source: old.source || 'manual' };
        }
        const posSel = document.getElementById('fxMoneyPos').value;
        const posId = planItemsOf(month).some(p => p.id === posSel) ? posSel : '';
        x = { ...base, ...fields, posId, bankCut: 0 };
        if (!x.holdingId) delete x.holdingId;
        if (keepBank) x.keepBank = true;
        moveMoney(x, 'out', 1);
        expenseLogs[month] = logsOf(month).concat(x);
        applyLogToPos(month, posId, x.amount);
    }
    document.getElementById('fxMoneyDialog').close();
    afterMoneyChange(`${moneyKind === 'in' ? 'PEMASUKAN' : 'PENGELUARAN'} TERCATAT · ${moneyText(x).toUpperCase()}`);
}

function afterMoneyChange(message) {
    saveLocalBankBalances();
    saveExchangeLocal();
    saveLocalBillingState();
    if (typeof renderPlanUI === 'function') renderPlanUI();
    saveExchangeAndSync();
    showToast(message);
}

function deleteMoney() {
    const x = moneyEditRecord();
    if (!x) return;
    const word = moneyKind === 'in' ? 'pemasukan' : 'pengeluaran';
    if (!confirm(`Hapus ${word} ${moneyText(x)}${x.note ? ' (' + x.note + ')' : ''}?\nSaldo bank / jumlah di Aset dikembalikan.`)) return;
    if (moneyKind === 'in') {
        moveMoney(x, 'in', -1);
        exchangeState.incomes = exchangeState.incomes.filter(i => i.id !== x.id);
    } else {
        const found = findSpend(x.id);
        applyLogToPos(found.month, x.posId, -x.amount);
        moveMoney(x, 'out', -1);
        expenseLogs[found.month] = logsOf(found.month).filter(l => l.id !== x.id);
    }
    document.getElementById('fxMoneyDialog').close();
    afterMoneyChange(`${word.toUpperCase()} DIHAPUS`);
}

// The old names, still used by buttons.
function openIncomeDialog(id = '') {
    openMoneyDialog('in', id);
}

// ---------- Laporan: pendapatan (untung tukar) vs pengeluaran ----------
let reportMonth = currentMonthKey();

function shiftReportMonth(delta) {
    reportMonth = delta < 0 ? prevMonthKey(reportMonth) : nextMonthKey(reportMonth);
    renderReportPane();
}

function openReportExpense() {
    openMoneyDialog('out');
}

function openReportExpenseEdit(id) {
    openMoneyDialog('out', id);
}

// ---------- Laporan harian ----------
// One line per day of the chosen month (newest first): tukar, rupiah in, profit, spending, the
// day's net, and the aset bersih at the end of that day with its change from the day before.
// Money in and out per currency: both sides of every tukar, pemasukan in, pengeluaran out.
// So a day reads "rupiah +1,5 jt · pound −53.112 · dollar +1.000" without converting anything.
function currencyFlows(deals, incomes, spends) {
    const f = {};
    const add = (c, k, n) => { if (!n) return; f[c] = f[c] || { in: 0, out: 0 }; f[c][k] = Math.round((f[c][k] + n) * 100) / 100; };
    deals.forEach(d => { const s = dealSides(d); add(s.in.c, 'in', s.in.amount); add(s.out.c, 'out', s.out.amount); });
    incomes.forEach(x => add(moneyCur(x), 'in', moneyQty(x)));
    spends.forEach(l => add(moneyCur(l), 'out', moneyQty(l)));
    return f;
}

function currencyFlowsHTML(f) {
    const list = ['IDR', ...FX_CURRENCIES].filter(c => f[c]);
    if (!list.length) return '';
    const amt = (n, c) => c === 'IDR' ? formatIDR(n) : fxAmount(n, c);
    return `<div class="fx-dr-cur" role="cell">${list.map(c => {
        const net = Math.round((f[c].in - f[c].out) * 100) / 100;
        return `<span class="fx-dr-cur-item">${fxFlag(c)}<span><b class="${net < 0 ? 'is-out' : net > 0 ? 'is-in' : ''}">${net > 0 ? '+' : net < 0 ? '−' : ''}${amt(Math.abs(net), c)}</b><small>masuk ${amt(f[c].in, c)} · keluar ${amt(f[c].out, c)}</small></span></span>`;
    }).join('')}</div>`;
}

function renderDailyReport() {
    const el = document.getElementById('fxDailyReport');
    const today = localDateKey();
    const [y, m] = reportMonth.split('-').map(Number);
    const lastDay = reportMonth === today.slice(0, 7) ? Number(today.slice(8, 10)) : new Date(y, m, 0).getDate();
    const deals = exchangeState.deals.filter(d => d.date.slice(0, 7) === reportMonth);
    const spends = expenseLogs[reportMonth] || [];
    const others = exchangeState.incomes.filter(x => x.date.slice(0, 7) === reportMonth);
    const snapDays = Object.keys(exchangeState.assetDaily).sort();
    const snapBefore = day => {
        for (let i = snapDays.length - 1; i >= 0; i--) if (snapDays[i] < day) return exchangeState.assetDaily[snapDays[i]];
        return null;
    };
    // Columns: a limited login has no kurs modal or balances, so no untung and no aset bersih.
    const money = (n, cls = '') => `<span class="fx-dr-num ${cls}">${formatIDR(n)}</span>`;
    const none = '<span class="fx-dr-none">–</span>';
    const sum = { deals: 0, net: 0, profit: 0, income: 0, spent: 0 };
    const rows = [];
    for (let d = lastDay; d >= 1; d--) {
        const day = `${reportMonth}-${String(d).padStart(2, '0')}`;
        const dd = deals.filter(x => x.date === day);
        const ss = spends.filter(x => x.date === day);
        const ii = others.filter(x => x.date === day);
        const snap = exchangeState.assetDaily[day];
        if (!dd.length && !ss.length && !ii.length && !snap) continue;
        const dealProfitDay = dealProfitSum(dd);
        const incomeDay = ii.reduce((s, x) => s + moneyIdr(x), 0);
        const spent = ss.reduce((s, l) => s + moneyIdr(l), 0);
        const net = (FX_LIMITED ? 0 : dealProfitDay) + incomeDay - spent;
        sum.deals += dd.length; sum.net += dealRupiahNet(dd); sum.profit += dealProfitDay; sum.income += incomeDay; sum.spent += spent;
        const prev = snap ? snapBefore(day) : null;
        const change = snap && prev ? snap.total - prev.total : null;
        const date = new Date(y, m - 1, d);
        const who = [...new Set([...dd, ...ss, ...ii].map(x => x.by).filter(Boolean))];
        rows.push(`
            <div class="fx-dr-row${day === today ? ' is-today' : ''}" role="row">
                <div class="fx-dr-date" role="cell">
                    <span class="fx-dr-day">${d}</span>
                    <span class="fx-dr-date-text"><b>${escapeHTML(date.toLocaleDateString('id-ID', { weekday: 'long' }))}${day === today ? ' <em>hari ini</em>' : ''}</b>${who.length ? `<small>${escapeHTML(who.join(', '))}</small>` : ''}</span>
                </div>
                <div class="fx-dr-cell${dd.length ? '' : ' is-empty'}" role="cell" data-label="Tukar">${dd.length ? `<span class="fx-dr-num">${dd.length}×</span><small>${formatIDR(dealRupiahNet(dd))}</small>` : none}</div>
                ${FX_LIMITED ? '' : `<div class="fx-dr-cell${dd.length ? '' : ' is-empty'}" role="cell" data-label="Untung tukar">${dd.length ? money(dealProfitDay, dealProfitDay < 0 ? 'is-out' : 'is-in') : none}</div>`}
                <div class="fx-dr-cell${ii.length ? '' : ' is-empty'}" role="cell" data-label="Pemasukan">${ii.length ? money(incomeDay, 'is-in') : none}</div>
                <div class="fx-dr-cell${ss.length ? '' : ' is-empty'}" role="cell" data-label="Pengeluaran">${ss.length ? money(spent, 'is-out') : none}</div>
                <div class="fx-dr-cell is-net" role="cell" data-label="Bersih">${money(net, net < 0 ? 'is-out' : net > 0 ? 'is-in' : '')}</div>
                ${FX_LIMITED ? '' : `<div class="fx-dr-cell is-asset" role="cell" data-label="Aset bersih">${snap ? `<span class="fx-dr-num">${formatIDR(snap.total)}</span>${change === null ? '' : `<small class="${change < 0 ? 'is-down' : 'is-up'}">${change < 0 ? '▼' : '▲'} ${formatIDR(Math.abs(change))}</small>`}` : none}</div>`}
                ${currencyFlowsHTML(currencyFlows(dd, ii, ss))}
            </div>`);
    }
    const monthFlows = currencyFlows(deals, others, spends);
    const totalNet = (FX_LIMITED ? 0 : sum.profit) + sum.income - sum.spent;
    const heads = ['Tanggal', 'Tukar', FX_LIMITED ? '' : 'Untung tukar', 'Pemasukan', 'Pengeluaran', 'Bersih', FX_LIMITED ? '' : 'Aset bersih'].filter(Boolean);
    el.innerHTML = `
        <div class="fx-daily-head"><b>${FX_LIMITED ? 'Laporan harian saya' : 'Laporan harian'}</b><span>${FX_LIMITED ? 'Yang kamu catat tiap hari, plus uang masuk dan keluar per mata uang. Ziaud menerima ringkasannya tiap pagi.' : 'Bersih = untung tukar + pemasukan − pengeluaran. Di bawah tiap hari: uang masuk dan keluar per mata uang. Aset bersih dicatat otomatis di akhir tiap hari.'}</span></div>
        ${rows.length ? `<div class="fx-dr${FX_LIMITED ? ' is-limited' : ''}" role="table" aria-label="Laporan harian ${escapeHTML(monthLabelOf(reportMonth))}">
            <div class="fx-dr-row is-head" role="row">${heads.map(h => `<span role="columnheader">${h}</span>`).join('')}</div>
            ${rows.join('')}
            <div class="fx-dr-row is-foot" role="row">
                <div class="fx-dr-date" role="cell"><span class="fx-dr-date-text"><b>Total ${escapeHTML(monthLabelOf(reportMonth))}</b><small>${rows.length} hari</small></span></div>
                <div class="fx-dr-cell" role="cell" data-label="Tukar">${sum.deals ? `<span class="fx-dr-num">${sum.deals}×</span><small>${formatIDR(sum.net)}</small>` : none}</div>
                ${FX_LIMITED ? '' : `<div class="fx-dr-cell" role="cell" data-label="Untung tukar">${money(sum.profit, sum.profit < 0 ? 'is-out' : 'is-in')}</div>`}
                <div class="fx-dr-cell" role="cell" data-label="Pemasukan">${money(sum.income, 'is-in')}</div>
                <div class="fx-dr-cell" role="cell" data-label="Pengeluaran">${money(sum.spent, 'is-out')}</div>
                <div class="fx-dr-cell is-net" role="cell" data-label="Bersih">${money(totalNet, totalNet < 0 ? 'is-out' : 'is-in')}</div>
                ${FX_LIMITED ? '' : '<div class="fx-dr-cell is-asset" role="cell"></div>'}
                ${currencyFlowsHTML(monthFlows)}
            </div>
        </div>` : `<div class="log-empty">Belum ada catatan di ${escapeHTML(monthLabelOf(reportMonth))}.</div>`}`;
}

// Names already used anywhere (tukar, titipan, talangan), so a regular is picked, not retyped.
function renderNameList() {
    const names = new Set();
    exchangeState.deals.forEach(d => d.name && names.add(d.name));
    exchangeState.deposits.people.forEach(p => names.add(p.name));
    (typeof debts !== 'undefined' && Array.isArray(debts) ? debts : []).forEach(d => d.name && names.add(d.name));
    document.getElementById('fxNameList').innerHTML = [...names].sort((a, b) => a.localeCompare(b)).map(n => `<option value="${escapeHTML(n)}"></option>`).join('');
}

// One tukar line: "kasih" brings rupiah in (+), "terima" sends rupiah out (−).
// Read the customer's way: what they handed over → what they got, e.g. "Rupiah ke Pound".
// Which place in Aset the foreign money left or went to, e.g. "dari InstaPay", "ke Cash".
function dealPlaceText(d) {
    const nameOf = id => { const h = exchangeState.holdings.find(x => x.id === id); return h ? placeName(h) : ''; };
    const parts = [];
    if (d.dir === 'beli' && nameOf(d.holdingId)) parts.push(`masuk ke ${nameOf(d.holdingId)}`);
    if (d.dir !== 'beli' && nameOf(d.holdingId)) parts.push(`dari ${nameOf(d.holdingId)}`);
    if (d.dir === 'swap' && nameOf(d.holdingId2)) parts.push(`masuk ke ${nameOf(d.holdingId2)}`);
    return parts.map(escapeHTML).join(' · ');
}

// One line of the report as a timeline entry: time on the left, then who / what / details,
// the amount on the right and small tags (untung, restok, who recorded it) underneath.
// e: { onclick, kind: 'in'|'out'|'swap', record, withDate, title, what, meta: [], amount, tags: [] }
function entryHTML(e) {
    const t = Number(e.record && e.record.createdAt);
    const time = t ? new Date(t).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '';
    const by = e.record && e.record.by && window.DAR_WS && DAR_WS.team ? `<span class="fx-tag-pill is-by">${escapeHTML(e.record.by)}</span>` : '';
    return `
        <button type="button" class="fx-entry is-${e.kind}" onclick="${e.onclick}">
            <span class="fx-entry-time">${e.withDate ? `<small>${escapeHTML(formatShortDate(e.record.date))}</small>` : ''}${time || (e.withDate ? '' : '–')}</span>
            <span class="fx-entry-card">
                <span class="fx-entry-head">
                    <span class="fx-entry-title">${e.title}</span>
                    <span class="fx-entry-amount">${e.amount}</span>
                </span>
                ${e.what ? `<span class="fx-entry-what">${e.what}</span>` : ''}
                ${e.meta && e.meta.length ? `<span class="fx-entry-meta">${e.meta.filter(Boolean).map(m => `<span>${m}</span>`).join('')}</span>` : ''}
                ${(e.tags || []).length || by ? `<span class="fx-entry-tags">${(e.tags || []).join('')}${by}</span>` : ''}
            </span>
        </button>`;
}

function dealRowHTML(d, withDate = false) {
    const s = dealSides(d);
    const p = dealPairOf(s.out.c, s.in.c);
    const place = dealPlaceText(d);
    const name = c => DEAL_CURRENCY_NAMES[c] || c;
    const known = d.dir === 'swap' ? dealModal(d) && dealModal(d, 2) : dealModal(d);
    const amount = d.dir === 'swap' ? `${fxQty(d.qty2)} ${d.currency2}` : `${d.dir === 'beli' ? '−' : '+'}${formatIDR(d.idr)}`;
    const profit = dealProfit(d);
    const tags = [];
    if (d.restock) tags.push('<span class="fx-tag-pill is-restock">Restok · jadi kurs modal</span>');
    else if (!FX_LIMITED) tags.push(known ? `<span class="fx-tag-pill ${profit < 0 ? 'is-loss' : 'is-profit'}">untung ${formatIDR(profit)}</span>` : '<span class="fx-tag-pill is-muted">untung belum kehitung</span>');
    return entryHTML({
        onclick: `openDealDialog('${escapeHTML(d.id)}')`,
        kind: d.dir === 'beli' ? 'out' : d.dir === 'swap' ? 'swap' : 'in',
        record: d,
        withDate,
        title: escapeHTML(d.name || 'Tukar'),
        what: `<span class="fx-entry-flags">${fxFlag(s.in.c)}<i aria-hidden="true">→</i>${fxFlag(s.out.c)}</span>${escapeHTML(name(s.in.c))} ke ${escapeHTML(name(s.out.c))} · <b>${fxAmount(s.out.amount, s.out.c)}</b>`,
        meta: [`kurs ${dealRateText(dealRateOf(d), p.weak, p.strong)}`, d.bankKey ? escapeHTML(bankNameOf(d.bankKey)) : '', place],
        amount,
        tags
    });
}

// One person's tukar over all months, newest first, with totals.
function renderPersonHistory(who) {
    const key = who.toLowerCase();
    const deals = exchangeState.deals.filter(d => (d.name || '').toLowerCase().includes(key)).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
    document.getElementById('fxReportMonth').textContent = `Riwayat "${who}"`;
    document.getElementById('fxReportStats').innerHTML = `
        <div><span>Untung dari orang ini</span><b>${formatIDR(dealProfitSum(deals))}</b><small>${deals.length} kali tukar</small></div>
        <div><span>Rupiah bersih dari tukar</span><b>${formatIDR(dealRupiahNet(deals))}</b><small>${FX_CURRENCIES.map(c => fxQty(deals.filter(d => d.currency === c).reduce((s, d) => s + d.qty, 0)) + ' ' + c).join(' · ')}</small></div>`;
    const list = document.getElementById('fxReportList');
    list.innerHTML = deals.length ? `<section class="fx-day"><div class="fx-day-list is-dated">${deals.map(d => dealRowHTML(d, true)).join('')}</div></section>` :`<div class="log-empty">Belum ada catatan tukar untuk "${escapeHTML(who)}".</div>`;
}

function renderReportPane() {
    const list = document.getElementById('fxReportList');
    if (!list) return;
    renderNameList();
    const who = (document.getElementById('fxReportWho').value || '').trim();
    document.querySelector('#fxReportPane .fx-month-nav').hidden = Boolean(who);
    document.getElementById('fxDailyReport').hidden = Boolean(who);
    if (who) { renderPersonHistory(who); return; }
    renderDailyReport();
    document.getElementById('fxReportMonth').textContent = monthLabelOf(reportMonth);
    const deals = exchangeState.deals.filter(d => d.date.slice(0, 7) === reportMonth);
    const spends = (expenseLogs[reportMonth] || []).slice();
    const others = exchangeState.incomes.filter(x => x.date.slice(0, 7) === reportMonth);
    const fromTukar = dealProfitSum(deals);
    const otherIn = others.reduce((s, x) => s + moneyIdr(x), 0);
    const income = fromTukar + otherIn;
    const spent = spends.reduce((s, l) => s + moneyIdr(l), 0);
    document.getElementById('fxReportStats').innerHTML = `
        <div><span>Pendapatan</span><b>${formatIDR(income)}</b><small>untung tukar ${formatIDR(fromTukar)} · pemasukan lain ${formatIDR(otherIn)}</small></div>
        <div><span>Pengeluaran</span><b>${formatIDR(spent)}</b><small>${spends.length} catatan</small></div>
        <div><span>Bersih</span><b class="${income - spent < 0 ? 'is-minus' : ''}">${formatIDR(income - spent)}</b><small>pendapatan − pengeluaran</small></div>
        <div><span>Rupiah dari tukar</span><b>${formatIDR(dealRupiahNet(deals))}</b><small>masuk ${formatIDR(deals.filter(d => d.dir !== 'beli').reduce((s, d) => s + d.idr, 0))} · keluar ${formatIDR(deals.filter(d => d.dir === 'beli').reduce((s, d) => s + d.idr, 0))}</small></div>`;
    const days = {};
    const dayOf = date => (days[date] = days[date] || { deals: [], spends: [], incomes: [] });
    deals.forEach(d => { dayOf(d.date).deals.push(d); });
    spends.forEach(l => { dayOf(l.date).spends.push(l); });
    others.forEach(x => { dayOf(x.date).incomes.push(x); });
    const dates = Object.keys(days).sort().reverse();
    if (!dates.length) {
        list.innerHTML = `<div class="log-empty">Belum ada catatan di ${escapeHTML(monthLabelOf(reportMonth))}. Klik <b>+ Catat tukar</b> tiap kali kasih pound/dollar ke orang, <b>+ Pemasukan</b> atau <b>+ Pengeluaran</b> untuk uang masuk dan keluar lainnya.</div>`;
        return;
    }
    const today = localDateKey();
    list.innerHTML = dates.map(date => {
        const day = days[date];
        const [yy, mm, dd] = date.split('-').map(Number);
        const label = new Date(yy, mm - 1, dd).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short' });
        const dayIncome = dealProfitSum(day.deals);
        const dayOther = day.incomes.reduce((s, x) => s + moneyIdr(x), 0);
        const daySpent = day.spends.reduce((s, l) => s + moneyIdr(l), 0);
        const count = day.deals.length + day.incomes.length + day.spends.length;
        const sums = [
            day.deals.length && !FX_LIMITED ? `<span class="fx-day-sum is-profit">untung ${formatIDR(dayIncome)}</span>` : '',
            dayOther ? `<span class="fx-day-sum is-in">masuk ${formatIDR(dayOther)}</span>` : '',
            daySpent ? `<span class="fx-day-sum is-out">keluar ${formatIDR(daySpent)}</span>` : ''
        ].join('');
        return `
        <section class="fx-day">
            <header class="fx-day-head">
                <div class="fx-day-date"><b>${escapeHTML(label)}</b><span>${date === today ? '<em>Hari ini</em> · ' : ''}${count} catatan</span></div>
                ${sums ? `<div class="fx-day-sums">${sums}</div>` : ''}
            </header>
            <div class="fx-day-list">
            ${[
                // Everything of the day in one list, newest first, so it reads in the order it happened.
                ...day.incomes.map(x => ({ t: Number(x.createdAt) || 0, html: entryHTML({
                    onclick: `openIncomeDialog('${escapeHTML(x.id)}')`, kind: 'in', record: x,
                    title: escapeHTML(x.note || 'Pemasukan'),
                    meta: ['Pemasukan', moneyPlaceText(x, 'in'), moneyCur(x) !== 'IDR' && !FX_LIMITED && moneyIdr(x) ? `≈ ${formatIDR(moneyIdr(x))}` : ''],
                    amount: `+${moneyText(x)}`
                }) })),
                ...day.deals.map(d => ({ t: Number(d.createdAt) || 0, html: dealRowHTML(d) })),
                ...day.spends.map(l => ({ t: Number(l.createdAt) || 0, html: entryHTML({
                    onclick: `openReportExpenseEdit('${escapeHTML(l.id)}')`, kind: 'out', record: l,
                    title: escapeHTML(l.note || l.merchant || 'Pengeluaran'),
                    meta: ['Pengeluaran', l.merchant && l.note ? escapeHTML(l.merchant) : '', moneyPlaceText(l, 'out'), moneyCur(l) !== 'IDR' && !FX_LIMITED && moneyIdr(l) ? `≈ ${formatIDR(moneyIdr(l))}` : ''],
                    amount: `−${moneyText(l)}`
                }) }))
            ].sort((a, b) => b.t - a.t).map(x => x.html).join('')}
            </div>
        </section>`;
    }).join('');
}

function depositPerson(id) {
    return exchangeState.deposits.people.find(p => p.id === id);
}

function renderDepositUI() {
    const { byPerson, totals } = depositBalances();
    const people = exchangeState.deposits.people;
    document.getElementById('fxDepositCount').textContent = people.length || '';
    const totalCard = c => `<div><span>${fxFlag(c)} ${c === 'IDR' ? 'Titipan rupiah' : 'Titipan ' + c}</span><b>${fxAmount(totals[c], c)}</b><small>${people.filter(p => byPerson[p.id][c]).length} orang</small></div>`;
    document.getElementById('fxDepositTotals').innerHTML = FX_DEPOSIT_CURRENCIES.map(totalCard).join('') +
        `<div><span>Orang</span><b>${people.length}</b><small>${Object.entries(FX_DEPOSIT_KINDS).map(([k, v]) => people.filter(p => p.kind === k).length + ' ' + v.label.toLowerCase()).join(' · ')}</small></div>`;
    const list = document.getElementById('fxDepositList');
    if (!people.length) {
        list.innerHTML = '<div class="log-empty">Belum ada titipan. Klik <b>+ Orang baru</b> untuk investor atau pekerja yang nitip uang, lalu <b>+ Setor / nitip</b>.</div>';
        return;
    }
    const order = { investor: 0, pekerja: 1, pelanggan: 2, lainnya: 3 };
    list.innerHTML = people.slice().sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name)).map(p => {
        const bal = byPerson[p.id];
        const parts = FX_DEPOSIT_CURRENCIES.filter(c => bal[c]).map(c => `<span class="fx-dep-amount">${fxFlag(c)} ${fxAmount(bal[c], c)}</span>`);
        const last = exchangeState.deposits.moves.filter(m => m.personId === p.id).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)[0];
        return `
        <button type="button" class="fx-dep-row" onclick="openDepositHistory('${escapeHTML(p.id)}')">
            <span class="fx-dep-main">
                <span class="fx-dep-name">${escapeHTML(p.name)} <em class="fx-tag is-${p.kind}">${FX_DEPOSIT_KINDS[p.kind].label}</em></span>
                <span class="fx-dep-meta">${last ? `${FX_MOVE_TYPES[last.type].short} ${fxAmount(last.amount, last.currency)}${last.type === 'kirim' ? ' → ' + formatIDR(last.idr) : ''} · ${escapeHTML(formatShortDate(last.date))}` : 'Belum ada mutasi'}</span>
            </span>
            <span class="fx-dep-balances">${parts.length ? parts.join('') : '<span class="fx-dep-amount is-zero">Saldo 0</span>'}</span>
        </button>`;
    }).join('');
}

// ---- Person ----
function openDepositPersonDialog(editId = '') {
    ensureExchangeUI();
    const p = editId ? depositPerson(editId) : null;
    fxPersonEditId = p ? p.id : '';
    document.getElementById('fxPersonForm').reset();
    document.getElementById('fxPersonTitle').textContent = p ? 'Ubah data' : 'Orang baru';
    document.getElementById('fxPersonDeleteBtn').hidden = !p;
    if (p) {
        document.getElementById('fxPersonName').value = p.name;
        document.getElementById('fxPersonKind').value = p.kind;
        document.getElementById('fxPersonPhone').value = p.phone;
        document.getElementById('fxPersonNote').value = p.note;
    }
    document.getElementById('fxPersonDialog').showModal();
    setTimeout(() => document.getElementById('fxPersonName').focus(), 30);
}

function handleDepositPersonSubmit(event) {
    event.preventDefault();
    const name = document.getElementById('fxPersonName').value.trim().slice(0, 80);
    if (!name) return;
    const data = {
        name,
        kind: document.getElementById('fxPersonKind').value,
        phone: document.getElementById('fxPersonPhone').value.trim().slice(0, 30),
        note: document.getElementById('fxPersonNote').value.trim().slice(0, 160)
    };
    const existing = depositPerson(fxPersonEditId);
    let id = fxPersonEditId;
    if (existing) Object.assign(existing, data);
    else {
        id = 'dep-p-' + crypto.randomUUID();
        exchangeState.deposits.people.push({ id, ...data, demo: false, createdAt: Date.now() });
    }
    document.getElementById('fxPersonDialog').close();
    fxPane = 'titipan';
    saveExchangeAndSync();
    if (document.getElementById('fxHistoryDialog').open) renderDepositHistory();
    showToast(existing ? 'DATA DIPERBARUI' : `${name.toUpperCase()} DITAMBAHKAN`);
    if (!existing) openDepositMoveDialog(data.kind === 'investor' ? 'setor' : 'setor', id);
}

function deleteDepositPerson() {
    const p = depositPerson(fxPersonEditId);
    if (!p) return;
    const bal = depositBalances().byPerson[p.id];
    const left = FX_DEPOSIT_CURRENCIES.filter(c => bal[c]).map(c => fxAmount(bal[c], c));
    if (left.length) { alert(`${p.name} masih punya saldo ${left.join(' + ')}. Catat "Ambil uang" dulu sampai saldonya 0.`); return; }
    if (!confirm(`Hapus ${p.name} beserta riwayat mutasinya?`)) return;
    exchangeState.deposits.moves.filter(m => m.personId === p.id).forEach(m => removeDepositMove(m, false));
    exchangeState.deposits.people = exchangeState.deposits.people.filter(x => x.id !== p.id);
    document.getElementById('fxPersonDialog').close();
    document.getElementById('fxHistoryDialog').close();
    saveExchangeAndSync();
    showToast('ORANG DIHAPUS');
}

// ---- Setor / ambil / kirim rupiah ----
function openDepositMoveDialog(type = 'setor', personId = '') {
    ensureExchangeUI();
    const people = exchangeState.deposits.people;
    if (!people.length) { openDepositPersonDialog(); return; }
    document.getElementById('fxMoveForm').reset();
    document.getElementById('fxMoveError').textContent = '';
    document.getElementById('fxMovePerson').innerHTML = people.map(p => `<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)} · ${FX_DEPOSIT_KINDS[p.kind].label}</option>`).join('');
    if (personId) document.getElementById('fxMovePerson').value = personId;
    document.getElementById('fxMoveDate').value = localDateKey();
    document.getElementById('fxMoveBank').innerHTML = bankOptionsHTML(fxDefaultBank());
    fxMoveLast = 'amount';
    setDepositMoveType(type, true);
    document.getElementById('fxMoveDialog').showModal();
    setTimeout(() => document.getElementById('fxMoveAmount').focus(), 30);
}

function setDepositMoveType(type, pickCurrency = false) {
    fxMoveType = FX_MOVE_TYPES[type] ? type : 'setor';
    document.querySelectorAll('[data-fx-move]').forEach(b => b.classList.toggle('active', b.dataset.fxMove === fxMoveType));
    document.getElementById('fxMoveTitle').textContent = FX_MOVE_TYPES[fxMoveType].label;
    const currencies = fxMoveType === 'kirim' ? FX_CURRENCIES : FX_DEPOSIT_CURRENCIES;
    const select = document.getElementById('fxMoveCurrency');
    const keep = select.value;
    select.innerHTML = currencies.map(c => `<option value="${c}">${c === 'IDR' ? 'IDR · Rupiah' : c + ' · ' + (FX_NAMES[c] || c)}</option>`).join('');
    const person = depositPerson(document.getElementById('fxMovePerson').value);
    const bal = person ? depositBalances().byPerson[person.id] : {};
    // Sensible default: the currency this person already has, else by kind.
    const preferred = currencies.find(c => (fxMoveType !== 'setor' || pickCurrency) && bal && bal[c] > 0)
        || (person && person.kind === 'investor' ? 'IDR' : person && person.kind === 'pekerja' ? 'EGP' : currencies[0]);
    select.value = currencies.includes(keep) && !pickCurrency ? keep : (currencies.includes(preferred) ? preferred : currencies[0]);
    onDepositMoveChange();
}

function onDepositMoveChange() {
    renderFxChips();
    const c = document.getElementById('fxMoveCurrency').value;
    const kirim = fxMoveType === 'kirim';
    document.getElementById('fxMoveRateLabel').hidden = !kirim;
    document.getElementById('fxMoveIdrLabel').hidden = !kirim;
    document.getElementById('fxMoveBankLabel').hidden = !(kirim || c === 'IDR');
    document.getElementById('fxMoveAmountLabel').firstChild.textContent = kirim ? `Jumlah ${c} yang dicairkan` : `Jumlah (${c})`;
    const amount = document.getElementById('fxMoveAmount');
    amount.step = c === 'IDR' ? '1' : '0.01';
    amount.min = c === 'IDR' ? '1' : '0.01';
    if (kirim) {
        const rate = document.getElementById('fxMoveRate');
        if (!rate.value) {
            const r = exchangeState.rates[c] || {};
            const value = r.buy || Math.round((computeExchange().stock[c] || {}).avg * 100) / 100;
            if (value) rate.value = value;
        }
    }
    depositRecalc('rate');
}

function depositRecalc(field) {
    if (field !== 'rate') fxMoveLast = field;
    if (fxMoveType === 'kirim') {
        const amountEl = document.getElementById('fxMoveAmount');
        const idrEl = document.getElementById('fxMoveIdr');
        const rate = Number(document.getElementById('fxMoveRate').value) || 0;
        if (fxMoveLast === 'idr') {
            if (rate) amountEl.value = Math.round((Number(idrEl.value) || 0) / rate * 100) / 100 || '';
        } else if (rate && amountEl.value) {
            idrEl.value = Math.round((Number(amountEl.value) || 0) * rate) || '';
        }
    }
    renderDepositMovePreview();
}

function readDepositMove() {
    const c = document.getElementById('fxMoveCurrency').value;
    const raw = Number(document.getElementById('fxMoveAmount').value) || 0;
    return {
        personId: document.getElementById('fxMovePerson').value,
        type: fxMoveType,
        currency: c,
        amount: c === 'IDR' ? Math.round(raw) : Math.round(raw * 100) / 100,
        rate: Number(document.getElementById('fxMoveRate').value) || 0,
        idr: Math.round(Number(document.getElementById('fxMoveIdr').value) || 0),
        date: document.getElementById('fxMoveDate').value,
        bankKey: document.getElementById('fxMoveBank').value,
        note: document.getElementById('fxMoveNote').value.trim().slice(0, 160)
    };
}

function renderDepositMovePreview() {
    const m = readDepositMove();
    const el = document.getElementById('fxMovePreview');
    const person = depositPerson(m.personId);
    if (!person || !m.amount) { el.innerHTML = ''; return; }
    const bal = depositBalances().byPerson[person.id][m.currency] || 0;
    const after = m.type === 'setor' ? bal + m.amount : bal - m.amount;
    const lines = [`Saldo ${escapeHTML(person.name)}: ${fxAmount(bal, m.currency)} → <b class="${after < 0 ? 'is-minus' : ''}">${fxAmount(m.currency === 'IDR' ? after : Math.round(after * 100) / 100, m.currency)}</b>`];
    if (m.type === 'kirim' && m.idr) {
        const s = computeExchange().stock[m.currency];
        const newQty = Math.max(0, s.qty) + m.amount;
        const newAvg = (Math.max(0, s.qty) * s.avg + m.idr) / newQty;
        lines.push(`${fxQty(m.amount)} ${m.currency} ini jadi stok milikmu · modal rata-rata ${fxRate(Math.round(newAvg * 100) / 100)}`);
    }
    const delta = depositBankDeltaFor({ ...m, bankKey: isBankKey(m.bankKey) ? m.bankKey : '' });
    if (isBankKey(m.bankKey) && (m.type === 'kirim' || m.currency === 'IDR')) {
        const now = Number(bankBalances[m.bankKey]) || 0;
        lines.push(delta ? `Saldo ${escapeHTML(bankNameOf(m.bankKey))} ${formatIDR(now)} → ${formatIDR(now + delta)}` : `Saldo ${escapeHTML(bankNameOf(m.bankKey))} tidak berubah: saldonya diperbarui setelah tanggal ini.`);
    }
    el.innerHTML = lines.map(l => `<div>${l}</div>`).join('');
}

function handleDepositMoveSubmit(event) {
    event.preventDefault();
    const m = readDepositMove();
    const error = document.getElementById('fxMoveError');
    const person = depositPerson(m.personId);
    if (!person || m.amount <= 0 || !m.date) { error.textContent = 'Pilih orang dan isi jumlahnya.'; return; }
    if (m.type === 'kirim' && (m.rate <= 0 || m.idr <= 0)) { error.textContent = 'Isi kurs dan rupiah yang dikirim.'; return; }
    const bal = depositBalances().byPerson[person.id][m.currency] || 0;
    if (m.type !== 'setor' && m.amount > bal + 0.001) {
        error.textContent = `Saldo ${m.currency} ${person.name} cuma ${fxAmount(bal, m.currency)}.`;
        return;
    }
    if (isBankKey(m.bankKey)) rememberExpenseBank(m.bankKey);
    const move = {
        id: 'dep-' + crypto.randomUUID(),
        ...m,
        rate: m.type === 'kirim' ? Math.round(m.idr / m.amount * 100) / 100 : 0,
        idr: m.type === 'kirim' ? m.idr : 0,
        bankKey: (m.type === 'kirim' || m.currency === 'IDR') && isBankKey(m.bankKey) ? m.bankKey : '',
        bankDelta: 0,
        tradeId: '',
        demo: false,
        by: recordedBy(),
        createdAt: Date.now()
    };
    move.bankDelta = depositBankDeltaFor(move);
    if (move.bankDelta) bankBalances[move.bankKey] = (Number(bankBalances[move.bankKey]) || 0) + move.bankDelta;
    if (move.type === 'kirim') {
        // The worker's pounds stay here and become the owner's stock, bought at this kurs.
        const trade = { id: 'fx-' + crypto.randomUUID(), type: 'beli', date: move.date, currency: move.currency, qty: move.amount, rate: move.rate, idr: move.idr, customer: person.name, note: 'Dari titipan · kirim rupiah', bankKey: move.bankKey, bankDelta: 0, linked: move.id, demo: false, createdAt: move.createdAt };
        exchangeState.trades[move.date.slice(0, 7)] = (exchangeState.trades[move.date.slice(0, 7)] || []).concat(trade);
        move.tradeId = trade.id;
        exchangeState.rates[move.currency].buy = move.rate;
    }
    exchangeState.deposits.moves.push(move);
    document.getElementById('fxMoveDialog').close();
    fxPane = 'titipan';
    saveExchangeAndSync();
    if (document.getElementById('fxHistoryDialog').open) renderDepositHistory();
    const newBal = depositBalances().byPerson[person.id][move.currency];
    showToast(`${FX_MOVE_TYPES[move.type].short.toUpperCase()} TERCATAT · SALDO ${person.name.toUpperCase()} ${fxAmount(newBal, move.currency)}`);
}

function removeDepositMove(m, refundBank = true) {
    if (refundBank && m.bankDelta && isBankKey(m.bankKey)) bankBalances[m.bankKey] = (Number(bankBalances[m.bankKey]) || 0) - m.bankDelta;
    if (m.tradeId) {
        Object.keys(exchangeState.trades).forEach(month => {
            exchangeState.trades[month] = exchangeState.trades[month].filter(t => t.id !== m.tradeId);
        });
    }
    exchangeState.deposits.moves = exchangeState.deposits.moves.filter(x => x.id !== m.id);
}

function deleteDepositMove(id) {
    const m = exchangeState.deposits.moves.find(x => x.id === id);
    const person = m && depositPerson(m.personId);
    if (!m) return;
    const extra = [m.bankDelta ? `Saldo ${bankNameOf(m.bankKey)} dikembalikan.` : '', m.tradeId ? `Stok ${m.currency} dari pencairan ini ikut dihapus.` : ''].filter(Boolean).join(' ');
    if (!confirm(`Hapus ${FX_MOVE_TYPES[m.type].short.toLowerCase()} ${fxAmount(m.amount, m.currency)} (${person ? person.name : ''}, ${formatShortDate(m.date)})?${extra ? '\n' + extra : ''}`)) return;
    removeDepositMove(m);
    saveExchangeAndSync();
    renderDepositHistory();
    showToast('MUTASI DIHAPUS');
}

// ---- Per-person history and WhatsApp statement ----
function openDepositHistory(personId) {
    fxHistoryPerson = personId;
    renderDepositHistory();
    document.getElementById('fxHistoryDialog').showModal();
}

function renderDepositHistory() {
    const p = depositPerson(fxHistoryPerson);
    if (!p) { document.getElementById('fxHistoryDialog').close(); return; }
    const bal = depositBalances().byPerson[p.id];
    document.getElementById('fxHistoryTitle').textContent = p.name;
    const parts = FX_DEPOSIT_CURRENCIES.filter(c => bal[c]);
    document.getElementById('fxHistoryBalance').innerHTML = `
        <span>${FX_DEPOSIT_KINDS[p.kind].label}${p.phone ? ' · ' + escapeHTML(p.phone) : ''}${p.note ? ' · ' + escapeHTML(p.note) : ''}</span>
        <b>${parts.length ? parts.map(c => fxFlag(c, 'fx-flag is-lg') + ' ' + fxAmount(bal[c], c)).join('<br>') : 'Saldo 0'}</b>`;
    const moves = exchangeState.deposits.moves.filter(m => m.personId === p.id).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
    document.getElementById('fxHistoryList').innerHTML = moves.length ? moves.map(m => `
        <div class="fx-move-row is-${m.type}">
            <span class="log-row-main">
                <span class="log-row-title"><em class="fx-tag">${FX_MOVE_TYPES[m.type].short}</em> ${m.type === 'setor' ? '+' : '−'}${fxAmount(m.amount, m.currency)}</span>
                <span class="log-row-pos">${escapeHTML(formatShortDate(m.date))}${m.type === 'kirim' ? ` · dikirim ${formatIDR(m.idr)} (kurs ${fxRate(m.rate)})` : ''}${m.bankKey ? ' · ' + escapeHTML(bankNameOf(m.bankKey)) : ''}${m.note ? ' · ' + escapeHTML(m.note) : ''} ${byTag(m)}</span>
            </span>
            <button type="button" class="fx-move-del" onclick="deleteDepositMove('${escapeHTML(m.id)}')" aria-label="Hapus mutasi">×</button>
        </div>`).join('') : '<div class="log-empty">Belum ada mutasi.</div>';
}

function copyDepositStatement() {
    const p = depositPerson(fxHistoryPerson);
    if (!p) return;
    const bal = depositBalances().byPerson[p.id];
    const name = (window.DAR_WS && window.DAR_WS.name) || '';
    const moves = exchangeState.deposits.moves.filter(m => m.personId === p.id).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, 8);
    const parts = FX_DEPOSIT_CURRENCIES.filter(c => bal[c]);
    const text = [
        `*SALDO TITIPAN${name ? ' · ' + name.toUpperCase() : ''}*`,
        `Nama: ${p.name}`,
        `Per: ${formatShortDate(localDateKey())}`,
        '',
        parts.length ? parts.map(c => `💰 *${fxAmount(bal[c], c)}*`).join('\n') : 'Saldo: 0',
        moves.length ? '\nMutasi terakhir:' : '',
        ...moves.map(m => `• ${formatShortDate(m.date)} ${FX_MOVE_TYPES[m.type].short} ${fxAmount(m.amount, m.currency)}${m.type === 'kirim' ? ` → ${formatIDR(m.idr)}` : ''}`),
        '',
        'Kalau ada yang tidak sesuai, kabari ya 🙏'
    ].filter(l => l !== null).join('\n').replace(/\n{3,}/g, '\n\n');
    copyText(text).then(ok => showToast(ok ? 'SALDO DISALIN, TINGGAL TEMPEL DI WA' : 'GAGAL MENYALIN'));
}

// ---------- Assistant ----------
function exchangeAssistantContext() {
    const t = assetTotals();
    return {
        aset: {
            rumus: 'total bersih = pegangan + talangan - uang orang (titipan) - hutang; dana investor terpisah, belum masuk rumus',
            total_bersih_rupiah: t.total,
            pegangan_rupiah: t.pegangan,
            talangan_rupiah: t.talangan,
            uang_orang_rupiah: t.titipan,
            dana_investor_rupiah_belum_masuk_rumus: t.investor,
            hutang_rupiah: t.hutang,
            rupiah_di_bank: Object.fromEntries(BANK_ACCOUNTS.map(acc => [acc.name, Number(bankBalances[acc.key]) || 0])),
            kurs_pemilik_rp_per_1: exchangeState.assetRates,
            kurs_beli_rp_per_1: exchangeState.buyRates,
            valas: exchangeState.holdings.filter(h => h.amount).map(h => ({ tempat: placeName(h), dipegang_orang: h.kind === 'orang', mata_uang: h.currency, jumlah: h.amount, dalam_rupiah: assetIdr(h.amount, h.currency) })),
            kurs_belum_diisi: t.missingRate
        },
        tukar_terakhir: exchangeState.deals.slice().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, 30)
            .map(d => ({ tanggal: d.date, arah: d.dir === 'beli' ? 'terima valas, kirim rupiah' : 'kasih valas, terima rupiah', orang: d.name || null, mata_uang: d.currency, jumlah: d.qty, rupiah: d.idr, kurs: Math.round(d.idr / d.qty * 100) / 100, untung: dealProfit(d) })),
        untung_tukar_bulan_ini: dealProfitSum(exchangeState.deals.filter(d => d.date.slice(0, 7) === currentMonthKey())),
        titipan_orang: (() => {
            const { byPerson, totals } = depositBalances();
            return { total: totals, dalam_rupiah: t.titipan, per_orang: exchangeState.deposits.people.map(p => ({ nama: p.name, jenis: FX_DEPOSIT_KINDS[p.kind].label, saldo: byPerson[p.id] })) };
        })()
    };
}

// The owner opens straight on the Aset screen. Only on exchange accounts: this file
// is never loaded elsewhere, but stay inert if it ever is.
if (window.DAR_WS && window.DAR_WS.kind === 'exchange') {
    ensureExchangeUI();
    setWorkspaceView('tukar');
}
