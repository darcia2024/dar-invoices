// Separate accounts ("workspaces") that use the same dashboard with their own data and PIN.
// Each one lives at temantiket.com/<slug>. The PIN is the Vercel env var WORKSPACE_PIN_<SLUG>
// (slug in capitals, "-" as "_"), e.g. WORKSPACE_PIN_DEMO. An account may instead set "pin"
// here, but this repo is public, so such a PIN is public too: only for throwaway demo data.
//
// To add an account: add an entry below and a rewrite for "/<slug>" in vercel.json, then set
// its PIN in Vercel.
const WORKSPACES = {
  // ai: false -> the assistant and receipt scan answer with templates (api/_demo-ai.js) and
  // never call OpenRouter, so a public PIN cannot run up the AI bill.
  demo: { name: "Demo", owner: "Pemilik Demo", pin: "0000", ai: false },
};

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

function getWorkspace(slug) {
  const key = String(slug || "").toLowerCase();
  if (!SLUG_RE.test(key) || !Object.prototype.hasOwnProperty.call(WORKSPACES, key)) return null;
  return { slug: key, ...WORKSPACES[key] };
}

function pinEnvName(slug) {
  return `WORKSPACE_PIN_${slug.toUpperCase().replace(/-/g, "_")}`;
}

module.exports = { WORKSPACES, getWorkspace, pinEnvName };
