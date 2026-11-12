// Phone notifications for one account: the dashboard subscribes a device here (after the user
// allows notifications), can switch it off, and can send itself a test.
const { sessionUser, requestWorkspace } = require("./_session");
const { VAPID_PUBLIC_KEY, saveSubscription, removeSubscription, sendPush, validSubscription } = require("./_push");
const { getWorkspace } = require("./_workspaces");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const ws = requestWorkspace(req);
    const who = sessionUser(req, ws);
    if (!who) return res.status(401).json({ error: "Sesi habis. Masuk lagi dulu." });

    if (req.method === "GET") return res.status(200).json({ publicKey: VAPID_PUBLIC_KEY });
    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const sub = body.subscription;
    if (!validSubscription(sub)) return res.status(400).json({ error: "Data notifikasi dari browser tidak lengkap." });

    if (body.action === "unsubscribe") {
      await removeSubscription(ws, sub.endpoint);
      return res.status(200).json({ ok: true });
    }
    if (body.action === "subscribe") {
      const account = ws ? getWorkspace(ws) : null;
      const person = who === "owner" ? (account ? account.owner || account.name : "DAR") : ((account && (account.users || []).find((u) => u.id === who)) || {}).name || who;
      await saveSubscription(ws, sub, person, who);
      return res.status(200).json({ ok: true });
    }
    if (body.action === "test") {
      const status = await sendPush(sub, {
        title: "Notifikasi aktif",
        body: "Pengingat jatuh tempo talangan bakal muncul di HP ini tiap pagi.",
        url: ws ? `/${ws}` : "/dar",
        tag: "dar-test",
      });
      if (status === 404 || status === 410) {
        await removeSubscription(ws, sub.endpoint);
        return res.status(410).json({ error: "Langganan notifikasi di HP ini sudah tidak berlaku. Nyalakan lagi." });
      }
      if (status < 200 || status >= 300) return res.status(502).json({ error: `Layanan notifikasi menolak (${status}).` });
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: "Aksi tidak dikenal." });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "Notifikasi gagal. Coba lagi." });
  }
};
