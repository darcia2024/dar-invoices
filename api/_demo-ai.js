// Stand-in for the AI on accounts whose AI is switched off (ai: false in _workspaces.js, e.g. the
// public demo). Answers look like the real assistant and use the dashboard's own numbers, but
// are built from simple rules here, so OpenRouter is never called and costs nothing.

function rupiah(n) {
  return "Rp" + Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function parseContext(raw) {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    return value && typeof value === "object" ? value : {};
  } catch (e) {
    return {};
  }
}

// "20rb", "20 ribu", "15k", "1,5jt", "2 juta", "Rp 25.000", "25000" -> rupiah
function parseAmount(text) {
  const m = String(text).toLowerCase().match(/(?:rp\.?\s*)?(\d+(?:[.,]\d+)*)\s*(juta|jt|ribu|rb|k)?\b/);
  if (!m) return null;
  const unit = m[2] || "";
  let n;
  if (unit === "juta" || unit === "jt") n = Number(m[1].replace(",", ".")) * 1_000_000;
  else if (unit) n = Number(m[1].replace(",", ".")) * 1_000;
  else n = Number(m[1].replace(/[.,]/g, ""));
  return Number.isFinite(n) && n >= 100 ? Math.round(n) : null;
}

function spendingNote(text) {
  const note = String(text)
    .replace(/(?:rp\.?\s*)?\d+(?:[.,]\d+)*\s*(?:juta|jt|ribu|rb|k)?\b/gi, "")
    .replace(/\b(tolong|dong|ya|catat(?:in|kan)?|pengeluaran|tadi|barusan|habis|buat|untuk|beli|bayar|aku|gue|saya)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return note ? note.charAt(0).toUpperCase() + note.slice(1, 60) : "Pengeluaran";
}

function matchPlanItem(note, plans) {
  const words = note.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const hit = plans.find((p) => words.some((w) => String(p.nama || "").toLowerCase().includes(w)));
  if (hit) return hit;
  return plans.find((p) => /harian|sehari|makan|pokok/i.test(`${p.nama} ${p.kategori}`)) || null;
}

const BANK_WORDS = [
  ["mandiri", /mandiri/], ["jago", /jago/], ["blu", /\bblu\b/], ["line", /line\s*bank|\bline\b/],
  ["gopay", /go\s*pay|gojek/], ["dana", /\bdana\b/], ["mayar", /mayar/],
];

function bankFromText(q) {
  const hit = BANK_WORDS.find(([, re]) => re.test(q));
  return hit ? hit[0] : "";
}

function unpaidInvoices(ctx) {
  return (Array.isArray(ctx.invoice) ? ctx.invoice : []).filter((i) => Number(i.sisa) > 0).sort((a, b) => b.sisa - a.sisa);
}

function planSummary(ctx) {
  const plans = Array.isArray(ctx.rencana_bulan_aktif) ? ctx.rencana_bulan_aktif : [];
  const budget = plans.reduce((s, p) => s + (Number(p.anggaran) || 0), 0);
  const used = plans.reduce((s, p) => s + (Number(p.terpakai) || 0), 0);
  return { plans, budget, used, open: plans.filter((p) => !p.selesai) };
}

function cashTotal(ctx) {
  return Number(ctx.saldo_bank && ctx.saldo_bank.total) || 0;
}

function advice(ctx) {
  const cash = cashTotal(ctx);
  const unpaid = unpaidInvoices(ctx);
  const unpaidTotal = unpaid.reduce((s, i) => s + i.sisa, 0);
  const { budget, used } = planSummary(ctx);
  const left = Math.max(0, budget - used);
  const lines = [`Posisi kamu sekarang: saldo **${rupiah(cash)}**, tagihan klien yang belum masuk **${rupiah(unpaidTotal)}**, sisa anggaran bulan ini **${rupiah(left)}**.`, ""];
  if (unpaid.length) lines.push(`- **Tagih dulu ${unpaid[0].klien}** (sisa ${rupiah(unpaid[0].sisa)}), itu pemasukan terbesar yang masih nyangkut.`);
  if (budget && cash < left) lines.push(`- Saldo belum cukup buat semua rencana (kurang ${rupiah(left - cash)}). Dahulukan kebutuhan pokok, tunda yang bisa ditunda.`);
  else if (budget) lines.push("- Saldo cukup buat rencana bulan ini. Sisihkan 10–20% pemasukan berikutnya untuk dana darurat.");
  else lines.push("- Belum ada rencana pengeluaran bulan ini. Bikin dulu di menu **Rencana** biar kelihatan uangnya cukup atau nggak.");
  const today = new Date();
  const daysLeft = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate() - today.getDate() + 1;
  const perDay = Math.floor((cash - left) / daysLeft / 1000) * 1000;
  if (perDay > 0) lines.push(`- Batas aman jajan di luar rencana sampai akhir bulan sekitar **${rupiah(perDay)}** per hari.`);
  else if (cash > 0) lines.push("- Saldo sudah habis terpakai buat rencana, jadi tahan dulu jajan di luar rencana sampai ada pemasukan.");
  return lines.join("\n");
}

function demoAssistant({ mode, history, context }) {
  const ctx = parseContext(context);
  const text = String((history[history.length - 1] || {}).content || "");
  const q = text.toLowerCase();
  const today = /^\d{4}-\d{2}-\d{2}$/.test(ctx.hari_ini || "") ? ctx.hari_ini : new Date().toISOString().slice(0, 10);

  const amount = parseAmount(q);
  if (amount && /(catat|beli|bayar|habis|jajan|bensin|makan|ongkos|parkir|pulsa|kopi|belanja|keluar)/.test(q)) {
    const bank = bankFromText(q);
    const note = spendingNote(text.replace(/\b(pake|pakai|via|dari|lewat)\s+(\w+\s*bank|go\s*pay|\w+)\s*$/i, ""));
    const pos = matchPlanItem(note, planSummary(ctx).plans);
    const bankName = bank ? ((Array.isArray(ctx.rekening) ? ctx.rekening : []).find((r) => r.key === bank) || {}).nama || bank : "";
    return {
      reply: `Siap, ini catatan pengeluarannya: **${note}** ${rupiah(amount)} tanggal ${today}${pos ? `, masuk ke pos **${pos.nama}**` : ""}.` +
        (bankName ? ` Saldo **${bankName}** langsung kepotong setelah kamu klik Jalankan.` : " Dibayar dari rekening apa? Pilih di kolom **Dari**, saldonya langsung kepotong setelah kamu klik Jalankan."),
      actions: [{ name: "catat_pengeluaran", args: { amount, date: today, note, pos_id: pos ? pos.id : "", bank } }],
    };
  }

  if (mode === "penasehat" || /(saran|tips|nasehat|nasihat|aman|cukup|gimana keuangan|kondisi)/.test(q)) {
    return { reply: advice(ctx), actions: [] };
  }

  if (/(saldo|uang|kas|rekening|duit)/.test(q)) {
    const per = Object.entries((ctx.saldo_bank && ctx.saldo_bank.per_akun) || {}).filter(([, v]) => Number(v) > 0);
    const reply = cashTotal(ctx)
      ? `Total saldo kamu **${rupiah(cashTotal(ctx))}**${per.length ? ":\n" + per.map(([k, v]) => `- ${k}: ${rupiah(v)}`).join("\n") : "."}`
      : "Saldo masih **Rp0**. Isi dulu lewat tombol **Update saldo** biar aku bisa bantu hitung.";
    return { reply, actions: [] };
  }

  if (/(invoice|tagih|klien|belum bayar|belum lunas|piutang|pemasukan)/.test(q)) {
    const unpaid = unpaidInvoices(ctx);
    if (!unpaid.length) return { reply: "Semua invoice sudah lunas, nggak ada yang perlu ditagih. Mantap!", actions: [] };
    const total = unpaid.reduce((s, i) => s + i.sisa, 0);
    return {
      reply: `Ada **${unpaid.length} invoice** yang belum lunas, totalnya **${rupiah(total)}**:\n` +
        unpaid.slice(0, 6).map((i) => `- ${i.klien}: sisa ${rupiah(i.sisa)}`).join("\n") +
        "\n\nMau aku buatin pesan pengingat WhatsApp yang sopan buat salah satunya?",
      actions: [],
    };
  }

  if (/(rencana|anggaran|budget|pos)/.test(q)) {
    const { plans, budget, used, open } = planSummary(ctx);
    if (!plans.length) return { reply: "Rencana bulan ini masih kosong. Tambah pos di menu **Rencana**, atau bilang aja misalnya \"tambah rencana listrik 300rb tiap bulan\".", actions: [] };
    return {
      reply: `Rencana bulan ini: anggaran **${rupiah(budget)}**, terpakai **${rupiah(used)}**, sisa **${rupiah(Math.max(0, budget - used))}**.` +
        (open.length ? "\nYang belum selesai:\n" + open.slice(0, 6).map((p) => `- ${p.nama}: ${rupiah(p.anggaran)}`).join("\n") : ""),
      actions: [],
    };
  }

  if (/(hutang|utang|pinjam)/.test(q)) {
    const debts = (Array.isArray(ctx.hutang_piutang) ? ctx.hutang_piutang : []).filter((d) => Number(d.sisa) > 0);
    if (!debts.length) return { reply: "Nggak ada hutang atau piutang yang belum lunas.", actions: [] };
    return { reply: "Catatan yang belum lunas:\n" + debts.slice(0, 6).map((d) => `- ${d.jenis === "hutang" ? "Hutang ke" : "Piutang dari"} ${d.nama}: sisa ${rupiah(d.sisa)}`).join("\n"), actions: [] };
  }

  return {
    reply: "Aku bisa bantu:\n- Nyatat pengeluaran, misalnya \"catat bensin 20rb\"\n- Cek saldo, tagihan klien yang belum lunas, dan sisa anggaran\n- Kasih saran keuangan di mode **Penasehat**\n- Baca foto struk lewat tombol kamera\n\nMau mulai dari mana?",
    actions: [],
  };
}

const SAMPLE_RECEIPTS = [
  { merchant: "Indomaret", description: "Belanja kebutuhan harian", amount: 47500 },
  { merchant: "Pertamina", description: "Bensin Pertalite", amount: 30000 },
  { merchant: "GoFood", description: "Makan siang", amount: 38000 },
  { merchant: "Alfamart", description: "Air mineral dan camilan", amount: 22900 },
  { merchant: "Kopi Kenangan", description: "Kopi susu", amount: 24000 },
];

function demoScan({ images, posOptions, today }) {
  const daily = posOptions.find((p) => /harian|sehari|makan|pokok/i.test(`${p.name} ${p.category}`));
  const start = Math.floor(Date.now() / 60000) % SAMPLE_RECEIPTS.length;
  const transactions = images.map((_, i) => {
    const r = SAMPLE_RECEIPTS[(start + i) % SAMPLE_RECEIPTS.length];
    return { imageIndex: i, date: today, amount: r.amount, merchant: r.merchant, description: r.description, posId: daily ? daily.id : "", isExpense: true, confidence: "high" };
  });
  return { transactions, notes: "" };
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = { demoAssistant, demoScan, pause };
