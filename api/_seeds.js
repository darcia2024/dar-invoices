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

// "Uang orang" from Ziaud's notebook (page dated 9/10), confirmed by Daru on 2026-11-11. The
// list holds other people's names and money, and this repo is public, so it lives in the
// Vercel env var ZIAUD_TITIPAN_BUKU, as JSON: [["Name", "IDR" | "EGP" | "USD", amount, "note"]].
// Pound amounts stay in pounds (the rupiah written next to them goes in the note). No bank is
// moved: this money is already inside his balances. Until the env var is set the seed waits.
function notebookTitipan() {
  try {
    const list = JSON.parse(process.env.ZIAUD_TITIPAN_BUKU || "null");
    if (!Array.isArray(list)) return null;
    return list.filter((row) => Array.isArray(row) && String(row[0] || "").trim() && ["IDR", "EGP", "USD"].includes(row[1]) && Number(row[2]) > 0)
      .map(([name, currency, amount, note]) => [String(name).trim().slice(0, 80), currency, Number(amount), String(note || "").slice(0, 100)]);
  } catch (e) {
    return null;
  }
}

function withNotebookTitipan(state) {
  const list = notebookTitipan() || [];
  const exchange = state.exchange && typeof state.exchange === "object" ? state.exchange : {};
  const deposits = exchange.deposits && typeof exchange.deposits === "object" ? exchange.deposits : {};
  const people = Array.isArray(deposits.people) ? deposits.people.slice() : [];
  const moves = Array.isArray(deposits.moves) ? deposits.moves.slice() : [];
  const taken = new Set(people.map((p) => String(p.name || "").toLowerCase()));
  list.forEach(([name, currency, amount, note], i) => {
    if (taken.has(name.toLowerCase())) return; // already entered by hand
    const id = `dep-buku-${i + 1}`;
    const createdAt = Date.UTC(2026, 9, 9) + i * 60000;
    people.push({ id, name, kind: "lainnya", phone: "", note: "", createdAt });
    moves.push({ id: `${id}-m`, personId: id, type: "setor", currency, amount, rate: 0, idr: 0, date: "2026-10-09", bankKey: "", bankDelta: 0, tradeId: "", note: note ? `Dari catatan buku 9/10 · ${note}` : "Dari catatan buku 9/10", createdAt });
  });
  return { ...state, exchange: { ...exchange, deposits: { people, moves } } };
}

const SEEDS = {
  ziaud: [
    { id: "ziaud-bersih-v1", apply: withoutDemo },
    // ready: not marked as applied (so it runs later) while the env var is missing.
    { id: "ziaud-titipan-buku-v1", apply: withNotebookTitipan, ready: () => Boolean(notebookTitipan()) },
  ],
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
    if (seed.ready && !seed.ready()) return;
    const next = seed.apply(current);
    current = { ...(next || current), appliedMigrations: [...applied, seed.id] };
    changed = true;
  });
  return changed ? current : null;
}

module.exports = { applySeed, withoutDemo };
