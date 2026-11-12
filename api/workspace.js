// Serves a separate account at temantiket.com/<slug> (see _workspaces.js and the rewrites in
// vercel.json). Without that account's session it shows its own PIN login; with it, the
// dashboard (index.html) with every DAR-only block removed, so none of DAR's invoices,
// balances or contacts reach the page. Data is stored per account by api/billing-state.js.
const fs = require("fs");
const path = require("path");
const { sessionUser } = require("./_session");
const { getWorkspace } = require("./_workspaces");

const files = {};
function readFile(name) {
  if (!files[name]) files[name] = fs.readFileSync(path.join(process.cwd(), name), "utf8");
  return files[name];
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function mustReplace(text, search, replacement) {
  if (!text.includes(search)) throw new Error(`Template changed, cannot find: ${search.slice(0, 60)}`);
  return text.split(search).join(replacement);
}

// An account with `mascot: true` has its own set in brand/ws/<slug>/ (made by
// scripts/make-workspace-mascot.py); every DAR mascot, icon and splash path points there.
const BRAND_FILES = [
  ["/brand/dar-mascot-128.png", "mascot-128.png"],
  ["/brand/dar-mascot-256.png", "mascot-256.png"],
  ["/brand/dar-mascot-fab.png", "mascot-fab.png"],
  ["/brand/favicon-64.png", "favicon-64.png"],
  ["/brand/apple-touch-icon.png", "apple-touch-icon.png"],
  ["/brand/icon-192.png", "icon-192.png"],
  ["/brand/icon-512.png", "icon-512.png"],
  ["/brand/icon-maskable-512.png", "icon-maskable-512.png"],
  ["/brand/splash-1179x2556.png", "splash-1179x2556.png"],
  ["/brand/splash-1206x2622.png", "splash-1206x2622.png"],
  ["/brand/splash-1290x2796.png", "splash-1290x2796.png"],
];

function applyBrand(text, ws) {
  if (!ws.mascot) return text;
  return BRAND_FILES.reduce((out, [from, file]) => out.split(from).join(`/brand/ws/${ws.slug}/${file}`), text);
}

function fillPlaceholders(text, ws) {
  return text
    .replace(/\{\{WS_NAME\}\}/g, escapeHtml(ws.name))
    .replace(/\{\{WS_OWNER\}\}/g, escapeHtml(ws.owner || ws.name))
    .replace(/\{\{WS_HOME\}\}/g, `/${ws.slug}`);
}

// Runs before anything else on the page: tells the dashboard which account it is, keeps this
// account's browser storage apart from DAR's (same domain), and tags every /api request.
// Who is signed in, for "dicatat oleh" on every entry: the owner or one of ws.users.
function personOf(ws, who) {
  const user = who && who !== "owner" ? (ws.users || []).find((u) => u.id === who) : null;
  return user ? { id: user.id, name: user.name, owner: false, limited: user.limited === true } : { id: "owner", name: ws.owner || ws.name, owner: true };
}

function bootstrapScript(ws, who) {
  const info = JSON.stringify({ slug: ws.slug, name: ws.name, owner: ws.owner || ws.name, user: personOf(ws, who), team: (ws.users || []).length > 0, home: `/${ws.slug}`, kind: ws.kind || "", currencies: ws.currencies || [], banks: ws.banks || [] }).replace(/</g, "\\u003c");
  // A limited person gets browser storage of their own, so nothing the owner left on a shared
  // phone shows up for them; the html class hides the parts of the page that are not theirs.
  return `<script>window.DAR_WS=${info};if(DAR_WS.user.limited)document.documentElement.classList.add('is-limited');(function(){var p='ws:'+DAR_WS.slug+':'+(DAR_WS.user.limited?'u-'+DAR_WS.user.id+':':''),S=Storage.prototype,g=S.getItem,s=S.setItem,r=S.removeItem;` +
    `S.getItem=function(k){return g.call(this,p+k)};S.setItem=function(k,v){return s.call(this,p+k,v)};S.removeItem=function(k){return r.call(this,p+k)};` +
    `var f=window.fetch;window.fetch=function(u,o){if(typeof u==='string'&&u.indexOf('/api/')===0){o=Object.assign({},o);var h=new Headers(o.headers||{});h.set('X-DAR-Workspace',DAR_WS.slug);o.headers=h}return f.call(this,u,o)}})();</script>`;
}

function dashboardPage(ws, who = "owner") {
  let html = readFile("index.html")
    .replace(/<!--dar-only-->[\s\S]*?<!--\/dar-only-->/g, "")
    .replace(/\/\*dar-only\*\/[\s\S]*?\/\*\/dar-only\*\//g, "")
    .replace(/<!--ws:([\s\S]*?)-->/g, "$1")
    .replace(/\/\*ws:([\s\S]*?)\*\//g, "$1");
  html = mustReplace(html, '<meta charset="UTF-8">', `<meta charset="UTF-8">\n    ${bootstrapScript(ws, who)}`);
  // No PIN yet: nothing to lock or change, so hide those buttons.
  if (ws.open) html = mustReplace(html, '<link rel="stylesheet" href="/dashboard.css">', '<link rel="stylesheet" href="/dashboard.css">\n    <style>.mobile-top-actions, .sidebar-account button, .sidebar-link.mobile-lock { display: none !important; }</style>');
  // Money changers get the "Tukar" screen; deferred, so it runs after the dashboard script.
  if (ws.kind === "exchange") html = mustReplace(html, '<link rel="stylesheet" href="/dashboard.css">', '<link rel="stylesheet" href="/dashboard.css">\n    <script src="/exchange.js" defer></script>');
  // The sidebar names the person signed in.
  return applyBrand(fillPlaceholders(html, { ...ws, owner: personOf(ws, who).name }), ws);
}

function loginPage(ws) {
  let html = readFile("admin-login.html");
  html = mustReplace(html, "<title>DAR INVOICES | Masuk</title>", `<title>${escapeHtml(ws.name)} | Masuk</title>`);
  html = mustReplace(html, '<link rel="manifest" href="/manifest.webmanifest">', `<link rel="manifest" href="/${ws.slug}/manifest.webmanifest">`);
  html = mustReplace(html, '<meta name="apple-mobile-web-app-title" content="DAR">', `<meta name="apple-mobile-web-app-title" content="${escapeHtml(ws.name)}">`);
  html = mustReplace(html, "<span>DAR / Workspace</span>", `<span>${escapeHtml(ws.name)} / Workspace</span>`);
  html = mustReplace(html, '<div class="classified-stamp">Keuangan agency</div>', '<div class="classified-stamp">Keuangan pribadi &amp; usaha</div>');
  html = mustReplace(html, "Masuk untuk mengelola tagihan dan melihat pendapatan agency.", `Masuk ke workspace ${escapeHtml(ws.name)} untuk mengelola tagihan dan keuangan.`);
  html = mustReplace(html, "JSON.stringify({ pin: input.value.trim() })", `JSON.stringify({ pin: input.value.trim(), workspace: ${JSON.stringify(ws.slug)} })`);
  html = mustReplace(html, "window.location.replace('/dar');", `window.location.replace(${JSON.stringify(`/${ws.slug}`)});`);
  return applyBrand(html, ws);
}

function manifest(ws) {
  return applyBrand(JSON.stringify({
    id: `/${ws.slug}`,
    name: `${ws.name} Invoices`,
    short_name: ws.name.slice(0, 12),
    start_url: `/${ws.slug}?source=pwa`,
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f1eddf",
    theme_color: "#f1eddf",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/brand/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }), ws);
}

module.exports = function handler(req, res) {
  const ws = getWorkspace(req.query && req.query.ws);
  if (!ws) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(404).send("Halaman tidak ditemukan");
  }

  try {
    if (req.query.asset === "manifest") {
      res.setHeader("Content-Type", "application/manifest+json");
      res.setHeader("Cache-Control", "no-cache");
      return res.status(200).send(manifest(ws));
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    const who = sessionUser(req, ws.slug);
    return res.status(200).send(who ? dashboardPage(ws, who) : loginPage(ws));
  } catch (error) {
    console.error("workspace page failed:", error);
    res.setHeader("Cache-Control", "no-store");
    return res.status(error.statusCode || 500).send(error.statusCode === 503 ? escapeHtml(error.message) : "Halaman lagi error. Coba lagi.");
  }
};

module.exports.dashboardPage = dashboardPage;
module.exports.loginPage = loginPage;
