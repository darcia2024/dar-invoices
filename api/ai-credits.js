// How much OpenRouter credit is left, for the owner's own dashboard (/dar) only — tenants share
// this OpenRouter account and must not see it. The account balance needs a management key
// (OPENROUTER_MANAGEMENT_KEY, made under openrouter.ai Settings → Management keys); the usage of
// the key the assistant uses comes from the normal OPENROUTER_API_KEY.
const { hasValidSession, requestWorkspace } = require("./_session");
const { readAiUsage } = require("./_ai-usage");

async function getJson(url, key) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: controller.signal });
    const body = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data: body && body.data };
  } finally {
    clearTimeout(timer);
  }
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  let wsSlug = null;
  try { wsSlug = requestWorkspace(req); } catch (e) { wsSlug = "?"; }
  if (wsSlug) return res.status(404).json({ error: "Not found" });
  if (!hasValidSession(req, null)) return res.status(401).json({ error: "Unauthorized" });

  const apiKey = process.env.OPENROUTER_API_KEY;
  const mgmtKey = process.env.OPENROUTER_MANAGEMENT_KEY;
  if (!apiKey && !mgmtKey) return res.status(503).json({ error: "OPENROUTER_API_KEY belum diatur." });

  try {
    const [credits, key] = await Promise.all([
      mgmtKey ? getJson("https://openrouter.ai/api/v1/credits", mgmtKey) : null,
      apiKey ? getJson("https://openrouter.ai/api/v1/key", apiKey) : null,
    ]);
    const out = { needsManagementKey: !mgmtKey };
    if (credits && credits.ok && credits.data) {
      const total = num(credits.data.total_credits);
      const used = num(credits.data.total_usage);
      if (total !== null && used !== null) Object.assign(out, { remaining: Math.max(0, total - used), totalCredits: total, totalUsage: used });
    } else if (credits) {
      out.creditsError = credits.status === 401 || credits.status === 403 ? "Management key ditolak OpenRouter." : "Gagal ambil saldo dari OpenRouter.";
    }
    if (key && key.ok && key.data) {
      Object.assign(out, {
        usageToday: num(key.data.usage_daily),
        usageWeek: num(key.data.usage_weekly),
        usageMonth: num(key.data.usage_monthly),
        keyLimitRemaining: num(key.data.limit_remaining),
      });
    }
    if (req.query && req.query.report) {
      // Whole OpenRouter account per day (last 30 finished UTC days, every app on the account)…
      if (mgmtKey) {
        const act = await getJson("https://openrouter.ai/api/v1/activity", mgmtKey);
        if (act.ok && Array.isArray(act.data)) {
          const days = {};
          act.data.forEach((row) => {
            const date = String(row.date || row.day || "").slice(0, 10);
            if (!date) return;
            const cost = num(row.usage) ?? num(row.cost) ?? 0;
            const d = (days[date] = days[date] || { date, cost: 0, requests: 0, models: {} });
            d.cost += cost;
            d.requests += num(row.requests) || 0;
            const model = String(row.model || row.model_permaslug || "lainnya");
            d.models[model] = (d.models[model] || 0) + cost;
          });
          out.accountDays = Object.values(days)
            .sort((a, b) => b.date.localeCompare(a.date))
            .map((d) => ({ ...d, models: Object.entries(d.models).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([model, cost]) => ({ model, cost })) }));
        } else {
          out.activityError = act.status === 403 ? "Management key belum boleh baca aktivitas." : "Gagal ambil aktivitas dari OpenRouter.";
        }
      }
      // …and this dashboard's own calls per day and per account (recorded since this feature).
      out.dashboardDays = await readAiUsage(30);
    }
    return res.status(200).json(out);
  } catch (error) {
    console.error("ai-credits failed:", error);
    return res.status(502).json({ error: "Gagal menghubungi OpenRouter." });
  }
};
