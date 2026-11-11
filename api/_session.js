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

// The account owner signs "dar-ws.<slug>.<expires>" (unchanged, so existing sessions stay
// valid); an extra person on the account (users in _workspaces.js, e.g. Ilham on Ziaud's
// account) signs "dar-ws.<slug>.<user>.<expires>".
function signedText(ws, expires, user = null) {
  if (!ws) return `dar-admin.${expires}`;
  return user ? `dar-ws.${ws}.${user}.${expires}` : `dar-ws.${ws}.${expires}`;
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

function sign(ws, expires, secret, user = null) {
  return crypto.createHmac("sha256", secret).update(signedText(ws, expires, user)).digest("base64url");
}

const USER_RE = /^[a-z0-9-]{1,32}$/;

function createSessionCookie(ws = null, user = null) {
  const expires = Date.now() + SESSION_TTL_MS;
  const who = ws && user && USER_RE.test(user) ? user : null;
  const value = who ? `${expires}.${who}.${sign(ws, String(expires), getSecret(), who)}` : `${expires}.${sign(ws, String(expires), getSecret())}`;
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

// Who is signed in: "owner", an extra user's id, or null without a valid session.
function sessionUser(req, ws = null) {
  // An account marked open (no PIN yet) needs no session. Never applies to DAR (ws null).
  if (ws) {
    const account = getWorkspace(ws);
    if (account && account.open === true) return "owner";
  }
  const value = readCookie(req, cookieName(ws));
  if (!value) return null;
  const parts = value.split(".");
  const [expires, user, signature] = parts.length === 3 ? parts : [parts[0], null, parts[1]];
  if (!expires || !signature || !(Number(expires) > Date.now())) return null;
  if (user) {
    const account = ws ? getWorkspace(ws) : null;
    if (!account || !(account.users || []).some((u) => u.id === user)) return null; // removed user
  }
  const expected = Buffer.from(sign(ws, expires, getSecret(), user));
  const given = Buffer.from(signature);
  if (!(expected.length === given.length && crypto.timingSafeEqual(expected, given))) return null;
  return user || "owner";
}

function hasValidSession(req, ws = null) {
  return sessionUser(req, ws) !== null;
}
// An extra user's PIN is the env var WORKSPACE_PIN_<SLUG>_<USER>, e.g. WORKSPACE_PIN_ZIAUD_ILHAM.
function pinMatches(input, ws = null, user = null) {
  const envName = ws ? pinEnvName(ws) + (user ? `_${user.toUpperCase().replace(/-/g, "_")}` : "") : "ADMIN_PASSCODE";
  // A PIN in _workspaces.js (public demo accounts only) is used when no env var is set.
  const codePin = ws && !user ? (getWorkspace(ws) || {}).pin : null;
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
function pinKey(ws, user = null) {
  return `dar-invoices:pin:${ws || "dar"}${user ? `:${user}` : ""}`;
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

async function storedPinHash(ws, user = null) {
  try {
    return await redisCommand(["GET", pinKey(ws, user)]);
  } catch (e) {
    return null; // Redis unreachable: fall back to the env/code PIN
  }
}

async function verifyPin(input, ws = null, user = null) {
  const stored = await storedPinHash(ws, user);
  if (stored) return hashMatches(input, stored);
  return pinMatches(input, ws, user);
}

// Login: whose PIN this is on the account ("owner" or an extra user's id), or null. The
// owner's PIN is checked first; a user whose PIN is not set yet is skipped.
async function findPinUser(input, ws = null) {
  let ownerError = null;
  try {
    if (await verifyPin(input, ws)) return "owner";
  } catch (error) {
    ownerError = error;
  }
  const users = ws ? (getWorkspace(ws) || {}).users || [] : [];
  for (const u of users) {
    try {
      if (await verifyPin(input, ws, u.id)) return u.id;
    } catch (e) {
      // this user's PIN is not set yet
    }
  }
  if (ownerError) throw ownerError;
  return null;
}

async function savePin(ws, pin, user = null) {
  await redisCommand(["SET", pinKey(ws, user), hashPin(pin)]);
}

module.exports = {
  verifyPin,
  findPinUser,
  sessionUser,
  savePin,
  createSessionCookie,
  clearSessionCookie,
  hasValidSession,
  pinMatches,
  redisCommand,
  requestWorkspace,
};
