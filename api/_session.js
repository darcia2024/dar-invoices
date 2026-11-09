// Shared admin-session helpers. Files prefixed with "_" are not exposed as routes by Vercel.
const crypto = require("crypto");
const { getWorkspace, pinEnvName } = require("./_workspaces");

// The DAR dashboard uses the "dar_admin" cookie (also checked by middleware.js). Every other
// account gets its own cookie and its own signed payload, so one account's session never
// opens another account's data.
const COOKIE_NAME = "dar_admin";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function cookieName(ws) {
  return ws ? `dar_ws_${ws.replace(/-/g, "_")}` : COOKIE_NAME;
}

function signedText(ws, expires) {
  return ws ? `dar-ws.${ws}.${expires}` : `dar-admin.${expires}`;
}

// Which account an API request is for: the dashboard of a separate account sends
// "X-DAR-Workspace: <slug>". No header means the DAR dashboard.
function requestWorkspace(req) {
  const raw = req.headers["x-dar-workspace"];
  if (!raw) return null;
  const ws = getWorkspace(raw);
  if (!ws) {
    const error = new Error("Akun tidak ditemukan");
    error.statusCode = 404;
    throw error;
  }
  return ws.slug;
}

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    const error = new Error("SESSION_SECRET belum diatur (minimal 32 karakter)");
    error.statusCode = 503;
    throw error;
  }
  return secret;
}

function sign(ws, expires, secret) {
  return crypto.createHmac("sha256", secret).update(signedText(ws, expires)).digest("base64url");
}

function createSessionCookie(ws = null) {
  const expires = Date.now() + SESSION_TTL_MS;
  const value = `${expires}.${sign(ws, String(expires), getSecret())}`;
  return `${cookieName(ws)}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}`;
}

function clearSessionCookie(ws = null) {
  return `${cookieName(ws)}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function readCookie(req, name) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function hasValidSession(req, ws = null) {
  const value = readCookie(req, cookieName(ws));
  if (!value) return false;
  const [expires, signature] = value.split(".");
  if (!expires || !signature || !(Number(expires) > Date.now())) return false;
  const expected = Buffer.from(sign(ws, expires, getSecret()));
  const given = Buffer.from(signature);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

function pinMatches(input, ws = null) {
  const envName = ws ? pinEnvName(ws) : "ADMIN_PASSCODE";
  // A PIN in _workspaces.js (public demo accounts only) is used when no env var is set.
  const codePin = ws ? (getWorkspace(ws) || {}).pin : null;
  const pin = process.env[envName] || codePin;
  if (!pin || pin.length < (pin === codePin ? 4 : 6)) {
    const error = new Error(`${envName} belum diatur di Vercel (minimal 6 karakter)`);
    error.statusCode = 503;
    throw error;
  }
  const a = crypto.createHash("sha256").update(String(input || "")).digest();
  const b = crypto.createHash("sha256").update(pin).digest();
  return crypto.timingSafeEqual(a, b);
}

async function redisCommand(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    const error = new Error("Upstash env vars are not configured");
    error.statusCode = 503;
    throw error;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });

  if (!response.ok) {
    const error = new Error(`Upstash request failed with ${response.status}`);
    error.statusCode = 502;
    throw error;
  }

  const payload = await response.json();
  if (payload.error) {
    const error = new Error(payload.error);
    error.statusCode = 502;
    throw error;
  }

  return payload.result;
}

// A PIN changed from the dashboard ("Ganti PIN") is stored as a scrypt hash in Redis and
// then replaces the env/code PIN for that account.
function pinKey(ws) {
  return `dar-invoices:pin:${ws || "dar"}`;
}

function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = crypto.scryptSync(String(pin), salt, 32).toString("base64url");
  return `scrypt$${salt}$${hash}`;
}

function hashMatches(input, stored) {
  const [kind, salt, hash] = String(stored).split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const given = crypto.scryptSync(String(input || ""), salt, expected.length);
  return crypto.timingSafeEqual(expected, given);
}

async function storedPinHash(ws) {
  try {
    return await redisCommand(["GET", pinKey(ws)]);
  } catch (e) {
    return null; // Redis unreachable: fall back to the env/code PIN
  }
}

async function verifyPin(input, ws = null) {
  const stored = await storedPinHash(ws);
  if (stored) return hashMatches(input, stored);
  return pinMatches(input, ws);
}

async function savePin(ws, pin) {
  await redisCommand(["SET", pinKey(ws), hashPin(pin)]);
}

module.exports = {
  verifyPin,
  savePin,
  createSessionCookie,
  clearSessionCookie,
  hasValidSession,
  pinMatches,
  redisCommand,
  requestWorkspace,
};
