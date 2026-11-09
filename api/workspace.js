// Serves a separate account at temantiket.com/<slug> (see _workspaces.js and the rewrites in
// vercel.json). Without that account's session it shows its own PIN login; with it, the
// dashboard (index.html) with every DAR-only block removed, so none of DAR's invoices,
// balances or contacts reach the page. Data is stored per account by api/billing-state.js.
const fs = require("fs");
const path = require("path");
const { hasValidSession } = require("./_session");
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

function fillPlaceholders(text, ws) {
  return text
    .replace(/\{\{WS_NAME\}\}/g, escapeHtml(ws.name))
    .replace(/\{\{WS_OWNER\}\}/g, escapeHtml(ws.owner || ws.name))
    .replace(/\{\{WS_HOME\}\}/g, `/${ws.slug}`);
}

// Runs before anything else on the page: tells the dashboard which account it is, keeps this
// account's browser storage apart from DAR's (same domain), and tags every /api request.
function bootstrapScript(ws) {
  const info = JSON.stringify({ slug: ws.slug, name: ws.name, owner: ws.owner || ws.name, home: `/${ws.slug}` }).replace(/</g, "\\u003c");
  return `<script>window.DAR_WS=${info};(function(){var p='ws:'+DAR_WS.slug+':',S=Storage.prototype,g=S.getItem,s=S.setItem,r=S.removeItem;` +
    `S.getItem=function(k){return g.call(this,p+k)};S.setItem=function(k,v){return s.call(this,p+k,v)};S.removeItem=function(k){return r.call(this,p+k)};` +
    `var f=window.fetch;window.fetch=function(u,o){if(typeof u==='string'&&u.indexOf('/api/')===0){o=Object.assign({},o);var h=new Headers(o.headers||{});h.set('X-DAR-Workspace',DAR_WS.slug);o.headers=h}return f.call(this,u,o)}})();</script>`;
}

function dashboardPage(ws) {
  let html = readFile("index.html")
    .replace(/<!--dar-only-->[\s\S]*?<!--\/dar-only-->/g, "")
    .replace(/\/\*dar-only\*\/[\s\S]*?\/\*\/dar-only\*\//g, "")
    .replace(/<!--ws:([\s\S]*?)-->/g, "$1")
    .replace(/\/\*ws:([\s\S]*?)\*\//g, "$1");
  html = mustReplace(html, '<meta charset="UTF-8">', `<meta charset="UTF-8">\n    ${bootstrapScript(ws)}`);
  return fillPlaceholders(html, ws);
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
  html = mustReplace(html, "window.location.replace('/');", `window.location.replace(${JSON.stringify(`/${ws.slug}`)});`);
  return html;
}

function manifest(ws) {
  return JSON.stringify({
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
  });
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
    return res.status(200).send(hasValidSession(req, ws.slug) ? dashboardPage(ws) : loginPage(ws));
  } catch (error) {
    console.error("workspace page failed:", error);
    res.setHeader("Cache-Control", "no-store");
    return res.status(error.statusCode || 500).send(error.statusCode === 503 ? escapeHtml(error.message) : "Halaman lagi error. Coba lagi.");
  }
};

module.exports.dashboardPage = dashboardPage;
module.exports.loginPage = loginPage;
