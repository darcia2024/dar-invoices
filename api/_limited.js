// A "limited" person on an account (users[].limited in _workspaces.js) only enters records and
// sees their own daily report. Nothing else of the account leaves the server for them, and
// what they save can only add, change or remove their own records.
//
// Their records: exchange.deals, exchange.incomes and expenseLogs entries with by === their name.
// The money those records move (banks, places in Aset) is applied here on the server, from the
// record itself, so the real balances stay right without the limited person ever seeing them.

const list = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const num = (v) => Number(v) || 0;
const round2 = (n) => Math.round(n * 100) / 100;

function limitedUser(ws, who) {
  if (!ws || !who || who === "owner") return null;
  const user = list(ws.users).find((u) => u.id === who);
  return user && user.limited ? user : null;
}

// What a limited person receives: their own records, the names of banks and places (no amounts),
// the kurs they need to fill a form (no kurs modal), and the date of the last "Update saldo".
function limitedView(state, name) {
  const ex = obj(state.exchange);
  const mine = (x) => x && x.by === name;
  // A pound/dollar record's rupiah value would give the kurs modal away: sent without it.
  const hideRate = (x) => (isForeign(x) ? { ...x, amount: 0, rate: 0 } : x);
  const expenseLogs = {};
  Object.entries(obj(state.expenseLogs)).forEach(([month, items]) => {
    const own = list(items).filter(mine).map(hideRate);
    if (own.length) expenseLogs[month] = own;
  });
  const zeroBanks = Object.fromEntries(Object.keys(obj(state.bankBalances)).map((k) => [k, 0]));
  return {
    limited: true,
    appliedMigrations: list(state.appliedMigrations),
    customInvoices: [],
    deletedInvoiceIds: [],
    purgedInvoiceIds: [],
    debts: [],
    bankBalances: zeroBanks,
    bankBalancesUpdatedAt: state.bankBalancesUpdatedAt || null,
    bankAccountDetails: {},
    bankCopyTemplate: null,
    invoiceSignature: null,
    expenseLogs,
    packingLists: [],
    expensePlans: {},
    planSeededMonths: list(state.planSeededMonths),
    paymentLog: {},
    paymentStatuses: {},
    dpAmounts: {},
    netProfits: {},
    exchange: {
      rates: obj(ex.rates),
      buyRates: obj(ex.buyRates),
      crossRates: obj(ex.crossRates),
      assetRates: {},
      // The owner's own places only (names, no amounts); pockets other people hold stay private.
      holdings: list(ex.holdings).filter((h) => h.kind !== "orang").map((h) => ({ id: h.id, label: h.label, currency: h.currency, amount: 0 })),
      deals: list(ex.deals).filter(mine).map((d) => ({ ...d, modal: 0, modal2: 0 })),
      incomes: list(ex.incomes).filter(mine).map(hideRate),
      deposits: { people: [], moves: [] },
      assetHistory: {},
      assetDaily: {},
      trades: {},
      demo: false,
    },
  };
}

// The money a record moves, worked out on the server from the record (never trusted from the
// browser). A record dated before the last "Update saldo" is already inside those balances.
function dealEffect(d, state) {
  const ex = obj(state.exchange);
  const counts = !(state.bankBalancesUpdatedAt && d.date < state.bankBalancesUpdatedAt);
  const isBank = (k) => Object.prototype.hasOwnProperty.call(obj(state.bankBalances), k);
  const isPlace = (id) => list(ex.holdings).some((h) => h.id === id);
  const dir = d.dir === "beli" || d.dir === "swap" ? d.dir : "jual";
  return {
    bankKey: isBank(d.bankKey) ? d.bankKey : "",
    bankDelta: isBank(d.bankKey) && counts ? (dir === "beli" ? -num(d.idr) : dir === "swap" ? 0 : num(d.idr)) : 0,
    holdDelta: isPlace(d.holdingId) ? (dir === "beli" ? -num(d.qty) : num(d.qty)) : 0,
    holdDelta2: dir === "swap" && isPlace(d.holdingId2) ? num(d.qty2) : 0,
  };
}

function applyDeal(state, d, sign) {
  const ex = obj(state.exchange);
  const h = list(ex.holdings).find((x) => x.id === d.holdingId);
  if (h && d.holdDelta) h.amount = round2(num(h.amount) - sign * d.holdDelta);
  const h2 = d.holdingId2 ? list(ex.holdings).find((x) => x.id === d.holdingId2) : null;
  if (h2 && d.holdDelta2) h2.amount = round2(num(h2.amount) + sign * d.holdDelta2);
  if (d.bankDelta && d.bankKey) state.bankBalances[d.bankKey] = num(state.bankBalances[d.bankKey]) + sign * d.bankDelta;
}

function bankMove(state, key, delta) {
  if (key && delta && Object.prototype.hasOwnProperty.call(state.bankBalances, key)) state.bankBalances[key] = num(state.bankBalances[key]) + delta;
}

// The parts of a record that matter; a record whose core did not change keeps its stored effect.
const dealCore = (d) => JSON.stringify([d.dir, d.date, d.name, d.currency, d.qty, d.holdingId, d.idr, d.bankKey, d.currency2, d.qty2, d.holdingId2, !!d.restock]);
// Pemasukan / pengeluaran may be rupiah (amount) or pounds/dollars (currency + fxAmount), from/to
// a bank (rupiah only) or a place in Aset (holdingId).
const isForeign = (x) => typeof x.currency === "string" && /^[A-Z]{3}$/.test(x.currency) && x.currency !== "IDR";
const moneyCur = (x) => (isForeign(x) ? x.currency : "IDR");
const moneyQty = (x) => (isForeign(x) ? round2(num(x.fxAmount)) : Math.round(num(x.amount)));
const moneyCore = (x) => [x.date, moneyCur(x), moneyQty(x), x.note || "", x.bankKey || "", x.holdingId || ""];
const incomeCore = (x) => JSON.stringify(moneyCore(x));
const logCore = (l) => JSON.stringify([...moneyCore(l), l.merchant || "", l.posId || ""]);

// The record's money fields, checked against the account: rupiah value at the owner's kurs modal,
// a bank only for rupiah, a place only if it exists and holds that currency.
function moneyClean(x, state) {
  const ex = obj(state.exchange);
  const c = isForeign(x) && Object.prototype.hasOwnProperty.call(obj(ex.assetRates), x.currency) ? x.currency : "IDR";
  const qty = c === "IDR" ? Math.round(num(x.amount)) : round2(num(x.fxAmount));
  const rate = c === "IDR" ? 0 : num(obj(ex.assetRates)[c]);
  const place = list(ex.holdings).find((h) => h.id === x.holdingId && h.currency === c);
  const bankKey = c === "IDR" && Object.prototype.hasOwnProperty.call(state.bankBalances, x.bankKey) ? x.bankKey : "";
  return {
    amount: c === "IDR" ? qty : Math.round(qty * rate),
    ...(c === "IDR" ? {} : { currency: c, fxAmount: qty, rate }),
    ...(place ? { holdingId: place.id } : {}),
    bankKey,
    qty,
  };
}

function holdMove(state, id, delta) {
  const h = id && delta ? list(obj(state.exchange).holdings).find((x) => x.id === id) : null;
  if (h) h.amount = round2(num(h.amount) + delta);
}

// Merge what a limited person saved into the full state. Returns the new full state.
function mergeLimited(previous, incoming, name) {
  const state = JSON.parse(JSON.stringify(previous || {}));
  state.exchange = obj(state.exchange);
  state.bankBalances = obj(state.bankBalances);
  const ex = state.exchange;
  const inEx = obj(incoming && incoming.exchange);
  const mine = (x) => x && x.by === name;
  const takenIds = new Set();
  [...list(ex.deals), ...list(ex.incomes), ...Object.values(obj(state.expenseLogs)).flat()].forEach((x) => { if (x && !mine(x)) takenIds.add(x.id); });
  const ownNew = (items) => list(items).filter((x) => x && typeof x.id === "string" && x.by === name && !takenIds.has(x.id));
  // No future dates (one day of slack: the account may be ahead of UTC, e.g. Cairo).
  const latest = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "") && d <= latest;

  // Tukar
  const oldDeals = new Map(list(ex.deals).filter(mine).map((d) => [d.id, d]));
  const newDeals = ownNew(inEx.deals).filter((d) => validDate(d.date) && num(d.qty) > 0).map((d) => {
    const clean = {
      id: d.id, date: d.date, name: String(d.name || "").slice(0, 80), dir: d.dir === "beli" || d.dir === "swap" ? d.dir : "jual",
      currency: String(d.currency || ""), qty: round2(num(d.qty)), holdingId: String(d.holdingId || ""),
      idr: Math.round(num(d.idr)), bankKey: String(d.bankKey || ""),
      currency2: String(d.currency2 || ""), qty2: round2(num(d.qty2)), holdingId2: String(d.holdingId2 || ""),
      restock: d.dir === "beli" && d.restock === true,
      by: name, demo: false, createdAt: num(d.createdAt) || Date.now(),
    };
    const old = oldDeals.get(d.id);
    const same = old && dealCore(old) === dealCore(clean);
    const rates = obj(ex.assetRates);
    return {
      ...clean,
      ...(same ? { bankDelta: old.bankDelta || 0, holdDelta: old.holdDelta || 0, holdDelta2: old.holdDelta2 || 0 } : dealEffect(clean, state)),
      // A restok is bought at its own kurs (no profit on it).
      modal: clean.restock && clean.idr > 0 ? clean.idr / clean.qty : old && !old.restock && old.currency === clean.currency && old.dir === clean.dir && old.modal ? old.modal : num(rates[clean.currency]),
      modal2: clean.dir === "swap" ? (old && old.currency2 === clean.currency2 && old.modal2 ? old.modal2 : num(rates[clean.currency2])) : 0,
      _same: same,
    };
  });
  const keptIds = new Set(newDeals.map((d) => d.id));
  oldDeals.forEach((d, id) => { if (!keptIds.has(id) || !newDeals.find((n) => n.id === id)._same) applyDeal(state, d, -1); });
  const changed = newDeals.filter((d) => !d._same);
  newDeals.forEach((d) => { if (!d._same) applyDeal(state, d, 1); delete d._same; });
  ex.deals = [...list(ex.deals).filter((d) => !mine(d)), ...newDeals];
  // A new or changed restok that is the newest one of its currency sets the owner's kurs modal.
  changed.filter((d) => d.restock && d.qty > 0 && d.idr > 0).forEach((d) => {
    const newer = ex.deals.some((x) => x.id !== d.id && x.restock && x.currency === d.currency && (x.date > d.date || (x.date === d.date && num(x.createdAt) > num(d.createdAt))));
    if (!newer) ex.assetRates = { ...obj(ex.assetRates), [d.currency]: d.idr / d.qty };
  });

  // Pemasukan
  const oldIncomes = new Map(list(ex.incomes).filter(mine).map((x) => [x.id, x]));
  const newIncomes = ownNew(inEx.incomes).filter((x) => validDate(x.date) && moneyQty(x) > 0).map((x) => {
    const { qty, ...money } = moneyClean(x, state);
    const clean = { id: x.id, date: x.date, ...money, note: String(x.note || "").slice(0, 160), by: name, createdAt: num(x.createdAt) || Date.now() };
    const old = oldIncomes.get(x.id);
    const same = old && incomeCore(old) === incomeCore(clean);
    const counts = !(state.bankBalancesUpdatedAt && clean.date < state.bankBalancesUpdatedAt);
    if (same) {
      // Unchanged: keeps the rupiah value and effect it already had.
      return { ...clean, amount: old.amount, ...(old.rate ? { rate: old.rate } : {}), bankAdd: old.bankAdd || 0, ...(clean.holdingId ? { holdAdd: old.holdAdd || 0 } : {}), _same: true };
    }
    return { ...clean, bankAdd: counts && clean.bankKey ? qty : 0, ...(clean.holdingId ? { holdAdd: qty } : {}), _same: false };
  }).filter((x) => moneyQty(x) > 0);
  oldIncomes.forEach((x, id) => {
    const n = newIncomes.find((y) => y.id === id);
    if (!n || !n._same) { bankMove(state, x.bankKey, -(x.bankAdd || 0)); holdMove(state, x.holdingId, -(x.holdAdd || 0)); }
  });
  newIncomes.forEach((x) => { if (!x._same) { bankMove(state, x.bankKey, x.bankAdd); holdMove(state, x.holdingId, x.holdAdd || 0); } delete x._same; });
  ex.incomes = [...list(ex.incomes).filter((x) => !mine(x)), ...newIncomes];

  // Pengeluaran (expenseLogs is per month)
  state.expenseLogs = obj(state.expenseLogs);
  const oldLogs = new Map(Object.values(state.expenseLogs).flat().filter(mine).map((l) => [l.id, l]));
  const inLogs = Object.values(obj(incoming && incoming.expenseLogs)).flat();
  const newLogs = ownNew(inLogs).filter((l) => validDate(l.date) && moneyQty(l) > 0).map((l) => {
    const { qty, ...money } = moneyClean(l, state);
    const clean = { id: l.id, date: l.date, ...money, posId: String(l.posId || "").slice(0, 80), note: String(l.note || "").slice(0, 160), merchant: String(l.merchant || "").slice(0, 80), source: String(l.source || "").slice(0, 20), by: name, createdAt: num(l.createdAt) || Date.now() };
    const old = oldLogs.get(l.id);
    const same = old && logCore(old) === logCore(clean);
    const counts = !(state.bankBalancesUpdatedAt && clean.date < state.bankBalancesUpdatedAt);
    if (same) {
      return { ...clean, amount: old.amount, ...(old.rate ? { rate: old.rate } : {}), bankCut: old.bankCut || 0, ...(clean.holdingId ? { holdCut: old.holdCut || 0 } : {}), _same: true };
    }
    return { ...clean, bankCut: counts && clean.bankKey ? qty : 0, ...(clean.holdingId ? { holdCut: qty } : {}), _same: false };
  }).filter((l) => moneyQty(l) > 0);
  oldLogs.forEach((l, id) => {
    const n = newLogs.find((y) => y.id === id);
    if (!n || !n._same) { bankMove(state, l.bankKey, l.bankCut || 0); holdMove(state, l.holdingId, l.holdCut || 0); }
  });
  newLogs.forEach((l) => { if (!l._same) { bankMove(state, l.bankKey, -l.bankCut); holdMove(state, l.holdingId, -(l.holdCut || 0)); } delete l._same; });
  Object.keys(state.expenseLogs).forEach((month) => { state.expenseLogs[month] = list(state.expenseLogs[month]).filter((l) => !mine(l)); });
  newLogs.forEach((l) => { const m = l.date.slice(0, 7); state.expenseLogs[m] = [...list(state.expenseLogs[m]), l]; });
  Object.keys(state.expenseLogs).forEach((month) => { if (!state.expenseLogs[month].length) delete state.expenseLogs[month]; });

  // The kurs a form starts from may follow their last exchange.
  if (inEx.rates) Object.entries(obj(inEx.rates)).forEach(([c, r]) => { if (obj(ex.rates)[c] && num(obj(r).sell) > 0) ex.rates[c].sell = num(r.sell); });
  if (inEx.crossRates) ex.crossRates = { ...obj(ex.crossRates), ...Object.fromEntries(Object.entries(obj(inEx.crossRates)).filter(([k, v]) => /^[A-Z]{3}-[A-Z]{3}$/.test(k) && num(v) > 0)) };
  return state;
}

module.exports = { limitedUser, limitedView, mergeLimited };
