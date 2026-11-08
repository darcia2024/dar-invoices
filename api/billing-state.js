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
    "talkhisan-hamasah": 2100000,
  },
};

// One-time status corrections applied to the saved cloud state (each id runs once,
// so later manual toggles in the dashboard are kept).
const STATUS_MIGRATIONS = [
  { id: "2026-11-08-hamasah-lunas", statuses: { hamasahinternational: "PAID" } },
];

function applyMigrations(state) {
  const applied = Array.isArray(state.appliedMigrations) ? state.appliedMigrations : [];
  const pending = STATUS_MIGRATIONS.filter((m) => !applied.includes(m.id));
  if (pending.length === 0) return { state, changed: false };
  const paymentStatuses = { ...(state.paymentStatuses || {}) };
  pending.forEach((m) => Object.assign(paymentStatuses, m.statuses));
  return {
    state: { ...state, paymentStatuses, appliedMigrations: [...applied, ...pending.map((m) => m.id)] },
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
