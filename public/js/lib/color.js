export function parseHex(hex) {
  const m = String(hex || '').trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function safeHex(hex, fallback) {
  const rgb = parseHex(hex);
  if (!rgb) return fallback;
  return '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
}

function channel(v) {
  v /= 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function luminance(hex) {
  const rgb = parseHex(hex) || [0, 0, 0];
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

// Black or white, whichever reads better on the background.
export function textOn(hex) {
  const L = luminance(hex);
  const contrastWhite = 1.05 / (L + 0.05);
  const contrastBlack = (L + 0.05) / 0.05;
  return contrastWhite >= contrastBlack ? '#ffffff' : '#111111';
}

export function mix(hexA, hexB, t) {
  const a = parseHex(hexA) || [0, 0, 0], b = parseHex(hexB) || [0, 0, 0];
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

export function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Background gradient and text color that stay readable from top to bottom.
// Dark brand colors fade darker under white text; light ones fade lighter under black text.
export function theme(hex) {
  const base = safeHex(hex, '#1f2a44');
  const fg = textOn(base);
  const toward = fg === '#ffffff' ? '#000000' : '#ffffff';
  let start = base;
  for (let t = 0.05; contrast(fg, start) < 4.5 && t <= 0.7; t += 0.05) start = mix(base, toward, t);
  const end = mix(start, toward, 0.3);
  return { start, end, fg };
}
