// Penawaran (khusus DAR, dimuat di /dar saja): lacak tiap penawaran dari diracik sampai beres.
// Data ikut billing-state (kunci "offers"), jadi tersimpan di database DAR bersama invoice.
// Penawaran yang sudah deal bisa langsung jadi draft invoice lewat form "Buat invoice".
(function () {
    const STAGES = [
        ['disiapkan', 'Lagi diracik', '#8a857a'], ['terkirim', 'Udah dikirim', '#2f5fa7'], ['followup', 'Lagi dikejar', '#c4552f'],
        ['nego', 'Tawar-menawar', '#7a4fb0'], ['deal', 'Deal!', '#2c7a45'], ['dikerjakan', 'Lagi digarap', '#252520'],
        ['selesai', 'Beres', '#8a857a'], ['batal', 'Belum jodoh', '#b23b2a']
    ];
    const ST = Object.fromEntries(STAGES.map(([id, n, c], i) => [id, { n, c, i }]));
    const AKTIF = ['disiapkan', 'terkirim', 'followup', 'nego', 'deal', 'dikerjakan'];
    const DEALISH = ['deal', 'dikerjakan', 'selesai'];
    const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const ROT = [-1.4, 1, -0.5, 1.3, -1.1, 0.6, -0.3, 1.2, -0.8];
    const PAPER = { Sistem: '#fffdf5', Website: '#fbf3e2', Video: '#f0f2e6', Lainnya: '#f8eee7' };
    const LS = 'dar-offers';

    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    const tgl = s => { if (!s) return ''; const [y, m, d] = s.split('-').map(Number); return d + ' ' + BULAN[m - 1] + (y !== new Date().getFullYear() ? ' ' + y : ''); };
    const rp = n => 'Rp ' + Math.round(n).toLocaleString('id-ID');
    const jt = n => (n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 });
    const rpShort = n => n >= 1e6 ? 'Rp ' + jt(n) + ' jt' : n >= 1e3 ? 'Rp ' + Math.round(n / 1e3) + ' rb' : rp(n);
    const rentang = (a, b) => a >= 1e6 ? 'Rp ' + jt(a) + '–' + jt(b) + ' jt' : rpShort(a) + ' – ' + rpShort(b);
    const num = s => +String(s || '').replace(/\D/g, '') || 0;
    const pad = n => String(n).padStart(2, '0');
    const toast = m => (typeof showToast === 'function' ? showToast(m) : null);

    const normalize = o => ({
        id: String(o.id || ''), klien: String(o.klien || ''), kategori: o.kategori || 'Sistem', layanan: o.layanan || '', harga: o.harga || '',
        paket: Array.isArray(o.paket) ? o.paket.filter(x => x && x.n && +x.h > 0).map(x => ({ n: String(x.n), h: +x.h })) : [],
        deal: o.deal || '', nilai: +o.nilai || 0, tahap: ST[o.tahap] ? o.tahap : 'disiapkan', followUp: o.followUp || '', dibuat: o.dibuat || '',
        kontak: o.kontak || '', link: o.link || '', catatan: o.catatan || '', invoiceId: o.invoiceId || '',
        riwayat: Array.isArray(o.riwayat) ? o.riwayat.filter(h => h && ST[h.tahap]) : [], diubah: o.diubah || ''
    });

    // null = belum dimuat: penyimpanan bagian lain tidak boleh mengosongkan daftar penawaran.
    let offers = null;
    try { const saved = JSON.parse(localStorage.getItem(LS)); if (Array.isArray(saved)) offers = saved.map(normalize); } catch (e) { /* biarkan kosong */ }
    const saveLocal = () => { try { localStorage.setItem(LS, JSON.stringify(offers || [])); } catch (e) { /* penyimpanan perangkat penuh */ } };

    window.applyOffersState = list => {
        offers = list.map(normalize);
        saveLocal();
        if (document.body.dataset.view === 'offer') render();
    };
    window.offersForSave = () => offers || undefined;
    const save = () => { saveLocal(); render(); if (typeof persistBillingState === 'function') persistBillingState(); };

    let dealt = false, filter = 'semua', editId = null, pkDraft = [], dealSel = '', pendingOfferId = null, bump = null;

    function fuState(o) {
        if (!o.followUp || !AKTIF.includes(o.tahap)) return '';
        const t = today(); return o.followUp < t ? 'late' : o.followUp === t ? 'today' : '';
    }
    function invoiceOf(o) {
        if (!o.invoiceId || typeof customInvoices === 'undefined') return null;
        return customInvoices.find(i => i.id === o.invoiceId && !(typeof deletedInvoiceIds !== 'undefined' && deletedInvoiceIds.includes(i.id))) || null;
    }
    function banderol(o) {
        const hs = o.paket.map(x => x.h);
        if (!hs.length) return o.harga || '–';
        return hs.length === 1 ? rpShort(hs[0]) : rentang(Math.min(...hs), Math.max(...hs));
    }

    function shell() {
        const sec = document.getElementById('offerSection');
        if (!sec || sec.dataset.ready) return sec;
        sec.dataset.ready = '1';
        sec.innerHTML = `
            <div class="offer-top">
                <div class="offer-facts" id="offerFacts"></div>
                <button type="button" class="create-invoice-btn" id="offerAdd">+ Catet penawaran</button>
            </div>
            <div class="offer-tabs" id="offerTabs" role="group" aria-label="Saring per status"></div>
            <div class="offer-grid" id="offerGrid" aria-live="polite"></div>
            <dialog class="offer-dialog" id="offerDialog">
                <form id="offerForm" method="dialog" novalidate>
                    <h3 id="offerDlgTitle">Catet penawaran baru</h3>
                    <div class="offer-2"><label>Nawarin ke siapa<input name="klien" maxlength="80" required></label>
                        <label>Jenisnya<select name="kategori"><option>Sistem</option><option>Website</option><option>Video</option><option>Lainnya</option></select></label></div>
                    <label>Nawarin apa<input name="layanan" maxlength="160" placeholder="Contoh: sistem pendaftaran tur + QRIS"></label>
                    <div class="offer-pk"><span class="offer-lab">Paket yang ditawarin</span><div id="offerPkList"></div><button type="button" class="offer-link" id="offerPkAdd">+ Tambah paket</button></div>
                    <div class="offer-pk"><span class="offer-lab">Deal di mana?</span><div class="offer-chips" id="offerDealChips"></div>
                        <label id="offerDealOther" hidden>Nominal deal (Rp)<input name="nilai" inputmode="numeric" maxlength="15" placeholder="Contoh: 1500000"></label></div>
                    <div class="offer-2"><label>Statusnya<select name="tahap">${STAGES.map(([id, n]) => `<option value="${id}">${n}</option>`).join('')}</select></label>
                        <label>Kapan disapa lagi<input name="followUp" type="date"></label></div>
                    <div class="offer-2"><label>Dilempar tanggal<input name="dibuat" type="date"></label>
                        <label>Kontak orangnya<input name="kontak" maxlength="80"></label></div>
                    <label>Link halaman penawaran<input name="link" type="url" maxlength="300" placeholder="https://"></label>
                    <label>Harga kalau gak pakai paket<input name="harga" maxlength="80" placeholder="Contoh: lihat pitch deck"></label>
                    <label>Catatan kecil<textarea name="catatan" maxlength="1000" rows="3" placeholder="Kemarin dia bilang apa? Habis ini ngapain?"></textarea></label>
                    <div class="offer-inv" id="offerInvBox" hidden></div>
                    <div class="offer-hist" id="offerHist" hidden></div>
                    <div class="offer-acts">
                        <button type="button" class="offer-btn danger" id="offerDel" hidden>Buang</button>
                        <button type="button" class="offer-btn" id="offerCancel">Gak jadi</button>
                        <button type="submit" class="offer-btn primary">Simpan</button>
                    </div>
                </form>
            </dialog>`;
        sec.querySelector('#offerAdd').onclick = () => openForm(null);
        sec.querySelector('#offerTabs').onclick = e => { const b = e.target.closest('[data-f]'); if (b) { filter = b.dataset.f; render(); } };
        sec.querySelector('#offerGrid').onclick = e => {
            const b = e.target.closest('[data-edit]'); if (b) openForm(offers.find(o => o.id === b.dataset.edit));
            const iv = e.target.closest('[data-inv]'); if (iv && typeof openGeneratedInvoice === 'function') openGeneratedInvoice(iv.dataset.inv);
        };
        sec.querySelector('#offerGrid').onchange = e => {
            const sel = e.target.closest('[data-stage]'); if (!sel) return;
            const o = offers.find(x => x.id === sel.dataset.stage); if (!o || o.tahap === sel.value) return;
            o.tahap = sel.value; o.riwayat.push({ tahap: o.tahap, t: today() }); o.diubah = new Date().toISOString(); bump = o.id;
            save(); toast(o.klien + ': ' + ST[o.tahap].n);
        };
        const form = sec.querySelector('#offerForm');
        sec.querySelector('#offerCancel').onclick = () => sec.querySelector('#offerDialog').close();
        sec.querySelector('#offerPkAdd').onclick = () => { pkDraft.push({ n: '', h: 0 }); renderPk(); renderDeal(); const ins = sec.querySelectorAll('.offer-pk-n'); ins[ins.length - 1]?.focus(); };
        sec.querySelector('#offerPkList').oninput = e => {
            const i = e.target.dataset.k; if (i == null) return;
            if (e.target.classList.contains('offer-pk-n')) { const old = pkDraft[i].n; pkDraft[i].n = e.target.value; if (dealSel === old) dealSel = e.target.value; }
            else pkDraft[i].h = num(e.target.value);
            renderDeal();
        };
        sec.querySelector('#offerPkList').onclick = e => { const b = e.target.closest('[data-pkdel]'); if (!b) return; const x = pkDraft.splice(+b.dataset.pkdel, 1)[0]; if (x && dealSel === x.n) dealSel = ''; renderPk(); renderDeal(); };
        sec.querySelector('#offerDealChips').onclick = e => {
            const b = e.target.closest('[data-deal]'); if (!b) return; dealSel = b.dataset.deal; renderDeal();
            if (dealSel && ['disiapkan', 'terkirim', 'followup', 'nego'].includes(form.elements.tahap.value)) form.elements.tahap.value = 'deal';
            if (dealSel === '__lain') form.elements.nilai.focus();
        };
        let delArmed = false;
        sec.querySelector('#offerDel').onclick = () => {
            const btn = sec.querySelector('#offerDel');
            if (!delArmed) { delArmed = true; btn.textContent = 'Yakin dibuang? Tekan lagi'; setTimeout(() => { delArmed = false; btn.textContent = 'Buang'; }, 4000); return; }
            const o = offers.find(x => x.id === editId); offers = offers.filter(x => x.id !== editId);
            sec.querySelector('#offerDialog').close(); save(); toast((o ? o.klien : 'Penawaran') + ' udah dibuang');
        };
        sec.querySelector('#offerInvBox').onclick = e => {
            const o = offers.find(x => x.id === editId); if (!o) return;
            if (e.target.closest('[data-mkinv]')) makeInvoice(o);
            if (e.target.closest('[data-openinv]') && typeof openGeneratedInvoice === 'function') { sec.querySelector('#offerDialog').close(); openGeneratedInvoice(o.invoiceId); }
        };
        form.onsubmit = e => {
            e.preventDefault();
            const f = form.elements, klien = f.klien.value.trim();
            if (!klien) { toast('Nawarin ke siapa? Isi dulu namanya'); f.klien.focus(); return; }
            const link = f.link.value.trim(); if (link && !/^https?:\/\//.test(link)) { toast('Link-nya harus diawali https://'); return; }
            const old = editId ? offers.find(x => x.id === editId) : null, tahap = f.tahap.value;
            const paket = pkDraft.filter(x => x.n.trim() && x.h).map(x => ({ n: x.n.trim(), h: x.h }));
            let deal = '', nilai = 0;
            if (dealSel === '__lain') { nilai = num(f.nilai.value); if (!nilai) { toast('Isi nominal deal-nya dulu'); f.nilai.focus(); return; } }
            else if (dealSel) { const p = paket.find(x => x.n === dealSel); if (p) { deal = p.n; nilai = p.h; } }
            const v = normalize({ id: editId || (klien.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'p') + '-' + Date.now().toString(36),
                klien, kategori: f.kategori.value, layanan: f.layanan.value.trim(), harga: f.harga.value.trim(), paket, deal, nilai, tahap, followUp: f.followUp.value, dibuat: f.dibuat.value,
                kontak: f.kontak.value.trim(), link, catatan: f.catatan.value.trim(), invoiceId: old ? old.invoiceId : '',
                riwayat: old ? (old.tahap !== tahap ? old.riwayat.concat({ tahap, t: today() }) : old.riwayat) : [{ tahap, t: f.dibuat.value || today() }], diubah: new Date().toISOString() });
            if (old) Object.assign(old, v); else offers.push(v);
            if (old && old.tahap !== tahap) bump = old.id;
            sec.querySelector('#offerDialog').close(); save(); toast(old ? 'Sip, kesimpen' : klien + ' masuk buku dagang');
        };
        // Form "Buat invoice" ditutup tanpa disimpan: lepas tautan ke penawarannya.
        document.getElementById('invoiceManagerDialog')?.addEventListener('close', () => setTimeout(() => { pendingOfferId = null; }, 0));
        return sec;
    }

    function renderPk() {
        document.getElementById('offerPkList').innerHTML = pkDraft.length
            ? pkDraft.map((x, i) => `<div class="offer-pk-row"><input class="offer-pk-n" data-k="${i}" value="${esc(x.n)}" maxlength="40" placeholder="Nama paket" aria-label="Nama paket ${i + 1}"><input class="offer-pk-h" data-k="${i}" value="${x.h ? x.h.toLocaleString('id-ID') : ''}" inputmode="numeric" maxlength="15" placeholder="Harga (Rp)" aria-label="Harga paket ${i + 1}"><button type="button" data-pkdel="${i}" aria-label="Hapus paket ${i + 1}">×</button></div>`).join('')
            : '<p class="offer-empty-pk">Belum ada paket. Tambahin biar pas deal tinggal pilih.</p>';
    }
    function renderDeal() {
        const opts = [['', 'Belum deal']].concat(pkDraft.filter(x => x.n.trim() && x.h).map(x => [x.n, `<b>${esc(x.n)}</b> · ${rpShort(x.h)}`]), [['__lain', 'Angka lain']]);
        if (!opts.some(o => o[0] === dealSel)) dealSel = '';
        document.getElementById('offerDealChips').innerHTML = opts.map(([v, l]) => `<button type="button" data-deal="${esc(v)}" aria-pressed="${dealSel === v}">${l}</button>`).join('');
        document.getElementById('offerDealOther').hidden = dealSel !== '__lain';
    }
    function renderInvBox(o) {
        const box = document.getElementById('offerInvBox');
        if (!o || !(o.nilai > 0)) { box.hidden = true; return; }
        const inv = invoiceOf(o);
        box.hidden = false;
        box.innerHTML = inv
            ? `<span>Invoice udah dibikin: <b>${esc(inv.reference)}</b> · ${rp(inv.gross)}</span><button type="button" class="offer-btn" data-openinv>Buka invoice</button>`
            : `<span>Deal ${o.deal ? 'paket <b>' + esc(o.deal) + '</b> ' : ''}di <b>${rp(o.nilai)}</b>. Tinggal ditagih.</span><button type="button" class="offer-btn primary" data-mkinv>Bikin invoice</button>`;
    }
    function openForm(o) {
        const sec = shell(), f = sec.querySelector('#offerForm').elements;
        editId = o ? o.id : null;
        sec.querySelector('#offerDlgTitle').textContent = o ? o.klien : 'Catet penawaran baru';
        f.klien.value = o?.klien || ''; f.kategori.value = o?.kategori || 'Sistem'; f.layanan.value = o?.layanan || ''; f.harga.value = o?.harga || '';
        f.tahap.value = o?.tahap || 'disiapkan'; f.followUp.value = o?.followUp || ''; f.dibuat.value = o?.dibuat || today();
        f.kontak.value = o?.kontak || ''; f.link.value = o?.link || ''; f.catatan.value = o?.catatan || ''; f.nilai.value = o && o.nilai ? o.nilai : '';
        pkDraft = (o?.paket || []).map(x => ({ ...x }));
        dealSel = !o || !o.nilai ? '' : (o.deal && pkDraft.some(x => x.n === o.deal && x.h === o.nilai)) ? o.deal : '__lain';
        renderPk(); renderDeal(); renderInvBox(o);
        sec.querySelector('#offerDel').hidden = !o; sec.querySelector('#offerDel').textContent = 'Buang';
        const hist = (o?.riwayat || []).slice().reverse(), h = sec.querySelector('#offerHist');
        h.hidden = !hist.length;
        h.innerHTML = hist.length ? `<span class="offer-lab">Jejak statusnya</span><ol>${hist.map(x => `<li>${tgl(x.t)}: ${esc(ST[x.tahap].n)}</li>`).join('')}</ol>` : '';
        sec.querySelector('#offerDialog').showModal();
    }

    // Deal → draft invoice: form "Buat invoice" yang biasa, sudah terisi dari penawaran.
    function makeInvoice(o) {
        if (typeof openInvoiceComposer !== 'function') { toast('Form invoice belum siap, coba lagi'); return; }
        document.getElementById('offerDialog').close();
        pendingOfferId = o.id;
        openInvoiceComposer();
        const form = document.getElementById('invoiceDraftForm'); if (!form) return;
        form.elements.client.value = o.klien;
        form.elements.description.value = [o.layanan, o.deal ? 'Paket ' + o.deal : ''].filter(Boolean).join(' — ');
        form.elements.gross.value = o.nilai;
        const hint = document.getElementById('draftHint');
        if (hint) hint.textContent = 'Terisi dari penawaran ' + o.klien + '. Cek lagi rincian, DP, dan tanggalnya sebelum disimpan.';
    }
    window.onCustomInvoiceCreated = item => {
        if (!pendingOfferId || !offers) return;
        const o = offers.find(x => x.id === pendingOfferId); pendingOfferId = null;
        if (!o) return;
        o.invoiceId = item.id;
        if (o.tahap === 'deal') { o.tahap = 'dikerjakan'; o.riwayat.push({ tahap: 'dikerjakan', t: today() }); }
        o.diubah = new Date().toISOString();
        saveLocal(); // invoice-manager langsung menyimpan semuanya ke database setelah ini
    };

    function render() {
        const sec = shell(); if (!sec) return;
        if (!offers) { sec.querySelector('#offerGrid').innerHTML = '<p class="offer-empty">Lagi buka buku dagangnya…</p>'; return; }
        const aktif = offers.filter(o => AKTIF.includes(o.tahap)), fu = offers.filter(fuState);
        const nilai = offers.filter(o => DEALISH.includes(o.tahap)).reduce((a, o) => a + o.nilai, 0);
        sec.querySelector('#offerFacts').innerHTML = `<span><b>${offers.length}</b> penawaran dilempar</span><span><b>${aktif.length}</b> masih ditunggu kabarnya</span><span class="hot">Udah deal <b>${nilai ? rpShort(nilai) : 'Rp 0'}</b></span>${fu.length ? `<span class="late"><b>${fu.length}</b> nunggu disapa lagi</span>` : ''}`;
        const count = id => id === 'semua' ? offers.length : id === 'fu' ? fu.length : offers.filter(o => o.tahap === id).length;
        const tabs = [['semua', 'Semuanya'], ['fu', 'Waktunya disapa'], ...STAGES.map(([id, n]) => [id, n])].filter(([id]) => id === 'semua' || id === filter || count(id));
        if (!tabs.some(t => t[0] === filter)) filter = 'semua';
        sec.querySelector('#offerTabs').innerHTML = tabs.map(([id, n]) => `<button type="button" data-f="${id}" aria-pressed="${filter === id}">${n}<sup>${pad(count(id))}</sup></button>`).join('');
        const list = offers.filter(o => filter === 'semua' || (filter === 'fu' ? fuState(o) : o.tahap === filter)).sort((a, b) => {
            const fa = AKTIF.includes(a.tahap) && a.followUp ? a.followUp : '9999', fb = AKTIF.includes(b.tahap) && b.followUp ? b.followUp : '9999';
            return fa.localeCompare(fb) || ST[a.tahap].i - ST[b.tahap].i || (b.dibuat || '').localeCompare(a.dibuat || '');
        });
        const grid = sec.querySelector('#offerGrid');
        if (!offers.length) { grid.innerHTML = '<p class="offer-empty">Belum ada yang ditawarin. Yuk mulai jualan, tekan “Catet penawaran”.</p>'; return; }
        if (!list.length) { grid.innerHTML = '<p class="offer-empty">Kosong. Belum ada yang nyangkut di sini.</p>'; return; }
        grid.innerHTML = list.map((o, i) => {
            const s = ST[o.tahap], fs = fuState(o), inv = invoiceOf(o);
            const harga = o.nilai ? (o.deal ? o.deal + ' · ' : '') + rpShort(o.nilai) : banderol(o);
            const when = o.followUp && AKTIF.includes(o.tahap)
                ? `<span class="offer-k">Sapa lagi</span><span class="offer-v${fs === 'late' ? ' late' : ''}">${fs === 'late' ? 'Telat! ' : fs === 'today' ? 'Hari ini, ' : ''}${tgl(o.followUp)}</span>`
                : `<span class="offer-k">Dilempar</span><span class="offer-v">${tgl(o.dibuat) || '–'}</span>`;
            return `<article class="offer-card" style="--rot:${ROT[i % ROT.length]}deg;--paper:${PAPER[o.kategori] || PAPER.Sistem}"><div class="offer-tix">
                <div class="offer-head"><span class="offer-no">No. ${pad(i + 1)}</span>
                    <select class="offer-stage${o.id === bump ? ' thunk' : ''}" style="--c:${s.c}" data-stage="${esc(o.id)}" aria-label="Status ${esc(o.klien)}">${STAGES.map(([id, n]) => `<option value="${id}"${id === o.tahap ? ' selected' : ''}>${n}</option>`).join('')}</select></div>
                <h4>${esc(o.klien)}</h4>${o.layanan ? `<p class="offer-lay">${esc(o.layanan)}</p>` : ''}
                <div class="offer-tear" aria-hidden="true"></div>
                <div class="offer-meta"><div><span class="offer-k">${o.nilai ? 'Deal di' : 'Dibanderol'}</span><span class="offer-v big">${esc(harga)}</span></div><div>${when}</div></div>
                <div class="offer-row-acts">${inv ? `<button type="button" class="offer-invtag" data-inv="${esc(inv.id)}" title="Buka invoice ${esc(inv.reference)}">Invoice ✓</button>` : ''}${/^https?:\/\//.test(o.link) ? `<a class="offer-ic" href="${esc(o.link)}" target="_blank" rel="noopener" title="Intip halaman penawarannya" aria-label="Buka halaman penawaran ${esc(o.klien)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M8 7h9v9"/></svg></a>` : ''}<button type="button" class="offer-ic" data-edit="${esc(o.id)}" title="Buka catatannya" aria-label="Detail ${esc(o.klien)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg></button></div>
            </div></article>`;
        }).join('');
        if (bump) setTimeout(() => { bump = null; }, 900);
        // Karcis dibagikan sekali saat menu pertama dibuka, bukan tiap data berubah
        if (!dealt) { dealt = true; grid.classList.add('anim'); setTimeout(() => grid.classList.remove('anim'), 1500); }
    }
    window.renderOffers = render;
})();
