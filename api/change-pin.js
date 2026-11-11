// "Ganti PIN" from the dashboard: needs the current session and the current PIN. The new PIN
// is stored hashed in Redis (see _session.js) and works for the next login on every device.
const { sessionUser, requestWorkspace, verifyPin, savePin, redisCommand } = require("./_session");
const { getWorkspace } = require("./_workspaces");

const MAX_FAILURES = 5;
const LOCK_SECONDS = 15 * 60;

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"] || "";
  return forwarded.split(",")[0].trim() || (req.socket && req.socket.remoteAddress) || "unknown";
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const ws = requestWorkspace(req);
    const who = sessionUser(req, ws);
    if (!who) return res.status(401).json({ error: "Sesi habis. Masuk lagi dulu." });
    // Each person on an account changes only their own PIN.
    const user = who === "owner" ? null : who;
    const workspace = ws ? getWorkspace(ws) : null;
    if (workspace && workspace.open) {
      return res.status(403).json({ error: "Akun ini belum pakai PIN." });
    }
    if (workspace && workspace.pin) {
      return res.status(403).json({ error: "PIN akun demo tidak bisa diganti." });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const current = String(body.current || "");
    const next = String(body.next || "");
    if (next.length < 6 || next.length > 32) return res.status(400).json({ error: "PIN baru minimal 6 dan maksimal 32 karakter." });
    if (!/^\S+$/.test(next)) return res.status(400).json({ error: "PIN baru tidak boleh berisi spasi." });
    if (next === current) return res.status(400).json({ error: "PIN baru harus beda dari PIN lama." });

    const key = `dar-invoices:pin-change-fail:${ws || "dar"}${user ? `:${user}` : ""}:${clientIp(req)}`;
    const failures = Number(await redisCommand(["GET", key]).catch(() => 0)) || 0;
    if (failures >= MAX_FAILURES) return res.status(429).json({ error: "Terlalu banyak percobaan. Coba lagi 15 menit lagi." });

    if (!(await verifyPin(current, ws, user))) {
      try {
        await redisCommand(["INCR", key]);
        await redisCommand(["EXPIRE", key, LOCK_SECONDS]);
      } catch (e) {}
      await new Promise((resolve) => setTimeout(resolve, 600));
      return res.status(400).json({ error: "PIN lama salah." });
    }

    await savePin(ws, next, user);
    try { await redisCommand(["DEL", key]); } catch (e) {}
    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "Gagal mengganti PIN. Coba lagi." });
  }
};
