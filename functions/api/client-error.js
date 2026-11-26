// Pages send script errors here so they show up in the site's logs
// (Cloudflare dashboard > Workers & Pages > this project > Functions > Real-time logs).
// Reports carry no member data: only the page path, the error text and where it happened.
const MAX = 2048;

function clip(v, n) {
  return String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').slice(0, n);
}

export async function handleClientError(request) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX) return new Response(null, { status: 413 });
  const raw = await request.text();
  if (raw.length > MAX) return new Response(null, { status: 413 });
  let r;
  try { r = JSON.parse(raw); } catch { return new Response(null, { status: 400 }); }
  if (!r || typeof r !== 'object') return new Response(null, { status: 400 });
  const entry = {
    page: clip(r.page, 60),
    message: clip(r.message, 300),
    source: clip(r.source, 120),
    line: Number(r.line) || 0,
    col: Number(r.col) || 0,
    ua: clip(request.headers.get('user-agent'), 160),
  };
  console.error('client-error', JSON.stringify(entry));
  return new Response(null, { status: 204 });
}

export async function onRequestPost({ request }) {
  return handleClientError(request);
}
