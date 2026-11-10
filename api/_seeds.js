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

const SEEDS = {
  ziaud: {
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
  },
};

// Returns the seeded state, or null when nothing applies.
function applySeed(ws, state) {
  const seed = SEEDS[ws];
  if (!seed) return null;
  const applied = Array.isArray(state.appliedMigrations) ? state.appliedMigrations : [];
  if (applied.includes(seed.id)) return null;
  const next = seed.apply(state);
  return { ...(next || state), appliedMigrations: [...applied, seed.id] };
}

module.exports = { applySeed };
