// Separate accounts ("workspaces") that use the same dashboard with their own data and PIN.
// Each one lives at temantiket.com/<slug>. The PIN is the Vercel env var WORKSPACE_PIN_<SLUG>
// (slug in capitals, "-" as "_"), e.g. WORKSPACE_PIN_DEMO. An account may instead set "pin"
// here, but this repo is public, so such a PIN is public too: only for throwaway demo data.
//
// To add an account: add an entry below and a rewrite for "/<slug>" in vercel.json, then set
// its PIN in Vercel.
//
// AI (assistant + receipt scan through OpenRouter) is OFF unless granted. Without it, both
// answer with templates (api/_demo-ai.js) and cost nothing. Grant it with:
//   aiUntil: "2026-12-10"  -> real AI through that day (Jakarta time); the monthly AI add-on:
//                            each payment of Rp30.000 moves this date one month further
//   ai: true               -> real AI with no end date
// Lifetime customer without AI:  rina: { name: "Rina Studio", owner: "Rina" },
const WORKSPACES = {
  demo: { name: "Demo", owner: "Pemilik Demo", pin: "0000" },
  // Akun Lifetime (sold 2026-11-10). PIN: Vercel env WORKSPACE_PIN_JULIAN.
  julian: { name: "Julian", owner: "Julian", mascot: true },
  // Akun Lifetime (2026-11-10). PIN: Vercel env WORKSPACE_PIN_ZIAUD.
  ziaud: { name: "Ziaud", owner: "Ziaud", business: "a currency exchange business: changing Indonesian rupiah into Egyptian pounds (EGP) or US dollars (USD) for customers" },
};

function todayJakarta() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

function aiEnabled(ws) {
  if (!ws) return true; // DAR's own dashboard
  if (ws.ai === true) return true;
  return typeof ws.aiUntil === "string" && /^\d{4}-\d{2}-\d{2}$/.test(ws.aiUntil) && todayJakarta() <= ws.aiUntil;
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

function getWorkspace(slug) {
  const key = String(slug || "").toLowerCase();
  if (!SLUG_RE.test(key) || !Object.prototype.hasOwnProperty.call(WORKSPACES, key)) return null;
  return { slug: key, ...WORKSPACES[key] };
}

function pinEnvName(slug) {
  return `WORKSPACE_PIN_${slug.toUpperCase().replace(/-/g, "_")}`;
}

module.exports = { WORKSPACES, getWorkspace, pinEnvName, aiEnabled };
