let customInvoices = [];
let deletedInvoiceIds = [];
let invoiceSyncMessage = '';
let invoiceMetadataPending = false;

function setInvoiceSyncStatus(message) {
    invoiceSyncMessage = message;
    document.querySelectorAll('.invoice-sync-state').forEach(element => { element.textContent = message; });
}

function escapeInvoiceText(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
}

function saveInvoiceMetadata() {
    localStorage.setItem('dar-invoice-metadata', JSON.stringify({customInvoices, deletedInvoiceIds, pending:invoiceMetadataPending}));
}

function applyInvoiceMetadata(state) {
    if (!invoiceMetadataPending && Array.isArray(state.customInvoices)) customInvoices = state.customInvoices;
    if (!invoiceMetadataPending && Array.isArray(state.deletedInvoiceIds)) deletedInvoiceIds = state.deletedInvoiceIds;
    syncCustomInvoices();
}

function syncCustomInvoices() {
    for (let index = invoiceItems.length - 1; index >= 0; index--) {
        if (invoiceItems[index].custom && !customInvoices.some(item => item.id === invoiceItems[index].id)) {
            document.getElementById('card-' + invoiceItems[index].id)?.remove();
            invoiceItems.splice(index, 1);
        }
    }
    customInvoices.forEach(item => {
        const existing = invoiceItems.find(candidate => candidate.id === item.id);
        if (existing) Object.assign(existing, item, {custom:true});
        else invoiceItems.push({...item, custom:true});
        if (!(item.id in paymentStatuses)) paymentStatuses[item.id] = getStoredText('status_' + item.id, item.deposit >= item.gross ? 'PAID' : item.deposit > 0 ? 'DP' : 'UNPAID');
        if (!(item.id in dpAmounts)) dpAmounts[item.id] = getStoredNumber('dp_' + item.id, item.deposit || 0);
        if (!(item.id in netProfits)) netProfits[item.id] = getStoredNumber('profit_' + item.id, item.gross);
        if (!document.getElementById('card-' + item.id)) createCustomInvoiceCard(item);
        if (![...document.querySelectorAll('.month-pill-btn[data-filter]')].some(button => button.dataset.filter === item.month)) {
            const button = document.createElement('button');
            button.className = 'month-pill-btn';
            button.dataset.filter = item.month;
            button.textContent = item.monthLabel;
            button.onclick = () => setMonthFilter(item.month, button);
            document.querySelector('.month-pills-group').appendChild(button);
        }
    });
}

function createCustomInvoiceCard(item) {
    const card = document.createElement('div');
    card.id = 'card-' + item.id;
    card.className = 'invoice-card';
    card.dataset.id = item.id;
    card.dataset.month = item.month;
    card.dataset.client = [item.name, item.description, item.reference].join(' ').toLowerCase();
    card.dataset.amount = item.gross;
    const targetId = item.id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const cap = targetId.charAt(0).toUpperCase() + targetId.slice(1);
    card.innerHTML = `<div><div class="card-top"><div class="client-title">${escapeInvoiceText(item.name)}</div><div class="status-badge-group"><span class="payment-status-pill"></span></div></div><div class="ref-code">${escapeInvoiceText(item.reference)}<span class="month-tag">${escapeInvoiceText(item.monthLabel)}</span></div><p class="project-desc">${escapeInvoiceText(item.description)}</p><div class="financial-breakdown-box"><div class="fin-row"><span class="fin-label">TOTAL INVOICE</span><span class="fin-val">${formatIDR(item.gross)}</span></div><div class="fin-row"><span class="fin-label">BIAYA OPERASIONAL</span><span class="fin-val" id="costVal${cap}"></span></div><div class="fin-row"><span class="fin-label">PROFIT</span><span class="net-profit-val" id="profitVal${cap}"></span></div><button class="edit-profit-btn">Edit profit</button></div></div><button class="action-btn">Buka invoice / Cetak PDF</button>`;
    card.querySelector('.payment-status-pill').onclick = () => togglePaymentStatus(item.id);
    card.querySelector('.edit-profit-btn').onclick = () => openProfitModal(item.id);
    card.querySelector('.action-btn').onclick = () => openGeneratedInvoice(item.id);
    document.getElementById('invoiceGrid').appendChild(card);
}

function refreshInvoiceControls() {
    document.querySelectorAll('.invoice-card').forEach(card => {
        if (deletedInvoiceIds.includes(card.dataset.id)) card.style.display = 'none';
        if (!card.querySelector('.delete-invoice-btn')) {
            const button = document.createElement('button');
            button.className = 'delete-invoice-btn';
            button.textContent = 'Hapus invoice';
            button.onclick = () => confirmDeleteInvoice(card.dataset.id);
            card.appendChild(button);
        }
    });
    document.getElementById('trashCount').textContent = deletedInvoiceIds.length;
}

function managerDialog(title) {
    let dialog = document.getElementById('invoiceManagerDialog');
    if (!dialog) {
        dialog = document.createElement('dialog');
        dialog.id = 'invoiceManagerDialog';
        dialog.className = 'invoice-manager-dialog';
        document.body.appendChild(dialog);
    }
    dialog.innerHTML = '<div class="manager-heading"><h2 id="managerTitle"></h2><button type="button" aria-label="Tutup">×</button></div><p class="invoice-sync-state" role="status"></p><div class="manager-content"></div>';
    setInvoiceSyncStatus(invoiceSyncMessage);
    dialog.setAttribute('aria-labelledby','managerTitle');
    dialog.querySelector('h2').textContent = title;
    dialog.querySelector('.manager-heading button').onclick = () => dialog.close();
    if (!dialog.open) dialog.showModal();
    return dialog.querySelector('.manager-content');
}

function confirmDeleteInvoice(id) {
    const item = invoiceItems.find(candidate => candidate.id === id);
    if (!item) return;
    const content = managerDialog('Hapus invoice?');
    const description = document.createElement('p');
    description.textContent = `Invoice ${item.name} akan dipindahkan ke Sampah dan tidak dihitung dalam laporan. Bisa dipulihkan kapan saja. Halaman invoice lama yang sudah dibagikan tetap tersedia.`;
    content.appendChild(description);
    const button = document.createElement('button');
    button.className = 'create-invoice-btn';
    button.textContent = 'Pindahkan ke Sampah';
    button.onclick = () => {
        if (!deletedInvoiceIds.includes(id)) deletedInvoiceIds.push(id);
        invoiceMetadataPending = true;
        document.getElementById('invoiceManagerDialog').close();
        filterInvoices();
        persistBillingState();
    };
    content.appendChild(button);
}

function openInvoiceTrash() {
    const content = managerDialog('Sampah invoice');
    if (!deletedInvoiceIds.length) content.textContent = 'Belum ada invoice di Sampah.';
    deletedInvoiceIds.forEach(id => {
        const row = document.createElement('div');
        row.className = 'trash-row';
        const name = document.createElement('span');
        name.textContent = invoiceItems.find(item => item.id === id)?.name || id;
        const button = document.createElement('button');
        button.className = 'month-pill-btn';
        button.textContent = 'Pulihkan';
        button.onclick = () => {
            deletedInvoiceIds = deletedInvoiceIds.filter(deleted => deleted !== id);
            invoiceMetadataPending = true;
            filterInvoices();
            persistBillingState();
            openInvoiceTrash();
        };
        row.append(name, button);
        content.appendChild(row);
    });
}

function openInvoiceComposer() {
    const content = managerDialog('Buat invoice');
    content.innerHTML = `<p>Tulis ringkasan, lalu periksa draft sebelum menyimpan. Nominal dibaca dalam rupiah.</p><label for="invoiceBrief">Ringkasan invoice</label><textarea id="invoiceBrief" rows="3" placeholder="Invoice Budi, desain logo 2 juta, DP 500 ribu"></textarea><button type="button" class="month-pill-btn" id="parseInvoiceBrief">Susun draft dari teks</button><p class="draft-hint" id="draftHint" role="status">Bisa juga isi form langsung. Teks dibaca dengan pola sederhana, bukan AI.</p><form id="invoiceDraftForm"><div class="draft-fields"><label>Nama klien<input name="client" required maxlength="160"></label><label>Nomor invoice<input name="reference" required maxlength="80"></label><label class="wide-field">Layanan / rincian pekerjaan<textarea name="description" required maxlength="5000" rows="3"></textarea></label><label>Total (Rp)<input name="gross" type="number" min="1" max="1000000000000" step="1" required></label><label>Sudah dibayar / DP (Rp)<input name="deposit" type="number" min="0" step="1" value="0" required></label><label>Tanggal invoice<input name="date" type="date" required></label><label>Jatuh tempo (opsional)<input name="due" type="date"></label></div><p id="draftError" class="draft-error" role="alert"></p><button class="create-invoice-btn" type="submit">Simpan invoice</button></form>`;
    const today = new Date();
    const date = [today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-');
    const form = document.getElementById('invoiceDraftForm');
    form.elements.date.value = date;
    form.elements.reference.value = 'INV/' + date.replaceAll('-','') + '/' + crypto.randomUUID().slice(0,6).toUpperCase();
    document.getElementById('parseInvoiceBrief').onclick = () => {
        const parsed = parseInvoiceBrief(document.getElementById('invoiceBrief').value);
        if (parsed.name) form.elements.client.value = parsed.name;
        if (parsed.description) form.elements.description.value = parsed.description;
        if (parsed.gross !== null) form.elements.gross.value = parsed.gross;
        form.elements.deposit.value = parsed.deposit;
        document.getElementById('draftHint').textContent = 'Draft terisi dari bagian teks yang dikenali. Periksa nama, rincian, harga, DP, dan tanggal; lengkapi bagian yang kosong.';
    };
    form.onsubmit = event => {
        event.preventDefault();
        const fields = form.elements;
        const gross = Number(fields.gross.value);
        const deposit = Number(fields.deposit.value);
        if (!fields.client.value.trim() || !fields.description.value.trim() || !fields.reference.value.trim() || !Number.isSafeInteger(gross) || gross <= 0 || !Number.isSafeInteger(deposit) || deposit < 0 || deposit > gross || (fields.due.value && fields.due.value < fields.date.value)) {
            document.getElementById('draftError').textContent = 'Lengkapi rincian. DP tidak boleh melebihi total dan jatuh tempo tidak boleh sebelum tanggal invoice.';
            return;
        }
        const item = {id:'custom-' + crypto.randomUUID(), custom:true, name:fields.client.value.trim(), reference:fields.reference.value.trim(), description:fields.description.value.trim(), gross, deposit, date:fields.date.value, due:fields.due.value, month:fields.date.value.slice(0,7), monthLabel:new Date(fields.date.value + 'T12:00:00').toLocaleDateString('id-ID',{month:'long',year:'numeric'})};
        customInvoices.push(item);
        invoiceMetadataPending = true;
        syncCustomInvoices();
        updatePaymentBadges();
        renderProfitUI();
        document.getElementById('searchInput').value = '';
        setMonthFilter('all', document.querySelector('[data-filter="all"]'));
        setWorkspaceView('board');
        document.getElementById('invoiceManagerDialog').close();
        persistBillingState();
        openGeneratedInvoice(item.id);
    };
}

function parseInvoiceBrief(text) {
    const amountPattern = /(?:rp\.?\s*)?(\d+(?:[.,]\d+)*)\s*(juta|jt|ribu|rb|k)?/i;
    const money = match => {
        if (!match) return null;
        const multiplier = /^(juta|jt)$/i.test(match[2] || '') ? 1000000 : /^(ribu|rb|k)$/i.test(match[2] || '') ? 1000 : 1;
        const number = multiplier > 1 ? Number(match[1].replace(',','.')) : Number(match[1].replace(/[.,]/g,''));
        return Math.round(number * multiplier);
    };
    const chunks = text.trim().replace(/(\d),(\d)/g, '$1.$2').split(/[,;\n]+\s*/);
    const name = (chunks.shift() || '').replace(/^(?:buat(?:kan)?\s+)?invoice\s*(?:untuk\s+)?/i,'').trim();
    const rest = chunks.join(', ');
    const dpMatch = rest.match(new RegExp('(?:DP|uang muka|sudah dibayar)\\s*[:=]?\\s*' + amountPattern.source,'i'));
    const service = rest.replace(/(?:DP|uang muka|sudah dibayar)[\s\S]*$/i,'').replace(/[,\s]+$/,'');
    const totalMatches = [...service.matchAll(new RegExp(amountPattern.source, 'gi'))];
    const totalMatch = totalMatches.findLast(match => match[2] || /^rp/i.test(match[0])) || (totalMatches.length === 1 ? totalMatches[0] : null);
    const description = totalMatch ? service.slice(0,totalMatch.index) + service.slice(totalMatch.index + totalMatch[0].length) : service;
    return {name, description:description.replace(/[,\s]+$/,'').trim(), gross:money(totalMatch), deposit:money(dpMatch) || 0};
}

function openGeneratedInvoice(id) {
    const item = customInvoices.find(candidate => candidate.id === id);
    if (!item) return;
    const paid = paymentStatuses[id] === 'PAID' ? item.gross : paymentStatuses[id] === 'DP' ? (dpAmounts[id] || 0) : 0;
    const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeInvoiceText(item.reference)}</title><style>body{font:15px/1.7 Arial,sans-serif;color:#282820;background:#f2eee2;margin:0;padding:32px}main{max-width:760px;margin:auto;background:#fffdf6;padding:40px;border-radius:16px}header{display:flex;justify-content:space-between;gap:24px;border-bottom:1px solid #ddd4c0;padding-bottom:24px}h1{font-size:32px;margin:0}h2{font-size:20px}p{white-space:pre-wrap;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;margin:32px 0}td,th{padding:14px 0;border-bottom:1px solid #ddd4c0;text-align:left}td:last-child,th:last-child{text-align:right}button{padding:12px 18px;border:0;background:#282820;color:white;border-radius:8px;cursor:pointer}footer{border-top:1px solid #ddd4c0;margin-top:32px;padding-top:20px}@media(max-width:600px){body{padding:12px}main{padding:20px}header{display:block}}@media print{body{background:white;padding:0}main{padding:15px}button{display:none}}</style></head><body><main><header><div><h1>Invoice</h1><p>${escapeInvoiceText(item.reference)}</p></div><div><strong>DAR Invoices</strong><br>Daru Fahmaa Muliawan</div></header><h2>Kepada ${escapeInvoiceText(item.name)}</h2><p>Tanggal: ${escapeInvoiceText(item.date)}${item.due ? '\nJatuh tempo: ' + escapeInvoiceText(item.due) : ''}</p><p>${escapeInvoiceText(item.description)}</p><table><tr><th>Rincian pembayaran</th><th>Rupiah</th></tr><tr><td>Total invoice</td><td>${formatIDR(item.gross)}</td></tr><tr><td>Sudah dibayar</td><td>${formatIDR(paid)}</td></tr><tr><th>Sisa pembayaran</th><th>${formatIDR(item.gross-paid)}</th></tr></table><footer><strong>Pembayaran Bank Mandiri</strong><br>1550010616962 · Daru Fahmaa Muliawan<br>WhatsApp: 081311506025</footer><p><button onclick="window.print()">Cetak / Simpan PDF</button></p></main></body></html>`;
    const content = managerDialog('Invoice siap');
    content.innerHTML = '<p>Periksa dokumen di bawah. Unduh HTML untuk menyimpan dokumen, atau buka dokumen lalu pilih Cetak / Simpan PDF. Dokumen unduhan dapat dibagikan; alamat preview hanya berlaku di browser ini.</p><div class="document-actions"></div><iframe title="Preview invoice" class="invoice-preview"></iframe>';
    content.querySelector('iframe').setAttribute('sandbox','');
    content.querySelector('iframe').srcdoc = html.replace('<p><button onclick="window.print()">Cetak / Simpan PDF</button></p>', '');
    const url = URL.createObjectURL(new Blob([html], {type:'text/html'}));
    const open = document.createElement('a');
    open.className = 'create-invoice-btn';
    open.href = url;
    open.target = '_blank';
    open.rel = 'noopener';
    open.textContent = 'Buka dokumen / Cetak PDF';
    const download = document.createElement('a');
    download.className = 'month-pill-btn';
    download.href = url;
    download.download = item.reference.replace(/[^a-z0-9-]/gi,'-') + '.html';
    download.textContent = 'Unduh HTML';
    content.querySelector('.document-actions').append(open, download);
}

function initializeInvoiceManager() {
    try {
        const saved = JSON.parse(localStorage.getItem('dar-invoice-metadata') || '{}');
        applyInvoiceMetadata(saved);
        invoiceMetadataPending = saved.pending === true;
        if (invoiceMetadataPending) setInvoiceSyncStatus('Ada perubahan lokal yang belum tersinkron. Tekan Sinkronkan saat koneksi tersedia.');
    } catch (error) {
        console.warn('Invoice metadata could not be loaded', error);
        showToast('Data invoice lokal gagal dibaca. Coba muat ulang.');
    }
}

if (typeof module !== 'undefined') module.exports = {parseInvoiceBrief, escapeInvoiceText};
