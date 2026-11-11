// One-time changes to an account's saved data, applied by api/billing-state.js on load (the id
// is kept in appliedMigrations, so each runs once).
//
// Ziaud first got sample data (seeds "ziaud-contoh-v1" and "ziaud-titipan-contoh-v1": demo
// trades, kurs, titipan people and a sample SeaBank balance, all marked demo: true). On
// 2026-11-11 the owner asked to drop it: "ziaud-bersih-v1" removes everything marked demo, the
// same as the "Hapus data contoh" button in exchange.js.
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

const SEEDS = {
  ziaud: [{ id: "ziaud-bersih-v1", apply: withoutDemo }],
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

module.exports = { applySeed, withoutDemo };
