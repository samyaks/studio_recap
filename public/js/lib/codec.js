// Packs a recap into the link itself (after the #), compressed.
// The part after # is never sent to a web server, so no member data is stored anywhere.

function toB64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

export async function encodePayload(obj) {
  const json = new TextEncoder().encode(JSON.stringify(obj));
  const packed = await pipe(json, new CompressionStream('deflate-raw'));
  return '1.' + toB64Url(packed);
}

export async function decodePayload(str) {
  str = String(str || '').trim();
  try { str = decodeURIComponent(str); } catch { /* keep as is */ }
  if (!str.startsWith('1.')) throw new Error('Unknown link format');
  // Email apps sometimes glue a "." or ")" onto the end of a link.
  const body = str.slice(2).replace(/[^A-Za-z0-9_-]+$/, '');
  const bytes = fromB64Url(body);
  const json = await pipe(bytes, new DecompressionStream('deflate-raw'));
  const obj = JSON.parse(new TextDecoder().decode(json));
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || !obj.s || typeof obj.s !== 'object') {
    throw new Error('Unknown link format');
  }
  return obj;
}

// Short keys keep links small.
export function memberPayload(member, studio, { preview, short = false, unlockCode = '' }) {
  const s = {
    n: studio.name, y: studio.year,
  };
  if (studio.handle) s.h = studio.handle;
  if (studio.color) s.c = studio.color;
  if (studio.accent) s.a = studio.accent;
  // Short links leave the note, offer and booking link for the email itself.
  if (!short) {
    if (studio.bookingUrl) s.b = studio.bookingUrl;
    if (studio.note) s.t = studio.note;
    if (studio.offer) s.o = studio.offer;
  }
  // An unlocked link carries the studio's code so the recap page can check it.
  if (preview || !unlockCode) s.p = 1;
  else s.u = String(unlockCode).replace(/\s+/g, '');
  const out = { s, k: member.kind === 'recap' ? 'r' : 'w', f: member.firstName || '' };
  if (member.kind === 'recap') {
    const m = { n: member.total, mn: member.minutes };
    if (member.favoriteClass && member.favoriteClass[1] >= 2) m.fc = member.favoriteClass;
    if (member.favoriteInstructor && member.favoriteInstructor[1] >= 2) m.fi = member.favoriteInstructor;
    if (member.streak >= 2) m.st = member.streak;
    if (member.busiestMonth && member.busiestMonth[1] >= 2) m.bm = member.busiestMonth;
    if (member.favoriteDay) m.dw = member.favoriteDay[0];
    if (member.earliest != null) m.et = member.earliest;
    if (member.percentile >= 50) m.pc = member.percentile;
    out.m = m;
  }
  return out;
}
