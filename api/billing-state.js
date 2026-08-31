const STATE_KEY = "dar-invoices:billing-state";

const defaultState = {
  paymentStatuses: {
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
    barber: "DP",
    saudia: "UNPAID",
  },
  dpAmounts: {
    barber: 3000000,
  },
  netProfits: {
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
  },
};

function mergeState(state) {
  return {
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
      const state = mergeState(incoming);
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
