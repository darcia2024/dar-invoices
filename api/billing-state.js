const { hasValidSession, redisCommand } = require("./_session");

const STATE_KEY = "dar-invoices:billing-state";

const defaultDebts = [
  {
    id: "debt-teh-umi",
    type: "piutang",
    name: "Teh Umi",
    phone: "",
    amount: 200000,
    paid: 100000,
    date: "2026-09-09",
    due: "",
    notes: "Project bikin Website (Pembayaran masuk Rp 100.000 tgl 10 Sep 2026)",
    createdAt: 1788950000000,
    updatedAt: 1789014120000
  },
  {
    id: "debt-vendra",
    type: "piutang",
    name: "Vendra",
    phone: "",
    amount: 250000,
    paid: 0,
    date: "2026-09-09",
    due: "",
    notes: "Membetulkan handphone (Service HP)",
    createdAt: 1788951000000
  },
  {
    id: "debt-azzam",
    type: "hutang",
    name: "Azzam",
    phone: "",
    amount: 145000,
    paid: 0,
    date: "2026-09-09",
    due: "",
    notes: "Bayar rumah di Mesir bulan September",
    createdAt: 1788952000000
  }
];

const defaultState = {
  debts: defaultDebts,
  paymentStatuses: {
    almadroj: "UNPAID",
    markaz: "PAID",
    dreammecca: "PAID",
    "haramain-capture": "PAID",
    abdurrahman: "PAID",
    qohiroh: "UNPAID",
    zaky: "UNPAID",
    sidi: "UNPAID",
    umiatiyah: "UNPAID",
    kolohaga: "UNPAID",
    zalvice: "UNPAID",
    azhariyah: "PAID",
    "azhariyah-pelunasan": "UNPAID",
    barber: "PAID",
    saudia: "UNPAID",
    tehumi: "PAID",
    "tehumi-pelunasan": "DP",
    pgstour: "UNPAID",
    "umrahme-dreammecca": "UNPAID",
    mochi: "UNPAID",
    athifa: "UNPAID",
    kpi: "PAID",
    "kpi-pelunasan": "UNPAID",
    oslo: "UNPAID",
    elmassa: "UNPAID",
    masdaus: "UNPAID",
    "umrahme-dreammecca-oktober": "UNPAID",
    bangedo: "UNPAID",
    erna: "UNPAID",
    "underrated-ai": "UNPAID",
    masakbar: "UNPAID",
    masakbar2: "UNPAID",
    "talkhisan-hamasah": "UNPAID",
    hamasahinternational: "PAID",
  },
  dpAmounts: {
    tehumi: 100000,
    "tehumi-pelunasan": 100000,
    kpi: 7100000,
    hamasahinternational: 7500000,
  },
  netProfits: {
    almadroj: 3500000,
    markaz: 5500000,
    dreammecca: 350000,
    "haramain-capture": 600000,
    abdurrahman: 1460690,
    qohiroh: 9500000,
    zaky: 600000,
    sidi: 1000000,
    umiatiyah: 2200000,
    kolohaga: 700000,
    zalvice: 1200000,
    azhariyah: 3000000,
    "azhariyah-pelunasan": 4000000,
    barber: 6000000,
    saudia: 39600000,
    pgstour: 1000000,
    "umrahme-dreammecca": 280000,
    mochi: 600000,
    athifa: 250000,
    kpi: 7000000,
    "kpi-pelunasan": 7000000,
    tehumi: 100000,
    "tehumi-pelunasan": 200000,
    oslo: 1500000,
    elmassa: 1940000,
    masdaus: 75000,
    "umrahme-dreammecca-oktober": 367500,
    bangedo: 350000,
    erna: 500000,
    "underrated-ai": 450000,
    masakbar: 100000,
    masakbar2: 50000,
    "talkhisan-hamasah": 1200000,
  },
};

// One-time status corrections applied to the saved cloud state (each id runs once,
// so later manual toggles in the dashboard are kept).
const PLAN_SEED_TIME = Date.UTC(2026, 10, 5);
function seedPlan(id, name, category, planned, { paid = false, recurring = false, notes = "" } = {}, order = 0) {
  const t = PLAN_SEED_TIME + order;
  return { id, name, category, planned, actual: paid ? planned : 0, done: paid, recurring, due: "", notes, createdAt: t, updatedAt: t };
}

// Rencana pengeluaran November 2026 (update per 5 Nov). Open items keep their priority order.
const NOVEMBER_2026_PLAN = [
  seedPlan("plan-nov26-voa", "VOA Mesir", "lainnya", 7830000, { notes: "Prioritas 1 · $435 × Rp18.000" }, 1),
  seedPlan("plan-nov26-hutang-azam", "Hutang ke Azam", "cicilan", 500000, { notes: "Prioritas 2" }, 2),
  seedPlan("plan-nov26-harian", "Kebutuhan sehari-hari", "pokok", 5000000, { recurring: true, notes: "Prioritas 3" }, 3),
  seedPlan("plan-nov26-sakhona", "Sakhona / pemanas air", "rumah", 1200000, { notes: "Prioritas 4" }, 4),
  seedPlan("plan-nov26-kasur", "Kasur", "rumah", 1600000, { notes: "Prioritas 5" }, 5),
  seedPlan("plan-nov26-lemari", "Lemari", "rumah", 1000000, { notes: "Prioritas 6" }, 6),
  seedPlan("plan-nov26-kulkas", "Kulkas (6.000 LE)", "rumah", 2070000, { notes: "Prioritas 7 · Ditunda sampai KPI cair" }, 7),
  seedPlan("plan-nov26-syaqqoh", "Syaqqoh November", "pokok", 2800000, { paid: true, recurring: true }, 8),
  seedPlan("plan-nov26-uang-istri", "Uang istri", "keluarga", 1500000, { paid: true, recurring: true }, 9),
  seedPlan("plan-nov26-stroller", "Stroller", "keluarga", 2200000, { paid: true }, 10),
];

// One-time corrections applied to the saved cloud state (each id runs once,
// so later manual changes in the dashboard are kept).
const STATUS_MIGRATIONS = [
  { id: "2026-11-08-hamasah-lunas", statuses: { hamasahinternational: "PAID" } },
  { id: "2026-11-08-rencana-november", expensePlans: { "2026-11": NOVEMBER_2026_PLAN } },
  // Talkhisan Hamasah repriced to Rp200.000 per modul × 6 = Rp1.200.000 (no operating cost).
  { id: "2026-11-08-talkhisan-200rb", netProfits: { "talkhisan-hamasah": 1200000 } },
];

function applyMigrations(state) {
  const applied = Array.isArray(state.appliedMigrations) ? state.appliedMigrations : [];
  const pending = STATUS_MIGRATIONS.filter((m) => !applied.includes(m.id));
  if (pending.length === 0) return { state, changed: false };
  const paymentStatuses = { ...(state.paymentStatuses || {}) };
  const netProfits = { ...(state.netProfits || {}) };
  const currentPlans = state.expensePlans && typeof state.expensePlans === "object" && !Array.isArray(state.expensePlans) ? state.expensePlans : {};
  const expensePlans = { ...currentPlans };
  pending.forEach((m) => {
    if (m.statuses) Object.assign(paymentStatuses, m.statuses);
    if (m.netProfits) Object.assign(netProfits, m.netProfits);
    // Add plan items without touching ones already there (matched by id or name).
    Object.entries(m.expensePlans || {}).forEach(([month, items]) => {
      const existing = Array.isArray(expensePlans[month]) ? expensePlans[month] : [];
      const ids = new Set(existing.map((p) => p && p.id));
      const names = new Set(existing.map((p) => String((p && p.name) || "").trim().toLowerCase()));
      const additions = items.filter((p) => !ids.has(p.id) && !names.has(p.name.toLowerCase()));
      expensePlans[month] = existing.concat(additions);
    });
  });
  return {
    state: { ...state, paymentStatuses, netProfits, expensePlans, appliedMigrations: [...applied, ...pending.map((m) => m.id)] },
    changed: true,
  };
}

function mergeState(state) {
  return {
    appliedMigrations: state && Array.isArray(state.appliedMigrations) ? state.appliedMigrations : [],
    customInvoices: state && Array.isArray(state.customInvoices) ? state.customInvoices : [],
    deletedInvoiceIds: state && Array.isArray(state.deletedInvoiceIds) ? state.deletedInvoiceIds : [],
    purgedInvoiceIds: state && Array.isArray(state.purgedInvoiceIds) ? state.purgedInvoiceIds : [],
    // An empty list is the user's choice; only seed the defaults when debts were never saved.
    debts: state && Array.isArray(state.debts) ? state.debts : defaultDebts,
    bankBalances: state && state.bankBalances && typeof state.bankBalances === "object" ? state.bankBalances : null,
    bankBalancesUpdatedAt: state && typeof state.bankBalancesUpdatedAt === "string" ? state.bankBalancesUpdatedAt : null,
    bankAccountDetails: state && state.bankAccountDetails && typeof state.bankAccountDetails === "object" ? state.bankAccountDetails : null,
    bankCopyTemplate: state && typeof state.bankCopyTemplate === "string" ? state.bankCopyTemplate : null,
    // { [invoiceId]: [{ month: "YYYY-MM", amount, date }] } — the month each payment arrived.
    // { "YYYY-MM": [{ id, name, category, planned, actual, done, due, notes }] } — monthly spending plan.
    // [{ id, name, date, destination, categories: [{ id, name, color }], items: [{ id, name, qty, packed, categoryId, note }] }]
    // { "YYYY-MM": [{ id, date, amount, posId, note, merchant, source, createdAt }] } — daily spending log.
    expenseLogs: state && state.expenseLogs && typeof state.expenseLogs === "object" && !Array.isArray(state.expenseLogs) ? state.expenseLogs : {},
    packingLists: state && Array.isArray(state.packingLists) ? state.packingLists : [],
    expensePlans: state && state.expensePlans && typeof state.expensePlans === "object" && !Array.isArray(state.expensePlans) ? state.expensePlans : {},
    // Months whose routine plan items were already carried over automatically.
    planSeededMonths: state && Array.isArray(state.planSeededMonths) ? state.planSeededMonths.filter((m) => /^\d{4}-\d{2}$/.test(m)) : [],
    paymentLog: state && state.paymentLog && typeof state.paymentLog === "object" && !Array.isArray(state.paymentLog) ? state.paymentLog : {},
    paymentStatuses: {
      ...defaultState.paymentStatuses,
      ...(state && state.paymentStatuses ? state.paymentStatuses : {}),
    },
    dpAmounts: {
      ...defaultState.dpAmounts,
      ...(state && state.dpAmounts ? state.dpAmounts : {}),
    },
    netProfits: {
      ...defaultState.netProfits,
      ...(state && state.netProfits ? state.netProfits : {}),
    },
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  try {
    if (!hasValidSession(req)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (req.method === "GET") {
      const saved = await redisCommand(["GET", STATE_KEY]);
      const parsed = saved ? JSON.parse(saved) : null;
      if (parsed) {
        const { state: migrated, changed } = applyMigrations(parsed);
        if (changed) {
          const merged = mergeState(migrated);
          await redisCommand(["SET", STATE_KEY, JSON.stringify(merged)]);
          return res.status(200).json(merged);
        }
      }
      return res.status(200).json(mergeState(parsed));
    }

    if (req.method === "PUT" || req.method === "POST") {
      const incoming = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const saved = await redisCommand(["GET", STATE_KEY]);
      const previous = saved ? JSON.parse(saved) : {};
      const state = mergeState({ ...previous, ...incoming });
      await redisCommand(["SET", STATE_KEY, JSON.stringify(state)]);
      return res.status(200).json(state);
    }

    res.setHeader("Allow", "GET, PUT, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ error: error.message || "Billing state request failed" });
  }
};
