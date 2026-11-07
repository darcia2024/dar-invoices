const { createSessionCookie, pinMatches, redisCommand } = require("./_session");

const MAX_FAILURES = 8;
const LOCK_SECONDS = 15 * 60;

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"] || "";
  return forwarded.split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
}

// Failed attempts are counted per IP in Upstash; if Upstash is down we still answer, just without the lockout.
async function failureCount(key) {
  try {
    return Number(await redisCommand(["GET", key])) || 0;
  } catch (e) {
    return 0;
  }
}

async function recordFailure(key) {
  try {
    await redisCommand(["INCR", key]);
    await redisCommand(["EXPIRE", key, LOCK_SECONDS]);
  } catch (e) {}
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const key = `dar-invoices:login-fail:${clientIp(req)}`;
    if ((await failureCount(key)) >= MAX_FAILURES) {
      return res.status(429).json({ error: "Terlalu banyak percobaan. Coba lagi 15 menit lagi." });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    if (!pinMatches(body.pin)) {
      await recordFailure(key);
      await new Promise((resolve) => setTimeout(resolve, 600));
      return res.status(401).json({ error: "PIN belum sesuai. Coba lagi." });
    }

    try { await redisCommand(["DEL", key]); } catch (e) {}
    res.setHeader("Set-Cookie", createSessionCookie());
    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message || "Login gagal" });
  }
};
