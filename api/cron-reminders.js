// Daily (vercel.json "crons"): for every account with phones that turned notifications on,
// sends one notification listing the unpaid talangan / hutang that are due today or late.
// Vercel calls this with "Authorization: Bearer <CRON_SECRET>". Sample data (demo) is skipped,
// and an account gets at most one reminder per day.
const { redisCommand } = require("./_session");
const { listSubscriptions, sendToAccount } = require("./_push");
const { WORKSPACES } = require("./_workspaces");

function stateKey(ws) {
  return ws ? `dar-invoices:ws:${ws}:billing-state` : "dar-invoices:billing-state";
}

function todayIn(tz) {
  return new Date().toLocaleDateString("en-CA", { timeZone: tz });
}

function daysBetween(from, to) {
  const [a, b] = [from, to].map((d) => Date.UTC(...d.split("-").map((n, i) => Number(n) - (i === 1 ? 1 : 0))));
  return Math.round((b - a) / 86400000);
}

function money(amount, currency) {
  const n = Number(amount) || 0;
  return !currency || currency === "IDR" ? `Rp ${n.toLocaleString("id-ID")}` : `${n.toLocaleString("id-ID", { maximumFractionDigits: 2 })} ${currency}`;
}

// The notification for one account's data, or null when nothing is due.
function dueMessage(state, ws, today) {
  const due = (Array.isArray(state && state.debts) ? state.debts : [])
    .filter((d) => d && !d.demo && /^\d{4}-\d{2}-\d{2}$/.test(d.due || "") && (Number(d.paid) || 0) < (Number(d.amount) || 0) && d.due <= today)
    .map((d) => ({ d, late: daysBetween(d.due, today) }))
    .sort((a, b) => b.late - a.late);
  if (!due.length) return null;
  const line = ({ d, late }) => {
    const left = money((Number(d.amount) || 0) - (Number(d.paid) || 0), d.currency);
    const what = d.type === "hutang" ? `Bayar ke ${d.name} ${left}` : `Tagih ${d.name} ${left}`;
    return `${what} (${late === 0 ? "hari ini" : `lewat ${late} hari`})`;
  };
  const lines = due.slice(0, 4).map(line);
  if (due.length > 4) lines.push(`+${due.length - 4} lagi`);
  const todayCount = due.filter((x) => x.late === 0).length;
  return {
    title: todayCount ? `Jatuh tempo hari ini: ${todayCount}` : `Talangan lewat tempo: ${due.length}`,
    body: lines.join("\n"),
    url: ws ? `/${ws}` : "/dar",
    tag: `dar-due-${today}`,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: "Unauthorized" });

  const report = [];
  for (const ws of [null, ...Object.keys(WORKSPACES)]) {
    try {
      const subs = await listSubscriptions(ws);
      if (!subs.length) continue;
      const tz = (ws && WORKSPACES[ws].tz) || "Asia/Jakarta";
      const today = todayIn(tz);
      const saved = await redisCommand(["GET", stateKey(ws)]);
      const message = dueMessage(saved ? JSON.parse(saved) : null, ws, today);
      if (!message) {
        report.push({ ws: ws || "dar", due: 0 });
        continue;
      }
      // Once per account per day, even if the cron runs twice.
      const first = await redisCommand(["SET", `dar-invoices:push-sent:${ws || "dar"}:${today}`, "1", "NX", "EX", 172800]);
      if (!first) {
        report.push({ ws: ws || "dar", skipped: "already sent today" });
        continue;
      }
      report.push({ ws: ws || "dar", ...(await sendToAccount(ws, message)) });
    } catch (error) {
      report.push({ ws: ws || "dar", error: error.message });
    }
  }
  return res.status(200).json({ ok: true, report });
};

module.exports.dueMessage = dueMessage;
