// "Tukar" screen for currency-exchange accounts (window.DAR_WS.kind === "exchange"), loaded by
// api/workspace.js after the dashboard script. A money changer sells foreign cash (EGP, USD)
// to customers for rupiah and buys it back / restocks.
//
// Every trade is kept; stock, the average purchase price (modal) and the profit of each sale
// are recomputed from all trades in date order, so editing or deleting one keeps everything
// consistent. Rupiah received or paid moves the chosen saldo account, like spendings do.
const FX_CURRENCIES = (window.DAR_WS && window.DAR_WS.currencies && window.DAR_WS.currencies.length ? window.DAR_WS.currencies : ['EGP', 'USD']);
const FX_NAMES = { EGP: 'Pound Mesir', USD: 'Dollar AS', SAR: 'Riyal Saudi', EUR: 'Euro', MYR: 'Ringgit' };
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
    investor: { label: 'Investor', hint: 'Investasi rupiah' },
    pekerja: { label: 'Pekerja', hint: 'Titip gaji (pound)' },
    lainnya: { label: 'Titipan', hint: 'Titipan lain (mis. dollar)' }
};
const FX_MOVE_TYPES = {
    setor: { label: 'Setor / nitip', short: 'Setor' },
    ambil: { label: 'Ambil uang', short: 'Ambil' },
    kirim: { label: 'Kirim rupiah', short: 'Kirim' }
};
const FX_DEPOSIT_CURRENCIES = ['IDR', ...FX_CURRENCIES];

let exchangeState = (() => {
    try { return normalizeExchange(JSON.parse(localStorage.getItem(FX_LOCAL_KEY) || 'null')); } catch (e) { return normalizeExchange(null); }
})();
let fxMonth = currentMonthKey();
let fxEditId = '';

function normalizeExchange(value) {
    const out = { rates: {}, trades: {}, demo: false, deposits: { people: [], moves: [] } };
    FX_CURRENCIES.forEach(c => {
        const r = value && value.rates && value.rates[c];
        out.rates[c] = { sell: Math.max(0, Number(r && r.sell) || 0), buy: Math.max(0, Number(r && r.buy) || 0) };
    });
    if (!value || typeof value !== 'object') return out;
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

// Foreign cash shown under saldo next to the rupiah accounts; valued at purchase price (modal).
function exchangeCashSummary() {
    const { stock } = computeExchange();
    const held = depositBalances().totals;
    let valueIdr = 0;
    const html = FX_CURRENCIES.map(c => {
        const s = stock[c];
        // Cash in hand = own stock + what people left with him.
        const inHand = Math.round((s.qty + held[c]) * 100) / 100;
        const value = Math.round(Math.max(0, s.qty) * s.avg);
        valueIdr += value;
        return `
        <div class="bank-item-card fx-cash-card">
            <div class="bank-item-top">
                <div class="bank-item-brand">${fxFlag(c, 'fx-flag is-lg')}<span class="bank-tag-primary">Cash ${c}</span></div>
            </div>
            <div class="bank-account-num">Simpanan cash · ${FX_NAMES[c] || c}</div>
            <div class="bank-balance-amount${inHand < 0 ? ' fx-minus' : ''}">${fxQty(inHand)} ${c}</div>
            ${held[c] ? `<div class="fx-cash-split">titipan orang <b>${fxQty(held[c])}</b> · milik sendiri <b class="${s.qty < 0 ? 'fx-minus' : ''}">${fxQty(s.qty)}</b></div>` : ''}
            <div class="fx-cash-value">milik sendiri ≈ ${formatIDR(value)}${s.avg ? ` · modal ${fxRate(Math.round(s.avg * 100) / 100)}` : ''}</div>
            <button type="button" class="bank-copy-btn" onclick="openFxStockDialog('${c}')">Ubah jumlah cash</button>
        </div>`;
    }).join('');
    return { html, valueIdr };
}

function fxDefaultBank() {
    return lastExpenseBank() || (BANK_ACCOUNTS.length === 1 ? BANK_ACCOUNTS[0].key : '');
}

function fxQty(n) {
    return (Number(n) || 0).toLocaleString('id-ID', { maximumFractionDigits: 2 });
}

function fxRate(n) {
    return 'Rp ' + (Number(n) || 0).toLocaleString('id-ID', { maximumFractionDigits: 2 });
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
    const cloudHasData = fxAllTradesOf(cloud).length || cloud.deposits.people.length || Object.values(cloud.rates).some(r => r.sell || r.buy);
    if (cloudHasData || (!fxAllTrades().length && !exchangeState.deposits.people.length)) exchangeState = cloud;
    saveExchangeLocal();
    renderExchangeUI();
}

function fxAllTradesOf(state) {
    return Object.values(state.trades).flat();
}

// After a manual "Update saldo" the typed balances already include every trade so far.
function exchangeOnManualBankUpdate() {
    fxAllTrades().forEach(t => { t.bankDelta = 0; });
    exchangeState.deposits.moves.forEach(m => { m.bankDelta = 0; });
    saveExchangeLocal();
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
        button.dataset.short = 'Tukar';
        button.setAttribute('aria-pressed', 'false');
        button.onclick = () => setWorkspaceView('tukar');
        button.innerHTML = '<span aria-hidden="true"><svg class="nav-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 7h13l-4-4M17 17H4l4 4"/></svg></span> Tukar valas';
        nav.insertBefore(button, nav.firstChild);
        // A money changer has no use for the travel packing list; keeps the phone tab bar to five.
        const pack = nav.querySelector('[data-view="pack"]');
        if (pack) pack.style.setProperty('display', 'none', 'important');
    }

    const section = document.createElement('div');
    section.id = 'exchangeSection';
    section.innerHTML = `
        <div class="fx-demo-banner" id="fxDemoBanner" hidden>
            <div><b>Ini data contoh.</b> Kurs, stok, transaksi, dan saldo SeaBank di bawah cuma ilustrasi biar kebayang cara pakainya.</div>
            <button type="button" class="month-pill-btn" onclick="clearFxDemo()">Hapus data contoh</button>
        </div>
        <div class="fx-pane-tabs" role="tablist" aria-label="Bagian penukaran">
            <button type="button" role="tab" data-fx-pane="trade" onclick="setFxPane('trade')">Jual-beli</button>
            <button type="button" role="tab" data-fx-pane="titipan" onclick="setFxPane('titipan')">Titipan <b id="fxDepositCount"></b></button>
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
            <div class="fx-quick-head"><b>Kurs hari ini</b><span>Ubah kurs di sini, semua hitungan ikut otomatis.</span></div>
            <div class="fx-rate-rows">${FX_CURRENCIES.map(c => `
                <div class="fx-rate-row">
                    <span class="fx-rate-cur">${fxFlag(c, 'fx-flag is-lg')}<b>${c}</b></span>
                    <label>Jual<input type="number" min="0" step="0.01" inputmode="decimal" data-quick-rate="${c}:sell" onchange="saveQuickRate(this)"></label>
                    <label>Beli<input type="number" min="0" step="0.01" inputmode="decimal" data-quick-rate="${c}:buy" onchange="saveQuickRate(this)"></label>
                </div>`).join('')}
            </div>
            <div class="fx-calc">
                <div class="fx-calc-title">Hitung cepat</div>
                <div class="fx-cur-chips" id="fxCalcChips"></div>
                <div class="fx-calc-fields">
                    <label>Rupiah dari pelanggan<input type="text" id="fxCalcIdr" inputmode="numeric" placeholder="Contoh: 842.000" oninput="fxCalc('idr')"></label>
                    <label><span id="fxCalcQtyLabel">Dapat</span><input type="number" id="fxCalcQty" min="0" step="0.01" inputmode="decimal" placeholder="atau isi valasnya" oninput="fxCalc('qty')"></label>
                </div>
                <div class="fx-calc-result" id="fxCalcResult"></div>
                <button type="button" class="create-invoice-btn" id="fxCalcRecordBtn" onclick="fxCalcRecord()" hidden>Catat transaksi ini</button>
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
                    <label class="wide-field" id="fxIdrLabel">Rupiah dari pelanggan<input type="number" id="fxIdr" min="1" step="1" inputmode="numeric" required placeholder="Ketik rupiahnya, valas dihitung otomatis" oninput="fxRecalc('idr')"></label>
                    <label>Jumlah valas<input type="number" id="fxQty" min="0.01" step="0.01" inputmode="decimal" required oninput="fxRecalc('qty')"></label>
                    <label>Kurs (Rp per 1)<input type="number" id="fxRate" min="0.01" step="0.01" inputmode="decimal" required oninput="fxRecalc('rate')"></label>
                    <label>Tanggal<input type="date" id="fxDate" required onchange="renderFxPreview()"></label>
                    <label class="wide-field" id="fxBankLabel">Rupiah masuk ke<select id="fxBank" onchange="renderFxPreview()"></select></label>
                    <label>Nama pelanggan<input type="text" id="fxCustomer" maxlength="80" placeholder="Opsional"></label>
                    <label>Catatan<input type="text" id="fxNote" maxlength="160" placeholder="Opsional"></label>
                </div>
                <div class="fx-preview" id="fxPreview"></div>
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
    return exchangeState.demo || fxAllTrades().some(t => t.demo) || exchangeState.deposits.people.some(p => p.demo);
}

// Remove the sample data from api/_seeds.js: sample trades, sample kurs and the sample SeaBank
// balance. Trades the owner added stay.
function clearFxDemo() {
    if (!confirm('Hapus semua data contoh (transaksi, titipan, kurs, stok, dan saldo SeaBank contoh)? Yang kamu catat sendiri tetap ada.')) return;
    const demoPeople = new Set(exchangeState.deposits.people.filter(p => p.demo).map(p => p.id));
    exchangeState.deposits.moves.filter(m => m.demo || demoPeople.has(m.personId)).forEach(m => removeDepositMove(m, false));
    exchangeState.deposits.people = exchangeState.deposits.people.filter(p => !demoPeople.has(p.id));
    Object.keys(exchangeState.trades).forEach(month => {
        exchangeState.trades[month] = exchangeState.trades[month].filter(t => !t.demo);
        if (!exchangeState.trades[month].length) delete exchangeState.trades[month];
    });
    if (exchangeState.demo) {
        FX_CURRENCIES.forEach(c => { exchangeState.rates[c] = { sell: 0, buy: 0 }; });
        bankBalances.seabank = 0;
        bankBalancesUpdatedAt = '';
    }
    exchangeState.demo = false;
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
    document.getElementById('fxDepositPane').hidden = fxPane !== 'titipan';
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

// ---------- Kurs hari ini + hitung cepat ----------
let fxCalcCur = FX_CURRENCIES[0];
let fxCalcSource = 'idr';

function renderFxQuick() {
    document.querySelectorAll('[data-quick-rate]').forEach(input => {
        if (input === document.activeElement) return;
        const [c, field] = input.dataset.quickRate.split(':');
        const value = (exchangeState.rates[c] || {})[field];
        input.value = value || '';
        input.placeholder = field === 'sell' ? 'kurs jual' : 'kurs beli';
    });
    document.getElementById('fxCalcChips').innerHTML = FX_CURRENCIES.map(c => `
        <button type="button" class="${c === fxCalcCur ? 'active' : ''}" aria-pressed="${c === fxCalcCur}" onclick="setFxCalcCur('${c}')">${fxFlag(c, 'fx-flag is-lg')}<span>${c}</span></button>`).join('');
    document.getElementById('fxCalcQtyLabel').textContent = `Dapat ${fxCalcCur}`;
    fxCalc(fxCalcSource, true);
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

function setFxCalcCur(c) {
    fxCalcCur = c;
    renderFxQuick();
}

function fxDigits(text) {
    return Math.round(Number(String(text || '').replace(/[^0-9]/g, '')) || 0);
}

// Type rupiah (or the foreign amount) and get the other side at today's kurs jual. Money
// changers hand out whole notes, so it also shows the whole amount and the change to return.
function fxCalc(source, quiet = false) {
    fxCalcSource = source;
    const idrEl = document.getElementById('fxCalcIdr');
    const qtyEl = document.getElementById('fxCalcQty');
    const out = document.getElementById('fxCalcResult');
    const btn = document.getElementById('fxCalcRecordBtn');
    const rate = (exchangeState.rates[fxCalcCur] || {}).sell || 0;
    let idr = fxDigits(idrEl.value);
    let qty = Number(qtyEl.value) || 0;
    if (source === 'idr' && !quiet && idrEl.value) {
        // Show the typed rupiah with thousand dots while typing.
        const caretAtEnd = idrEl.selectionStart === idrEl.value.length;
        idrEl.value = idr ? idr.toLocaleString('id-ID') : '';
        if (caretAtEnd) idrEl.setSelectionRange(idrEl.value.length, idrEl.value.length);
    }
    if (!rate) {
        out.innerHTML = `Isi <b>kurs jual ${fxCalcCur}</b> di atas dulu.`;
        btn.hidden = true;
        return;
    }
    if (source === 'idr') {
        qty = idr ? Math.round(idr / rate * 100) / 100 : 0;
        qtyEl.value = qty || '';
    } else {
        idr = qty ? Math.round(qty * rate) : 0;
        idrEl.value = idr ? idr.toLocaleString('id-ID') : '';
    }
    if (!idr || !qty) {
        out.innerHTML = `Kurs jual ${fxFlag(fxCalcCur)} ${fxRate(rate)} / ${fxCalcCur}`;
        btn.hidden = true;
        return;
    }
    const s = computeExchange().stock[fxCalcCur];
    const lines = [`<div class="fx-calc-big">${formatIDR(idr)} → <b>${fxQty(qty)} ${fxCalcCur}</b></div>`, `<div>kurs ${fxRate(rate)}${s.avg ? ` · untung ≈ <b>${formatIDR(Math.round(idr - qty * s.avg))}</b>` : ''}</div>`];
    const whole = Math.floor(qty);
    if (source === 'idr' && whole > 0 && whole !== qty) {
        lines.push(`<div>Uang pas: kasih <b>${fxQty(whole)} ${fxCalcCur}</b>, kembalikan <b>${formatIDR(idr - Math.round(whole * rate))}</b></div>`);
    }
    out.innerHTML = lines.join('');
    btn.hidden = false;
}

function fxCalcRecord() {
    const idr = fxDigits(document.getElementById('fxCalcIdr').value);
    const qty = Number(document.getElementById('fxCalcQty').value) || 0;
    if (!idr || !qty) return;
    openFxDialog('jual');
    document.getElementById('fxCurrency').value = fxCalcCur;
    onFxCurrencyChange();
    document.getElementById('fxIdr').value = idr;
    document.getElementById('fxQty').value = qty;
    fxLastEdited = 'idr';
    renderFxPreview();
    setTimeout(() => document.getElementById('fxCustomer').focus(), 40);
}

// ---------- Trade dialog ----------
let fxType = 'jual';
let fxLastEdited = 'qty';

function setFxType(type) {
    fxType = type;
    document.querySelectorAll('[data-fx-type]').forEach(b => b.classList.toggle('active', b.dataset.fxType === type));
    document.getElementById('fxBankLabel').firstChild.textContent = type === 'jual' ? 'Rupiah masuk ke' : 'Rupiah keluar dari';
    document.getElementById('fxIdrLabel').firstChild.textContent = type === 'jual' ? 'Rupiah dari pelanggan' : 'Rupiah yang dibayar';
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
    if (field !== 'rate') fxLastEdited = field;
    const qtyEl = document.getElementById('fxQty');
    const rateEl = document.getElementById('fxRate');
    const idrEl = document.getElementById('fxIdr');
    const rate = Number(rateEl.value) || 0;
    if (fxLastEdited === 'idr') {
        if (rate) qtyEl.value = Math.round((Number(idrEl.value) || 0) / rate * 100) / 100 || '';
    } else if (rate && qtyEl.value) {
        idrEl.value = Math.round((Number(qtyEl.value) || 0) * rate) || '';
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
        lines.push(s.avg ? `Untung <b class="${profit < 0 ? 'is-minus' : ''}">${formatIDR(profit)}</b> (modal ${fxRate(Math.round(s.avg * 100) / 100)} × ${fxQty(qty)})` : 'Modal belum diketahui: isi stok lewat <b>Beli / restok</b> atau <b>Koreksi stok</b> dulu.');
        lines.push(`Stok ${c}: ${fxQty(s.qty)} → <b class="${s.qty - qty < 0 ? 'is-minus' : ''}">${fxQty(s.qty - qty)}</b>`);
        const held = depositBalances().totals[c];
        if (s.qty - qty < 0 && held > 0) lines.push(`<b class="is-minus">Melebihi stok milikmu ${fxQty(Math.min(held, qty - Math.max(0, s.qty)))} ${c}: ini pakai uang titipan orang.</b>`);
    } else if (fxType === 'beli' && qty) {
        const newQty = Math.max(0, s.qty) + qty;
        const newAvg = (Math.max(0, s.qty) * s.avg + idr) / newQty;
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
    fxLastEdited = trade ? 'qty' : 'idr';
    setFxType(trade ? trade.type : (type || 'jual'));
    document.getElementById('fxDialog').showModal();
    if (!trade) setTimeout(() => document.getElementById('fxIdr').focus(), 30);
}

function handleFxSubmit(event) {
    event.preventDefault();
    const error = document.getElementById('fxError');
    const c = document.getElementById('fxCurrency').value;
    const qty = Math.round((Number(document.getElementById('fxQty').value) || 0) * 100) / 100;
    const rate = Number(document.getElementById('fxRate').value) || 0;
    const idr = Math.round(Number(document.getElementById('fxIdr').value) || 0);
    const date = document.getElementById('fxDate').value;
    if (qty <= 0 || rate <= 0 || idr <= 0 || !date) { error.textContent = 'Isi jumlah valas, kurs, dan total rupiah.'; return; }
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
let fxPane = 'trade';
let fxMoveType = 'setor';
let fxMoveLast = 'amount';
let fxHistoryPerson = '';
let fxPersonEditId = '';

function setFxPane(pane) {
    fxPane = pane === 'titipan' ? 'titipan' : 'trade';
    renderExchangeUI();
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
    const order = { investor: 0, pekerja: 1, lainnya: 2 };
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
                <span class="log-row-pos">${escapeHTML(formatShortDate(m.date))}${m.type === 'kirim' ? ` · dikirim ${formatIDR(m.idr)} (kurs ${fxRate(m.rate)})` : ''}${m.bankKey ? ' · ' + escapeHTML(bankNameOf(m.bankKey)) : ''}${m.note ? ' · ' + escapeHTML(m.note) : ''}</span>
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
    const { stock, result } = computeExchange();
    const month = currentMonthKey();
    const sales = (exchangeState.trades[month] || []).filter(t => t.type === 'jual');
    return {
        kurs: exchangeState.rates,
        stok: Object.fromEntries(FX_CURRENCIES.map(c => [c, { jumlah: Math.round(stock[c].qty * 100) / 100, modal_rata_rata: Math.round(stock[c].avg * 100) / 100 }])),
        titipan_orang: (() => {
            const { byPerson, totals } = depositBalances();
            return { total: totals, per_orang: exchangeState.deposits.people.map(p => ({ nama: p.name, jenis: FX_DEPOSIT_KINDS[p.kind].label, saldo: byPerson[p.id] })) };
        })(),
        bulan_ini: { transaksi_jual: sales.length, rupiah_masuk: sales.reduce((s, t) => s + t.idr, 0), untung: sales.reduce((s, t) => s + ((result[t.id] || {}).profit || 0), 0) },
        transaksi_terakhir: fxAllTrades().slice().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, 20)
            .map(t => ({ tanggal: t.date, jenis: t.type, valas: t.currency, jumlah: t.qty, kurs: t.rate, rupiah: t.idr, pelanggan: t.customer || null, untung: (result[t.id] || {}).profit || 0 }))
    };
}

// The money changer opens straight on the Tukar screen. Only on exchange accounts: this file
// is never loaded elsewhere, but stay inert if it ever is.
if (window.DAR_WS && window.DAR_WS.kind === 'exchange') {
    ensureExchangeUI();
    setWorkspaceView('tukar');
}
