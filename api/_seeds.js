// Sample data for a new account, so the owner can see how the screens work before entering
// their own. Applied once by api/billing-state.js (id kept in appliedMigrations), and only
// while the account has no exchange trades yet. Every sample trade carries demo: true; the
// "Hapus data contoh" button in exchange.js removes them.
function jakartaDate(offsetDays = 0) {
  const now = new Date(Date.now() + offsetDays * 86400000);
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

function exchangeSample() {
  const trades = [];
  let order = 0;
  const add = (daysAgo, type, currency, qty, rate, customer = "", note = "") => {
    const date = jakartaDate(-daysAgo);
    trades.push({
      id: `fx-demo-${++order}`,
      type,
      date,
      currency,
      qty,
      rate,
      idr: type === "koreksi" ? 0 : Math.round(qty * rate),
      customer,
      note,
      bankKey: type === "koreksi" ? "" : "seabank",
      bankDelta: 0, // already inside the sample SeaBank balance
      demo: true,
      createdAt: Date.UTC(2026, 0, 1) + order * 60000,
    });
  };
  add(15, "koreksi", "EGP", 20000, 332, "", "Stok awal");
  add(15, "koreksi", "USD", 1500, 16250, "", "Stok awal");
  add(14, "jual", "EGP", 2000, 345, "Ahmad Fauzi");
  add(14, "jual", "USD", 200, 16600, "Rina Marlina");
  add(12, "beli", "EGP", 5000, 335, "", "Restok dari money changer Kairo");
  add(10, "jual", "EGP", 1500, 345, "Fauzan");
  add(10, "jual", "USD", 100, 16650, "Hafiz");
  add(8, "jual", "EGP", 3000, 347, "Ustadz Hanif", "Biaya kuliah Al-Azhar");
  add(8, "beli", "USD", 300, 16300, "Salma", "Pelanggan jual dollar");
  add(6, "jual", "EGP", 800, 345, "Nadia");
  add(6, "jual", "USD", 250, 16600, "Zahra");
  add(4, "jual", "EGP", 2500, 348, "Rombongan umrah Al-Hidayah");
  add(2, "jual", "EGP", 1000, 346, "Ikhsan");
  add(2, "jual", "USD", 150, 16650, "Dimas");
  add(1, "beli", "EGP", 3000, 338, "", "Restok");
  add(0, "jual", "EGP", 600, 345, "Laila");
  add(0, "jual", "USD", 50, 16650, "Arif");

  const byMonth = {};
  trades.forEach((t) => {
    const month = t.date.slice(0, 7);
    (byMonth[month] = byMonth[month] || []).push(t);
  });
  return {
    rates: { EGP: { sell: 345, buy: 338 }, USD: { sell: 16650, buy: 16300 } },
    trades: byMonth,
    demo: true,
  };
}

// Sample titipan: two investors (rupiah in SeaBank), two workers (salary in pounds, one asked
// for part of it in rupiah) and one dollar deposit.
function depositSample() {
  const people = [
    ["dep-demo-hasan", "Pak Hasan", "investor", "Modal usaha"],
    ["dep-demo-aisyah", "Bu Aisyah", "investor", ""],
    ["dep-demo-rizki", "Rizki", "pekerja", "Kerja di restoran Nasr City"],
    ["dep-demo-fadli", "Fadli", "pekerja", ""],
    ["dep-demo-yusuf", "Om Yusuf", "lainnya", "Titip dollar"],
  ].map(([id, name, kind, note], i) => ({ id, name, kind, phone: "", note, demo: true, createdAt: Date.UTC(2026, 0, 1) + i }));
  const moves = [];
  const trades = [];
  let order = 100;
  const add = (daysAgo, personId, type, currency, amount, extra = {}) => {
    const id = `dep-demo-m${++order}`;
    const move = { id, personId, type, currency, amount, rate: 0, idr: 0, date: jakartaDate(-daysAgo), bankKey: currency === "IDR" ? "seabank" : "", bankDelta: 0, tradeId: "", note: "", demo: true, createdAt: Date.UTC(2026, 0, 1) + order * 60000, ...extra };
    if (type === "kirim") {
      move.bankKey = "seabank";
      move.tradeId = `fx-demo-${id}`;
      trades.push({ id: move.tradeId, type: "beli", date: move.date, currency, qty: amount, rate: move.rate, idr: move.idr, customer: "Rizki", note: "Dari titipan · kirim rupiah", bankKey: "seabank", bankDelta: 0, linked: id, demo: true, createdAt: move.createdAt });
    }
    moves.push(move);
  };
  add(13, "dep-demo-hasan", "setor", "IDR", 15000000);
  add(12, "dep-demo-yusuf", "setor", "USD", 500);
  add(11, "dep-demo-rizki", "setor", "EGP", 2000, { note: "Gaji Oktober" });
  add(9, "dep-demo-aisyah", "setor", "IDR", 10000000);
  add(7, "dep-demo-fadli", "setor", "EGP", 1200, { note: "Gaji" });
  add(5, "dep-demo-hasan", "setor", "IDR", 5000000);
  add(4, "dep-demo-yusuf", "ambil", "USD", 100);
  add(3, "dep-demo-rizki", "setor", "EGP", 2000, { note: "Gaji November" });
  add(2, "dep-demo-rizki", "kirim", "EGP", 1500, { rate: 338, idr: 507000, note: "Kirim ke ibu di Jakarta" });
  const idrIn = moves.filter((m) => m.currency === "IDR").reduce((s, m) => s + (m.type === "setor" ? m.amount : -m.amount), 0);
  const idrOut = moves.filter((m) => m.type === "kirim").reduce((s, m) => s + m.idr, 0);
  return { deposits: { people, moves }, trades, seabankChange: idrIn - idrOut };
}

const SEEDS = {
  ziaud: [{
    id: "ziaud-contoh-v1",
    apply(state) {
      const exchange = state.exchange && typeof state.exchange === "object" ? state.exchange : null;
      const hasTrades = exchange && Object.values(exchange.trades || {}).some((list) => Array.isArray(list) && list.length);
      if (hasTrades) return null; // real data already there: leave it alone
      const balances = state.bankBalances && typeof state.bankBalances === "object" ? state.bankBalances : {};
      return {
        ...state,
        exchange: exchangeSample(),
        bankBalances: { ...balances, seabank: Number(balances.seabank) || 8450000 },
        bankBalancesUpdatedAt: state.bankBalancesUpdatedAt || jakartaDate(0),
      };
    },
  }, {
    // Titipan sample, added only while the first sample is still there (not cleared) and the
    // account has no titipan of its own yet.
    id: "ziaud-titipan-contoh-v1",
    apply(state) {
      const exchange = state.exchange && typeof state.exchange === "object" ? state.exchange : null;
      if (!exchange || exchange.demo !== true) return null;
      if (exchange.deposits && Array.isArray(exchange.deposits.people) && exchange.deposits.people.length) return null;
      const sample = depositSample();
      const trades = { ...(exchange.trades || {}) };
      sample.trades.forEach((t) => {
        const month = t.date.slice(0, 7);
        trades[month] = (Array.isArray(trades[month]) ? trades[month] : []).concat(t);
      });
      const balances = state.bankBalances && typeof state.bankBalances === "object" ? state.bankBalances : {};
      return {
        ...state,
        exchange: { ...exchange, trades, deposits: sample.deposits },
        bankBalances: { ...balances, seabank: (Number(balances.seabank) || 0) + sample.seabankChange },
      };
    },
  }],
};

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
    const next = seed.apply(current);
    current = { ...(next || current), appliedMigrations: [...applied, seed.id] };
    changed = true;
  });
  return changed ? current : null;
}

module.exports = { applySeed };
