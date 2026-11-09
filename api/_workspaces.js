// Separate accounts ("workspaces") that use the same dashboard with their own data and PIN.
// Each one lives at temantiket.com/<slug>. Only public labels go here; the PIN is the Vercel
// env var WORKSPACE_PIN_<SLUG> (slug in capitals, "-" as "_"), e.g. WORKSPACE_PIN_DEMO.
//
// To add an account: add an entry below and a rewrite for "/<slug>" in vercel.json, then set
// its PIN in Vercel.
const WORKSPACES = {
  demo: { name: "Demo", owner: "Pemilik Demo" },
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
