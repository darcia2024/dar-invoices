const { createSessionCookie, verifyPin, findPinUser, redisCommand } = require("./_session");
const { getWorkspace } = require("./_workspaces");

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
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    // A separate account logs in with { workspace: "<slug>" }; without it this is the DAR login.
    let ws = null;
    if (body.workspace) {
      const found = getWorkspace(body.workspace);
      if (!found) return res.status(404).json({ error: "Akun tidak ditemukan." });
      ws = found.slug;
    }

    const key = `dar-invoices:login-fail:${ws ? `${ws}:` : ""}${clientIp(req)}`;
    if ((await failureCount(key)) >= MAX_FAILURES) {
      return res.status(429).json({ error: "Terlalu banyak percobaan. Coba lagi 15 menit lagi." });
    }

    // A separate account can have more than one person (owner + users), each with their own PIN.
    const user = ws ? await findPinUser(body.pin, ws) : ((await verifyPin(body.pin, null)) ? "owner" : null);
    if (!user) {
      await recordFailure(key);
      await new Promise((resolve) => setTimeout(resolve, 600));
      return res.status(401).json({ error: "PIN belum sesuai. Coba lagi." });
    }

    try { await redisCommand(["DEL", key]); } catch (e) {}
    res.setHeader("Set-Cookie", createSessionCookie(ws, user === "owner" ? null : user));
    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message || "Login gagal" });
  }
};
