const STATE_KEY = "dar-invoices:billing-state";

const defaultDebts = [
  {
    id: "debt-teh-umi",
    type: "piutang",
    name: "Teh Umi",
    phone: "",
    amount: 200000,
    paid: 0,
    date: "2026-09-09",
    due: "",
    notes: "Project bikin Website",
    createdAt: 1788950000000
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
    azhariyah: "UNPAID",
    barber: "UNPAID",
    saudia: "UNPAID",
    pgstour: "UNPAID",
  },
  dpAmounts: {},
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
    azhariyah: 7000000,
    barber: 6000000,
    saudia: 39600000,
    pgstour: 1000000,
  },
};

function mergeState(state) {
  return {
    customInvoices: state && Array.isArray(state.customInvoices) ? state.customInvoices : [],
    deletedInvoiceIds: state && Array.isArray(state.deletedInvoiceIds) ? state.deletedInvoiceIds : [],
    debts: state && Array.isArray(state.debts) && state.debts.length > 0 ? state.debts : defaultDebts,
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

async function redisCommand(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    const error = new Error("Upstash env vars are not configured");
    error.statusCode = 503;
    throw error;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });

  if (!response.ok) {
    const error = new Error(`Upstash request failed with ${response.status}`);
    error.statusCode = 502;
    throw error;
  }

  const payload = await response.json();
  if (payload.error) {
    const error = new Error(payload.error);
    error.statusCode = 502;
    throw error;
  }

  return payload.result;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  try {
    const adminPasscode = process.env.ADMIN_PASSCODE || "050900";
    if (req.headers["x-admin-passcode"] !== adminPasscode) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (req.method === "GET") {
      const saved = await redisCommand(["GET", STATE_KEY]);
      const parsed = saved ? JSON.parse(saved) : null;
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
