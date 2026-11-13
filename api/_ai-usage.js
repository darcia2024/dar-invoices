// What each AI call of this dashboard cost, added up per day (Asia/Jakarta) and per account in
// Redis: hash dar-invoices:ai-usage:<YYYY-MM-DD>, field "<account>" = dollars, "<account>:n" =
// number of calls. Kept 120 days. Never blocks or breaks the reply.
const { redisCommand } = require("./_session");

const dayKey = (date = new Date()) => date.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

async function recordAiUsage(ws, cost) {
  const n = Number(cost);
  if (!Number.isFinite(n) || n < 0) return;
  const key = `dar-invoices:ai-usage:${dayKey()}`;
  const who = ws || "dar";
  try {
    await redisCommand(["HINCRBYFLOAT", key, who, String(n)]);
    await redisCommand(["HINCRBY", key, `${who}:n`, "1"]);
    await redisCommand(["EXPIRE", key, String(120 * 86400)]);
  } catch (e) {
    console.warn("ai usage not recorded:", e.message);
  }
}

// { "YYYY-MM-DD": { account: { cost, calls } } } for the last `days` days.
async function readAiUsage(days = 30) {
  const out = {};
  const now = Date.now();
  const dates = Array.from({ length: days }, (_, i) => dayKey(new Date(now - i * 86400000)));
  await Promise.all(dates.map(async (d) => {
    try {
      const flat = await redisCommand(["HGETALL", `dar-invoices:ai-usage:${d}`]);
      const pairs = Array.isArray(flat) ? flat : flat && typeof flat === "object" ? Object.entries(flat).flat() : [];
      const day = {};
      for (let i = 0; i + 1 < pairs.length; i += 2) {
        const [field, value] = [String(pairs[i]), Number(pairs[i + 1]) || 0];
        const isCount = field.endsWith(":n");
        const who = isCount ? field.slice(0, -2) : field;
        day[who] = day[who] || { cost: 0, calls: 0 };
        if (isCount) day[who].calls = value; else day[who].cost = value;
      }
      if (Object.keys(day).length) out[d] = day;
    } catch (e) { /* skip that day */ }
  }));
  return out;
}

module.exports = { recordAiUsage, readAiUsage, dayKey };
