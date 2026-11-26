// Pages send script errors here. Each report is written to the site's logs
// (Cloudflare > Workers & Pages > this project > Functions > Real-time logs, which only show
// while open) and, if a KV namespace is bound as CLIENT_ERRORS, a sample is kept there for 30 days.
// Reports carry no member data: only the page path, the error text and where it happened.
const MAX = 2048;
const KEEP_SECONDS = 60 * 60 * 24 * 30;

function clip(v, n) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, n);
}

// Reads at most `max` bytes, so a huge body is refused without being read whole.
async function readCapped(request, max) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { try { await reader.cancel(); } catch { /* ignore */ } return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(all);
}

export async function handleClientError(request, env = {}) {
  if (Number(request.headers.get('content-length') || 0) > MAX) return new Response(null, { status: 413 });
  const raw = await readCapped(request, MAX);
  if (raw === null) return new Response(null, { status: 413 });
  let r;
  try { r = JSON.parse(raw); } catch { return new Response(null, { status: 400 }); }
  if (!r || typeof r !== 'object') return new Response(null, { status: 400 });
  const entry = {
    at: new Date().toISOString(),
    page: clip(r.page, 60),
    message: clip(r.message, 300),
    source: clip(r.source, 120),
    line: Number(r.line) || 0,
    col: Number(r.col) || 0,
    ua: clip(request.headers.get('user-agent'), 160),
  };
  console.error('client-error', JSON.stringify(entry));
  // KV writes share a daily quota with the Stripe webhook's UNLOCK_SENT, so keep at most a
  // tenth of reports there; every report still goes to the logs.
  if (env.CLIENT_ERRORS && (env.KEEP_ALL_ERRORS || Math.random() < 0.1)) {
    const key = `err:${entry.at}:${Math.random().toString(36).slice(2, 8)}`;
    try { await env.CLIENT_ERRORS.put(key, JSON.stringify(entry), { expirationTtl: KEEP_SECONDS }); } catch (e) { console.error('kv failed', e.message); }
  }
  return new Response(null, { status: 204 });
}

export async function onRequestPost({ request, env }) {
  return handleClientError(request, env);
}
