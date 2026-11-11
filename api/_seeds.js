// One-time changes to an account's saved data, applied by api/billing-state.js on load (the id
// is kept in appliedMigrations, so each runs once).
//
// Ziaud's history:
// - first sample data ("ziaud-contoh-v1", "ziaud-titipan-contoh-v1"), removed on 2026-11-11 by
//   "ziaud-bersih-v1" (everything marked demo, like the "Hapus data contoh" button)
// - then real entries from his notebook; on 2026-11-11 Daru asked to wipe them and show sample
//   data again so Ziaud can see how everything works: "ziaud-contoh-v2". Seeds with
//   backup: true make billing-state.js keep the data they replace under
//   "<state key>:backup:<seed id>" in Redis.
function withoutDemo(state) {
  const exchange = state.exchange && typeof state.exchange === "object" ? state.exchange : null;
  if (!exchange) return null;
  const wasDemo = exchange.demo === true;
  const deposits = exchange.deposits && typeof exchange.deposits === "object" ? exchange.deposits : {};
  const people = Array.isArray(deposits.people) ? deposits.people : [];
  const demoPeople = new Set(people.filter((p) => p && p.demo).map((p) => p.id));
  const trades = {};
  Object.entries(exchange.trades || {}).forEach(([month, list]) => {
    const kept = (Array.isArray(list) ? list : []).filter((t) => t && !t.demo);
    if (kept.length) trades[month] = kept;
  });
  const next = {
    ...exchange,
    demo: false,
    trades,
    deposits: {
      people: people.filter((p) => p && !demoPeople.has(p.id)),
      moves: (Array.isArray(deposits.moves) ? deposits.moves : []).filter((m) => m && !m.demo && !demoPeople.has(m.personId)),
    },
  };
  // The sample kurs and SeaBank balance were part of the sample too.
  if (wasDemo) next.rates = {};
  const balances = state.bankBalances && typeof state.bankBalances === "object" ? state.bankBalances : {};
  return {
    ...state,
    exchange: next,
    ...(wasDemo ? { bankBalances: { ...balances, seabank: 0 }, bankBalancesUpdatedAt: "" } : {}),
  };
}

// ---------- Sample data v2: the Aset / Laporan / Titipan / Talangan screens filled in ----------
function jakartaDate(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

function monthOf(offsetMonths) {
  const [y, m] = jakartaDate(0).split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offsetMonths, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function sampleV2() {
  let order = 0;
  const at = () => Date.UTC(2026, 0, 1) + ++order * 60000;
  const today = jakartaDate(0);
  const month = today.slice(0, 7);

  // Tukar: pounds/dollars handed over, rupiah that came into a bank. Kurs modal 330 / 16200.
  const deals = [
    [9, "Buust", "EGP", 40000, 13760000, "seabank", 330, "Ziaud"],
    [8, "Toko Amanah", "EGP", 12000, 4140000, "bca", 330, "Ziaud"],
    [7, "Kak Rina", "USD", 300, 4950000, "bca", 16200, "Ziaud"],
    [6, "Wisma Nusantara", "EGP", 25000, 8625000, "seabank", 330, "Ziaud"],
    [5, "Mas Fikri", "EGP", 3000, 1050000, "jago", 330, "Ilham"],
    [4, "Buust", "EGP", 30000, 10350000, "seabank", 330, "Ilham"],
    [3, "Kak Rina", "EGP", 5000, 1735000, "bri", 330, "Ilham"],
    [2, "Toko Amanah", "USD", 200, 3310000, "bca", 16200, "Ilham"],
    [1, "Mas Fikri", "EGP", 4500, 1575000, "jago", 330, "Ziaud"],
    [0, "Buust", "EGP", 20000, 6900000, "seabank", 330, "Ziaud"],
  ].map(([ago, name, currency, qty, idr, bankKey, modal, by]) => ({
    id: `deal-demo-${order + 1}`, date: jakartaDate(-ago), name, currency, qty, holdingId: currency === "EGP" ? "hold-instapay" : "hold-cash-usd",
    holdDelta: 0, idr, bankKey, bankDelta: 0, modal, by, demo: true, createdAt: at(),
  }));

  // Titipan: investors (own pos), workers' pay in pounds, a customer transfer not handed over
  // yet, and a dollar deposit.
  const people = [
    ["dep-demo-hasan", "Pak Hasan", "investor", "Modal usaha"],
    ["dep-demo-aisyah", "Bu Aisyah", "investor", ""],
    ["dep-demo-rizki", "Rizki", "pekerja", "Restoran Nasr City"],
    ["dep-demo-fadli", "Fadli", "pekerja", ""],
    ["dep-demo-dimas", "Dimas", "pelanggan", "Transfer untuk tukar pound"],
    ["dep-demo-yusuf", "Om Yusuf", "lainnya", "Titip dollar"],
  ].map(([id, name, kind, note]) => ({ id, name, kind, phone: "", note, demo: true, createdAt: at() }));
  const moves = [
    [40, "dep-demo-hasan", "setor", "IDR", 25000000, "Ziaud"],
    [30, "dep-demo-aisyah", "setor", "IDR", 10000000, "Ziaud"],
    [20, "dep-demo-rizki", "setor", "EGP", 3000, "Ziaud", "Gaji Oktober"],
    [12, "dep-demo-rizki", "ambil", "EGP", 500, "Ilham"],
    [10, "dep-demo-fadli", "setor", "EGP", 1800, "Ziaud", "Gaji"],
    [6, "dep-demo-yusuf", "setor", "USD", 400, "Ziaud"],
    [1, "dep-demo-dimas", "setor", "IDR", 4250000, "Ilham", "Sudah transfer ke SeaBank, pound belum diserahkan"],
  ].map(([ago, personId, type, currency, amount, by, note = ""]) => ({
    id: `dep-demo-m${order + 1}`, personId, type, currency, amount, rate: 0, idr: 0, date: jakartaDate(-ago),
    bankKey: "", bankDelta: 0, tradeId: "", note, by, demo: true, createdAt: at(),
  }));

  // Monthly asset report: five finished months plus this one (filled in by the screen).
  const history = {};
  // aset bersih = pegangan + talangan - titipan, growing slowly up to this month's numbers.
  [
    [-5, 70000000, 4000000, 11900000, 2400000, 3200000],
    [-4, 75200000, 4600000, 13000000, 2750000, 3600000],
    [-3, 78900000, 5100000, 13500000, 2600000, 2900000],
    [-2, 82600000, 5900000, 13600000, 3050000, 3400000],
    [-1, 85400000, 6300000, 12100000, 3300000, 3800000],
  ].forEach(([off, pegangan, talangan, titipan, profit, spent]) => {
    const total = pegangan + talangan - titipan;
    const m = monthOf(off);
    const [y, mm] = m.split("-").map(Number);
    const last = new Date(Date.UTC(y, mm, 0)).toISOString().slice(0, 10);
    history[m] = { total, pegangan, bank: Math.round(pegangan * 0.45), valas: Math.round(pegangan * 0.55), talangan, titipan, investor: 35000000, hutang: 0, profit, spent, at: last };
  });

  const exchange = {
    demo: true,
    rates: {},
    trades: {},
    assetRates: { EGP: 330, USD: 16200 },
    holdings: [
      { id: "hold-instapay", label: "InstaPay", currency: "EGP", amount: 85000 },
      { id: "hold-cash-egp", label: "Cash", currency: "EGP", amount: 22000 },
      { id: "hold-cash-usd", label: "Cash", currency: "USD", amount: 650 },
    ],
    deals,
    deposits: { people, moves },
    assetHistory: history,
    assetDaily: dailySample(),
  };

  // Talangan: one due today (the reminder shows), one tomorrow, one late, one partly paid, one
  // paid. Amounts in rupiah, pounds and dollars.
  const debt = (id, name, amount, currency, dueIn, paid, notes, by) => ({
    id, type: "piutang", name, phone: "", amount, paid, currency, date: jakartaDate(-14), due: dueIn === null ? "" : jakartaDate(dueIn),
    notes, by, demo: true, createdAt: at(),
  });
  const debts = [
    debt("debt-demo-ahmad", "Ahmad", 1000000, "IDR", 0, 0, "Talangan bayar kos", "Ziaud"),
    debt("debt-demo-nisa", "Kak Nisa", 3000, "EGP", 1, 0, "Talangan tiket bus", "Ilham"),
    debt("debt-demo-faisal", "Faisal", 200, "USD", -3, 0, "Talangan beli laptop", "Ziaud"),
    debt("debt-demo-rudi", "Bang Rudi", 2500000, "IDR", 10, 1000000, "Talangan bayar kuliah", "Ziaud"),
    debt("debt-demo-salma", "Salma", 1500, "EGP", -5, 1500, "Talangan belanja", "Ilham"),
  ];

  // Spending this month (Laporan) and a plan that does not touch the balances.
  const log = (ago, amount, note, bankKey, by) => ({
    id: `log-demo-${order + 1}`, date: jakartaDate(-ago), amount, posId: "", note, merchant: "", source: "manual", bankKey, bankCut: 0, by, demo: true, createdAt: at(),
  });
  const logs = [
    log(8, 350000, "Makan & belanja dapur", "seabank", "Ziaud"),
    log(6, 150000, "Pulsa & kuota", "jago", "Ziaud"),
    log(2, 120000, "Transport", "jago", "Ilham"),
    log(1, 275000, "Makan", "seabank", "Ilham"),
  ].filter((l) => l.date.slice(0, 7) === month);
  const plan = (name, category, planned, due, notes) => ({
    id: `plan-demo-${order + 1}`, name, category, planned, actual: 0, done: false, due, notes, recurring: false, demo: true, createdAt: at(),
  });
  const nextMonth = monthOf(1);
  const expensePlans = {
    [month]: [plan("Sewa kamar", "tagihan", 2500000, "", ""), plan("Makan bulanan", "pokok", 1500000, "", "")],
    [nextMonth]: [plan("Motor bekas", "lainnya", 10000000, `${nextMonth}-10`, "Rencana, belum tentu jadi beli")],
  };

  return {
    exchange,
    debts,
    expenseLogs: logs.length ? { [month]: logs } : {},
    expensePlans,
    planSeededMonths: [month, nextMonth],
    // Balances as of today: every sample entry above is already inside them.
    bankBalances: { seabank: 18450000, jago: 6200000, bca: 12750000, bri: 3900000 },
    bankBalancesUpdatedAt: today,
  };
}

// Sample daily report: aset bersih at the end of the last 10 days, rising slowly (today's line
// is written by the screen itself).
function dailySample() {
  const out = {};
  for (let ago = 10; ago >= 1; ago--) {
    const step = 10 - ago;
    out[jakartaDate(-ago)] = { total: 79800000 + step * 210000 + (step % 3 === 0 ? -150000 : 0), pegangan: 85600000 + step * 160000 };
  }
  return out;
}

// Adds the daily sample to an account still showing sample v2 (it came before the daily report).
function withDailySample(state) {
  const exchange = state.exchange && typeof state.exchange === "object" ? state.exchange : null;
  if (!exchange || exchange.demo !== true) return null;
  if (exchange.assetDaily && Object.keys(exchange.assetDaily).length) return null;
  return { ...state, exchange: { ...exchange, assetDaily: dailySample() } };
}

// Replaces the account's data with sample v2 (the old data is backed up, see above).
function withSampleV2(state) {
  return { appliedMigrations: state.appliedMigrations || [], bankAccountDetails: state.bankAccountDetails || null, ...sampleV2() };
}

// Removes sample v2 the way the "Hapus data contoh" button does: every record marked demo, and
// while the account still shows the sample, its balances, kurs, holdings and asset reports.
// Entries recorded by hand stay.
function withoutSampleV2(state) {
  const list = (v) => (Array.isArray(v) ? v : []);
  const obj = (v) => (v && typeof v === "object" ? v : {});
  const byMonth = (map, keepEmpty) => {
    const out = {};
    Object.entries(obj(map)).forEach(([month, items]) => {
      const kept = list(items).filter((x) => x && !x.demo);
      if (kept.length || keepEmpty) out[month] = kept;
    });
    return out;
  };
  const exchange = obj(state.exchange);
  const wasDemo = exchange.demo === true;
  const deposits = obj(exchange.deposits);
  const demoPeople = new Set(list(deposits.people).filter((p) => p && p.demo).map((p) => p.id));
  const next = {
    ...exchange,
    demo: false,
    trades: byMonth(exchange.trades),
    deals: list(exchange.deals).filter((d) => d && !d.demo),
    deposits: {
      ...deposits,
      people: list(deposits.people).filter((p) => p && !demoPeople.has(p.id)),
      moves: list(deposits.moves).filter((m) => m && !m.demo && !demoPeople.has(m.personId)),
    },
  };
  if (wasDemo) {
    const zeroRates = {};
    const zeroAsset = {};
    Object.keys({ ...obj(exchange.rates), ...obj(exchange.assetRates) }).forEach((c) => { zeroRates[c] = { sell: 0, buy: 0 }; zeroAsset[c] = 0; });
    next.rates = zeroRates;
    next.assetRates = zeroAsset;
    next.holdings = list(exchange.holdings).map((h) => ({ ...h, amount: 0 }));
    next.assetHistory = {};
    next.assetDaily = {};
  }
  const balances = obj(state.bankBalances);
  return {
    ...state,
    exchange: next,
    debts: list(state.debts).filter((d) => d && !d.demo),
    expenseLogs: byMonth(state.expenseLogs),
    expensePlans: byMonth(state.expensePlans, true),
    ...(wasDemo ? { bankBalances: Object.fromEntries(Object.keys(balances).map((k) => [k, 0])), bankBalancesUpdatedAt: "" } : {}),
  };
}

const SEEDS = {
  ziaud: [
    { id: "ziaud-bersih-v1", apply: withoutDemo },
    { id: "ziaud-contoh-v2", apply: withSampleV2, backup: true },
    { id: "ziaud-contoh-v2-harian", apply: withDailySample },
    // 2026-11-11: Ziaud starts entering his own data; the sample goes (kept as a backup).
    { id: "ziaud-bersih-v2", apply: withoutSampleV2, backup: true },
  ],
};

// Ids of the pending seeds that replace data, so billing-state.js can back it up first.
function pendingBackups(ws, state) {
  const applied = Array.isArray(state.appliedMigrations) ? state.appliedMigrations : [];
  return (SEEDS[ws] || []).filter((s) => s.backup && !applied.includes(s.id) && (!s.ready || s.ready())).map((s) => s.id);
}

// Applies every seed of the account not applied yet; returns the new state, or null when
// nothing changed.
function applySeed(ws, state) {
  const seeds = SEEDS[ws];
  if (!seeds) return null;
  let current = state;
  let changed = false;
  seeds.forEach((seed) => {
    const applied = Array.isArray(current.appliedMigrations) ? current.appliedMigrations : [];
    if (applied.includes(seed.id)) return;
    if (seed.ready && !seed.ready()) return;
    const next = seed.apply(current);
    current = { ...(next || current), appliedMigrations: [...applied, seed.id] };
    changed = true;
  });
  return changed ? current : null;
}

module.exports = { applySeed, pendingBackups, withoutDemo, withoutSampleV2, sampleV2 };
