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

function dayBefore(day) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function short(n) {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1e9) return `${sign}Rp ${(abs / 1e9).toLocaleString("id-ID", { maximumFractionDigits: 1 })} M`;
  if (abs >= 1e6) return `${sign}Rp ${(abs / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`;
  return `${sign}Rp ${abs.toLocaleString("id-ID")}`;
}

// Same as dealProfit in exchange.js: each side at the kurs modal of the moment it was saved,
// or today's kurs modal for a line saved before one was set.
function dealProfit(d, rates = {}) {
  const modal = d.modal || Number(rates[d.currency]) || 0;
  const modal2 = d.modal2 || Number(rates[d.currency2]) || 0;
  if (d.dir === "swap") return modal && modal2 ? Math.round(d.qty2 * modal2 - d.qty * modal) : 0;
  if (!modal) return 0;
  const atModal = Math.round(d.qty * modal);
  return d.dir === "beli" ? atModal - d.idr : d.idr - atModal;
}

// For an owner who lets someone else do the entering: what was recorded on `day` and by whom,
// and how the aset bersih moved. Always returns a message, also for a day with nothing in it.
function reportMessage(state, ws, day, tz, owner) {
  const ex = (state && state.exchange) || {};
  const list = (v) => (Array.isArray(v) ? v : []);
  const live = (x) => x && !x.demo;
  const dayOf = (ts) => (ts ? new Date(ts).toLocaleDateString("en-CA", { timeZone: tz }) : "");
  const deals = list(ex.deals).filter((d) => live(d) && d.date === day);
  const incomes = list(ex.incomes).filter((x) => live(x) && x.date === day);
  const spends = list(((state && state.expenseLogs) || {})[day.slice(0, 7)]).filter((l) => live(l) && l.date === day);
  const newDebts = list(state && state.debts).filter((d) => live(d) && dayOf(d.createdAt) === day);
  const paid = list(state && state.debts).flatMap((d) => (live(d) ? list(d.payments).filter((p) => p && p.date === day) : []));
  const moves = list(ex.deposits && ex.deposits.moves).filter((m) => live(m) && m.date === day);

  const lines = [];
  if (deals.length) {
    const rates = ex.assetRates || {};
    const profit = deals.reduce((s, d) => s + dealProfit(d, rates), 0);
    lines.push(`Tukar ${deals.length}×${deals.some((d) => d.modal || rates[d.currency]) ? ` · untung ${short(profit)}` : " · untung belum kehitung (kurs modal kosong)"}`);
  }
  // Rupiah value of pemasukan / pengeluaran (pounds/dollars at their saved kurs, else today's).
  const rates = ex.assetRates || {};
  const foreign = (x) => typeof x.currency === "string" && x.currency !== "IDR" && /^[A-Z]{3}$/.test(x.currency);
  const idrOf = (x) => (foreign(x) ? Math.round((Number(x.fxAmount) || 0) * (Number(x.rate) || Number(rates[x.currency]) || 0)) : Number(x.amount) || 0);
  const inSum = incomes.reduce((s, x) => s + idrOf(x), 0);
  const outSum = spends.reduce((s, l) => s + idrOf(l), 0);
  if (inSum || outSum) lines.push([inSum ? `Masuk ${short(inSum)}` : "", outSum ? `Keluar ${short(outSum)}` : ""].filter(Boolean).join(" · "));
  // Net per currency: both sides of every tukar, pemasukan in, pengeluaran out.
  const flow = {};
  const add = (c, n) => { if (c && n) flow[c] = Math.round(((flow[c] || 0) + n) * 100) / 100; };
  deals.forEach((d) => {
    const qty = Number(d.qty) || 0;
    if (d.dir === "beli") { add("IDR", -(Number(d.idr) || 0)); add(d.currency, qty); }
    else if (d.dir === "swap") { add(d.currency, -qty); add(d.currency2, Number(d.qty2) || 0); }
    else { add(d.currency, -qty); add("IDR", Number(d.idr) || 0); }
  });
  incomes.forEach((x) => add(foreign(x) ? x.currency : "IDR", foreign(x) ? Number(x.fxAmount) || 0 : Number(x.amount) || 0));
  spends.forEach((l) => add(foreign(l) ? l.currency : "IDR", -(foreign(l) ? Number(l.fxAmount) || 0 : Number(l.amount) || 0)));
  const flowText = Object.entries(flow).filter(([, n]) => n).sort(([a], [b]) => (a === "IDR" ? -1 : b === "IDR" ? 1 : a.localeCompare(b)))
    .map(([c, n]) => `${n < 0 ? "−" : "+"}${c === "IDR" ? short(Math.abs(n)).replace(/^−/, "") : `${Math.abs(n).toLocaleString("id-ID", { maximumFractionDigits: 2 })} ${c}`}`);
  if (flowText.length) lines.push(`Per mata uang: ${flowText.join(" · ")}`);
  if (newDebts.length || paid.length) lines.push([newDebts.length ? `Talangan baru ${newDebts.length}` : "", paid.length ? `dibayar ${paid.length}` : ""].filter(Boolean).join(" · "));
  if (moves.length) lines.push(`Titipan ${moves.length} catatan`);

  const snaps = ex.assetDaily && typeof ex.assetDaily === "object" ? ex.assetDaily : {};
  const snap = snaps[day];
  const before = Object.keys(snaps).filter((k) => k < day).sort().pop();
  if (snap) {
    const change = before ? snap.total - snaps[before].total : null;
    lines.push(`Aset bersih ${short(snap.total)}${change === null ? "" : ` (${change < 0 ? "▼" : "▲"} ${short(Math.abs(change))})`}`);
  }

  const by = {};
  [...deals, ...incomes, ...spends, ...newDebts, ...paid, ...moves].forEach((x) => {
    const who = (x && x.by) || owner;
    by[who] = (by[who] || 0) + 1;
  });
  const people = Object.entries(by).sort((a, b) => b[1] - a[1]).map(([who, n]) => `${who} ${n}`);
  if (people.length) lines.push(`Dicatat: ${people.join(", ")}`);

  const label = new Date(`${day}T12:00:00Z`).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
  return {
    title: `Laporan ${label}`,
    body: people.length ? lines.join("\n") : `Belum ada yang dicatat hari itu.${snap ? "\n" + lines[lines.length - 1] : ""}`,
    url: ws ? `/${ws}` : "/dar",
    tag: `dar-report-${day}`,
  };
}

function addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// DAR's own invoice cards live in index.html, not in the saved state; read them from there.
let darInvoicesCache = null;
function darInvoices() {
  if (darInvoicesCache) return darInvoicesCache;
  darInvoicesCache = [];
  try {
    const html = require("fs").readFileSync(require("path").join(process.cwd(), "index.html"), "utf8");
    const start = html.indexOf("const invoiceItems =");
    const block = start >= 0 ? html.slice(start, html.indexOf("];", start)) : "";
    const re = /id:\s*"([^"]+)",\s*name:\s*"((?:[^"\\]|\\.)*)",\s*month:\s*"(\d{4}-\d{2})",\s*monthLabel:\s*"[^"]*",\s*gross:\s*(\d+)/g;
    let m;
    while ((m = re.exec(block))) darInvoicesCache.push({ id: m[1], name: m[2], month: m[3], gross: Number(m[4]) });
  } catch (e) {
    console.warn("weekly: could not read DAR invoices", e.message);
  }
  return darInvoicesCache;
}

// Monday morning: last week's money in and out (with the change from the week before), the
// biggest spendings, what is still owed by clients, and what is due this week.
function weeklyMessage(state, ws, today) {
  const list = (v) => (Array.isArray(v) ? v : []);
  const live = (x) => x && !x.demo;
  const ex = (state && state.exchange) || {};
  const rates = ex.assetRates || {};
  const foreign = (x) => typeof x.currency === "string" && x.currency !== "IDR" && /^[A-Z]{3}$/.test(x.currency);
  const idrOf = (x) => (foreign(x) ? Math.round((Number(x.fxAmount) || 0) * (Number(x.rate) || Number(rates[x.currency]) || 0)) : Number(x.amount) || 0);
  const from = addDays(today, -7), to = addDays(today, -1);
  const prevFrom = addDays(today, -14), prevTo = addDays(today, -8);
  const inRange = (d, a, b) => typeof d === "string" && d >= a && d <= b;
  const allLogs = Object.values((state && state.expenseLogs) || {}).flatMap(list).filter(live);
  const plans = (state && state.expensePlans) || {};
  const posName = (l) => {
    const p = list(plans[String(l.date).slice(0, 7)]).find((x) => x && x.id === l.posId);
    return p ? p.name : (l.note || l.merchant || "Lainnya");
  };
  const week = allLogs.filter((l) => inRange(l.date, from, to));
  const prevWeek = allLogs.filter((l) => inRange(l.date, prevFrom, prevTo));
  const out = week.reduce((s, l) => s + idrOf(l), 0);
  const outPrev = prevWeek.reduce((s, l) => s + idrOf(l), 0);
  const incomes = [...Object.values((state && state.incomeLogs) || {}).flatMap(list), ...list(ex.incomes)].filter(live);
  const income = incomes.filter((x) => inRange(x.date, from, to)).reduce((s, x) => s + idrOf(x), 0);

  const lines = [];
  if (out) {
    const change = outPrev ? Math.round(((out - outPrev) / outPrev) * 100) : null;
    lines.push(`Keluar ${short(out)} (${week.length} catatan)${change === null ? "" : change === 0 ? " · sama kayak minggu sebelumnya" : ` · ${change > 0 ? "▲" : "▼"} ${Math.abs(change)}% dari minggu sebelumnya`}`);
    const byPos = {};
    week.forEach((l) => { const k = posName(l); byPos[k] = (byPos[k] || 0) + idrOf(l); });
    const top = Object.entries(byPos).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${short(v)}`);
    if (top.length) lines.push(`Terbesar: ${top.join(", ")}`);
  } else {
    lines.push("Minggu lalu nggak ada pengeluaran yang dicatat");
  }
  if (income) lines.push(`Masuk ${short(income)}`);

  // Client invoices still open (DAR's built-in cards + invoices made in the app).
  const statuses = (state && state.paymentStatuses) || {};
  const dps = (state && state.dpAmounts) || {};
  const deleted = new Set(list(state && state.deletedInvoiceIds));
  const invoices = [...(ws ? [] : darInvoices()), ...list(state && state.customInvoices)]
    .filter((i) => i && i.id && !deleted.has(i.id) && Number(i.gross) > 0);
  const seen = new Set();
  const open = invoices.filter((i) => !seen.has(i.id) && seen.add(i.id) && (statuses[i.id] || "UNPAID") !== "PAID")
    .map((i) => Number(i.gross) - ((statuses[i.id] === "DP" && Number(dps[i.id])) || 0))
    .filter((left) => left > 0);
  if (open.length) lines.push(`Invoice belum lunas: ${open.length}, sisa ${short(open.reduce((s, n) => s + n, 0))}`);

  // Due this week: talangan / hutang and planned payments with a date.
  const weekEnd = addDays(today, 6);
  const debts = list(state && state.debts).filter((d) => live(d) && inRange(d.due, "0000-00-00", weekEnd) && (Number(d.paid) || 0) < (Number(d.amount) || 0));
  const month = today.slice(0, 7);
  const planDue = [...new Set([month, weekEnd.slice(0, 7)])].flatMap((m) => list(plans[m]))
    .filter((p) => p && !p.demo && !p.done && inRange(p.due, today, weekEnd));
  const dueBits = [];
  if (debts.length) dueBits.push(`${debts.length} hutang/piutang jatuh tempo`);
  if (planDue.length) dueBits.push(`${planDue.length} rencana bayar ${short(planDue.reduce((s, p) => s + (Number(p.planned) || 0), 0))}`);
  if (dueBits.length) lines.push(`Minggu ini: ${dueBits.join(" · ")}`);

  // One plain tip from the numbers (no AI call, free).
  let tip = "";
  if (outPrev && out > outPrev * 1.3) tip = "Pengeluaran naik lumayan, cek lagi yang terbesar.";
  else if (open.length) tip = "Ada invoice yang belum lunas, tombol \"Tagih via WA\" udah siap di dashboard.";
  else if (income > out && out) tip = "Pemasukan lebih gede dari pengeluaran, mantap. Sisihin buat dana darurat.";
  if (tip) lines.push(tip);

  const label = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("id-ID", { day: "numeric", month: "short", timeZone: "UTC" });
  return {
    title: `Ringkasan minggu lalu (${label(from)} – ${label(to)})`,
    body: lines.join("\n"),
    url: ws ? `/${ws}` : "/dar",
    tag: `dar-weekly-${today}`,
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
      const state = saved ? JSON.parse(saved) : null;
      // Yesterday's report, to the owner's phones only (not to the person doing the entering).
      if (ws && WORKSPACES[ws].dailyReport) {
        const owner = WORKSPACES[ws].owner || WORKSPACES[ws].name;
        const yesterday = dayBefore(today);
        const firstReport = await redisCommand(["SET", `dar-invoices:push-report:${ws}:${yesterday}`, "1", "NX", "EX", 172800]);
        if (firstReport) {
          const isOwner = (sub) => sub.userId === "owner" || (!sub.userId && sub.user === owner);
          report.push({ ws, dailyReport: yesterday, ...(await sendToAccount(ws, reportMessage(state, ws, yesterday, tz, owner), isOwner)) });
        }
      }
      // Mondays (in the account's own timezone): the weekly summary, to the owner's phones.
      if (new Date(`${today}T12:00:00Z`).getUTCDay() === 1) {
        const firstWeekly = await redisCommand(["SET", `dar-invoices:push-weekly:${ws || "dar"}:${today}`, "1", "NX", "EX", 172800]);
        if (firstWeekly) {
          const owner = ws ? WORKSPACES[ws].owner || WORKSPACES[ws].name : null;
          const isOwner = (sub) => !ws || sub.userId === "owner" || (!sub.userId && sub.user === owner);
          report.push({ ws: ws || "dar", weekly: today, ...(await sendToAccount(ws, weeklyMessage(state, ws, today), isOwner)) });
        }
      }
      const message = dueMessage(state, ws, today);
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
module.exports.reportMessage = reportMessage;
module.exports.weeklyMessage = weeklyMessage;
