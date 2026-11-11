// Web Push without a library (this project has no npm dependencies): VAPID (RFC 8292) to
// identify the sender and aes128gcm (RFC 8291) to encrypt the message, with Node's crypto.
//
// Setup in Vercel: VAPID_PRIVATE_KEY (the private half of VAPID_PUBLIC_KEY below, base64url)
// and CRON_SECRET (Vercel sends it to api/cron-reminders.js as "Authorization: Bearer ...").
const crypto = require("crypto");
const { redisCommand } = require("./_session");

// Public half of the key pair; safe to publish (browsers need it to subscribe).
const VAPID_PUBLIC_KEY = "BPU5gZZtEaFgLCc0UB_MBzFWBjkuDgMrDjGel9WL-kel5vOZMw4AErcCsKtKWpNCHxKHxXcIphK39E2MW-X7sBs";
const VAPID_SUBJECT = "https://temantiket.com";

function b64(buf) {
  return Buffer.from(buf).toString("base64url");
}

function vapidKey() {
  const d = process.env.VAPID_PRIVATE_KEY;
  if (!d) {
    const error = new Error("VAPID_PRIVATE_KEY belum diatur di Vercel");
    error.statusCode = 503;
    throw error;
  }
  const pub = Buffer.from(VAPID_PUBLIC_KEY, "base64url");
  return crypto.createPrivateKey({
    key: { kty: "EC", crv: "P-256", d, x: b64(pub.subarray(1, 33)), y: b64(pub.subarray(33, 65)) },
    format: "jwk",
  });
}

function vapidHeader(endpoint) {
  const aud = new URL(endpoint).origin;
  const header = b64(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const body = b64(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: VAPID_SUBJECT }));
  const signature = crypto.sign("sha256", Buffer.from(`${header}.${body}`), { key: vapidKey(), dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${body}.${b64(signature)}, k=${VAPID_PUBLIC_KEY}`;
}

// RFC 8291: one record, no padding.
function encrypt(subscription, text) {
  const uaPublic = Buffer.from(subscription.keys.p256dh, "base64url");
  const auth = Buffer.from(subscription.keys.auth, "base64url");
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const ikm = Buffer.from(crypto.hkdfSync("sha256", shared, auth, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]), 32));
  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(text, "utf8"), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

// Sends one notification ({ title, body, url, tag }). Returns the push service's status;
// 404/410 mean the subscription is gone.
async function sendPush(subscription, message) {
  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: vapidHeader(subscription.endpoint),
      TTL: "86400",
      Urgency: "high",
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
    },
    body: encrypt(subscription, JSON.stringify(message)),
  });
  return response.status;
}

// Subscriptions per account, in a Redis hash: field = id of the endpoint.
function subsKey(ws) {
  return `dar-invoices:push:${ws || "dar"}`;
}

function subId(endpoint) {
  return crypto.createHash("sha256").update(String(endpoint)).digest("base64url").slice(0, 24);
}

async function saveSubscription(ws, subscription, user) {
  const record = { endpoint: subscription.endpoint, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth }, user, createdAt: Date.now() };
  await redisCommand(["HSET", subsKey(ws), subId(subscription.endpoint), JSON.stringify(record)]);
}

async function removeSubscription(ws, endpoint) {
  await redisCommand(["HDEL", subsKey(ws), subId(endpoint)]);
}

async function listSubscriptions(ws) {
  const flat = (await redisCommand(["HGETALL", subsKey(ws)])) || [];
  const out = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    try {
      out.push(JSON.parse(flat[i + 1]));
    } catch (e) {}
  }
  return out;
}

// Sends to every device of the account and drops the ones that are gone.
async function sendToAccount(ws, message) {
  const subs = await listSubscriptions(ws);
  let sent = 0;
  for (const sub of subs) {
    try {
      const status = await sendPush(sub, message);
      if (status === 404 || status === 410) await removeSubscription(ws, sub.endpoint);
      else if (status >= 200 && status < 300) sent++;
    } catch (e) {
      // one device failing does not stop the others
    }
  }
  return { devices: subs.length, sent };
}

function validSubscription(s) {
  return s && typeof s.endpoint === "string" && /^https:\/\//.test(s.endpoint) && s.keys && typeof s.keys.p256dh === "string" && typeof s.keys.auth === "string";
}

module.exports = { VAPID_PUBLIC_KEY, sendPush, saveSubscription, removeSubscription, listSubscriptions, sendToAccount, validSubscription, encrypt };
