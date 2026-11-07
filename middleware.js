// Gate the admin dashboard on the server: without a valid session cookie the
// dashboard HTML (which embeds financial data) is never sent; the login page is served instead.
export const config = {
  matcher: ['/', '/index', '/index.html'],
};

const COOKIE_NAME = 'dar_admin';

function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

function toBase64Url(buffer) {
  let binary = '';
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hasValidSession(request) {
  const secret = process.env.SESSION_SECRET;
  const value = readCookie(request, COOKIE_NAME);
  if (!secret || secret.length < 32 || !value) return false;

  const [expires, signature] = value.split('.');
  if (!expires || !signature || !(Number(expires) > Date.now())) return false;

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const expected = toBase64Url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`dar-admin.${expires}`)));
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

export default async function middleware(request) {
  if (await hasValidSession(request)) {
    return new Response(null, { headers: { 'x-middleware-next': '1', 'Cache-Control': 'no-store' } });
  }
  return new Response(null, {
    headers: {
      'x-middleware-rewrite': new URL('/admin-login.html', request.url).toString(),
      'Cache-Control': 'no-store',
    },
  });
}
