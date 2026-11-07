// Shared admin-session helpers. Files prefixed with "_" are not exposed as routes by Vercel.
const crypto = require("crypto");

const COOKIE_NAME = "dar_admin";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    const error = new Error("SESSION_SECRET belum diatur (minimal 32 karakter)");
    error.statusCode = 503;
    throw error;
  }
  return secret;
}

function sign(payload, secret) {
  return crypto.createHmac("sha256", secret).update(`dar-admin.${payload}`).digest("base64url");
}

function createSessionCookie() {
  const expires = Date.now() + SESSION_TTL_MS;
  const value = `${expires}.${sign(String(expires), getSecret())}`;
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function readCookie(req, name) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function hasValidSession(req) {
  const value = readCookie(req, COOKIE_NAME);
  if (!value) return false;
  const [expires, signature] = value.split(".");
  if (!expires || !signature || !(Number(expires) > Date.now())) return false;
  const expected = Buffer.from(sign(expires, getSecret()));
  const given = Buffer.from(signature);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

function pinMatches(input) {
  const pin = process.env.ADMIN_PASSCODE;
  if (!pin || pin.length < 6) {
    const error = new Error("ADMIN_PASSCODE belum diatur (minimal 6 karakter)");
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

module.exports = {
  createSessionCookie,
  clearSessionCookie,
  hasValidSession,
  pinMatches,
  redisCommand,
};
