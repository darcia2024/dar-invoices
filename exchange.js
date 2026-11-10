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

let exchangeState = (() => {
    try { return normalizeExchange(JSON.parse(localStorage.getItem(FX_LOCAL_KEY) || 'null')); } catch (e) { return normalizeExchange(null); }
})();
let fxMonth = currentMonthKey();
let fxEditId = '';

function normalizeExchange(value) {
    const out = { rates: {}, trades: {}, demo: false };
    if (!value || typeof value !== 'object') return out;
    out.demo = value.demo === true;
    FX_CURRENCIES.forEach(c => {
        const r = value.rates && value.rates[c];
        out.rates[c] = { sell: Math.max(0, Number(r && r.sell) || 0), buy: Math.max(0, Number(r && r.buy) || 0) };
    });
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
                demo: t.demo === true,
                createdAt: Number(t.createdAt) || Date.now()
            }));
    });
    return out;
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
    let valueIdr = 0;
    const html = FX_CURRENCIES.map(c => {
        const s = stock[c];
        const value = Math.round(Math.max(0, s.qty) * s.avg);
        valueIdr += value;
        return `
        <div class="bank-item-card fx-cash-card">
            <div class="bank-item-top">
                <div class="bank-item-brand">${fxFlag(c, 'fx-flag is-lg')}<span class="bank-tag-primary">Cash ${c}</span></div>
            </div>
            <div class="bank-account-num">Simpanan cash · ${FX_NAMES[c] || c}</div>
            <div class="bank-balance-amount${s.qty < 0 ? ' fx-minus' : ''}">${fxQty(s.qty)} ${c}</div>
            <div class="fx-cash-value">≈ ${formatIDR(value)}${s.avg ? ` · modal ${fxRate(Math.round(s.avg * 100) / 100)}` : ''}</div>
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
    const cloudHasData = fxAllTradesOf(cloud).length || Object.values(cloud.rates).some(r => r.sell || r.buy);
    if (cloudHasData || !fxAllTrades().length) exchangeState = cloud;
    saveExchangeLocal();
    renderExchangeUI();
}

function fxAllTradesOf(state) {
    return Object.values(state.trades).flat();
}

// After a manual "Update saldo" the typed balances already include every trade so far.
function exchangeOnManualBankUpdate() {
    fxAllTrades().forEach(t => { t.bankDelta = 0; });
    saveExchangeLocal();
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
        <div id="fxList"></div>`;
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
                    <label>Mata uang<select id="fxCurrency" onchange="onFxCurrencyChange()">${FX_CURRENCIES.map(c => `<option value="${c}">${c} · ${FX_NAMES[c] || c}</option>`).join('')}</select></label>
                    <label>Tanggal<input type="date" id="fxDate" required onchange="renderFxPreview()"></label>
                    <label>Jumlah valas<input type="number" id="fxQty" min="0.01" step="0.01" inputmode="decimal" required oninput="fxRecalc('qty')"></label>
                    <label>Kurs (Rp per 1)<input type="number" id="fxRate" min="0.01" step="0.01" inputmode="decimal" required oninput="fxRecalc('rate')"></label>
                    <label class="wide-field">Total rupiah<input type="number" id="fxIdr" min="1" step="1" inputmode="numeric" required oninput="fxRecalc('idr')"></label>
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
}

function shiftFxMonth(delta) {
    const [y, m] = fxMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    fxMonth = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    renderExchangeUI();
}

function fxHasDemo() {
    return exchangeState.demo || fxAllTrades().some(t => t.demo);
}

// Remove the sample data from api/_seeds.js: sample trades, sample kurs and the sample SeaBank
// balance. Trades the owner added stay.
function clearFxDemo() {
    if (!confirm('Hapus semua data contoh (transaksi, kurs, stok, dan saldo SeaBank contoh)? Transaksi yang kamu catat sendiri tetap ada.')) return;
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
    const { stock, result } = computeExchange();
    document.getElementById('fxCards').innerHTML = FX_CURRENCIES.map(c => {
        const s = stock[c];
        const rate = exchangeState.rates[c] || { sell: 0, buy: 0 };
        const margin = rate.sell && s.avg ? rate.sell - s.avg : 0;
        return `
        <div class="fx-card">
            <div class="fx-card-head">${fxFlag(c, 'fx-flag is-lg')}<b>${c}</b><span>${FX_NAMES[c] || ''}</span></div>
            <div class="fx-stock-label">Simpanan cash</div>
            <div class="fx-stock${s.qty < 0 ? ' is-minus' : ''}">${fxQty(s.qty)} <small>${c}</small></div>
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

// ---------- Trade dialog ----------
let fxType = 'jual';
let fxLastEdited = 'qty';

function setFxType(type) {
    fxType = type;
    document.querySelectorAll('[data-fx-type]').forEach(b => b.classList.toggle('active', b.dataset.fxType === type));
    document.getElementById('fxBankLabel').firstChild.textContent = type === 'jual' ? 'Rupiah masuk ke' : 'Rupiah keluar dari';
    if (!fxEditId) onFxCurrencyChange();
    renderFxPreview();
}

function onFxCurrencyChange() {
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
        document.getElementById('fxQty').value = trade.qty;
        document.getElementById('fxRate').value = trade.rate;
        document.getElementById('fxIdr').value = trade.idr;
        document.getElementById('fxCustomer').value = trade.customer;
        document.getElementById('fxNote').value = trade.note;
    }
    fxLastEdited = 'qty';
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

// ---------- Assistant ----------
function exchangeAssistantContext() {
    const { stock, result } = computeExchange();
    const month = currentMonthKey();
    const sales = (exchangeState.trades[month] || []).filter(t => t.type === 'jual');
    return {
        kurs: exchangeState.rates,
        stok: Object.fromEntries(FX_CURRENCIES.map(c => [c, { jumlah: Math.round(stock[c].qty * 100) / 100, modal_rata_rata: Math.round(stock[c].avg * 100) / 100 }])),
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
