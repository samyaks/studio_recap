import { safeHex, theme } from './lib/color.js';

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

// Shrinks text to fit, down to minSize; past that, cuts it with an ellipsis.
// Returns the text to draw.
function fitText(ctx, text, maxWidth, startSize, minSize, weight) {
  text = String(text || '');
  for (let size = startSize; size >= minSize; size -= 4) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    if (ctx.measureText(text).width <= maxWidth) return text;
  }
  ctx.font = `${weight} ${minSize}px ${FONT}`;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(cut + '…').width > maxWidth) cut = cut.slice(0, -1);
  return cut.trimEnd() + '…';
}

// Draws a 1080x1920 story image for the member to post. Content stays between
// y=270 and y=1580 so Instagram's top bar and reply box don't cover it.
export async function makeShareImage(p) {
  const s = p.s || {}, m = p.m || {};
  const W = 1080, H = 1920, pad = 96, maxW = W - pad * 2;
  const t = theme(s.c);
  const accent = safeHex(s.a, '#f2c14e');
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, t.start);
  g.addColorStop(1, t.end);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = t.fg;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(fitText(ctx, s.n || '', maxW, 56, 34, 600), pad, 330);
  ctx.fillStyle = accent;
  ctx.fillRect(pad, 370, 140, 14);
  ctx.fillStyle = t.fg;

  const title = `${p.f ? p.f + "'s" : 'My'} ${s.y || ''}`.trim();
  ctx.fillText(fitText(ctx, title, maxW, 110, 60, 800), pad, 520);

  const big = Number(m.n || 0).toLocaleString('en-US');
  ctx.fillText(fitText(ctx, big, maxW, 360, 160, 900), pad - 8, 880);
  ctx.font = `600 72px ${FONT}`;
  ctx.fillText(Number(m.n) === 1 ? 'class' : 'classes', pad, 975);

  const lines = [];
  if (m.fc) lines.push(['Go-to class', m.fc[0]]);
  if (m.st) lines.push(['Longest streak', `${m.st} weeks`]);
  if (m.mn) lines.push(['Time moving', m.mn < 120 ? `${m.mn} minutes` : `${Math.round(m.mn / 60).toLocaleString('en-US')} hours`]);
  let y = 1110;
  for (const [label, value] of lines.slice(0, 3)) {
    ctx.font = `500 42px ${FONT}`;
    ctx.globalAlpha = 0.8;
    ctx.fillText(label, pad, y);
    ctx.globalAlpha = 1;
    ctx.fillText(fitText(ctx, value, maxW, 72, 44, 700), pad, y + 78);
    y += 160;
  }

  if (s.h) {
    ctx.fillText(fitText(ctx, '@' + String(s.h).replace(/^@/, ''), maxW, 52, 34, 700), pad, 1570);
  }

  if (s.p) {
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(-Math.PI / 6);
    ctx.globalAlpha = 0.18;
    ctx.font = `900 200px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('PREVIEW', 0, 0);
    ctx.restore();
  }

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

// Opens the phone's share sheet with the image, or falls back to showing it to save.
export async function shareImage(blob, filename, title) {
  const file = new File([blob], filename, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
    }
  }
  return 'fallback';
}

// A square image of the whole studio's year, for the owner to post.
export async function makeStudioImage(summary, studio, { preview }) {
  const W = 1080, H = 1350, pad = 90;
  const t = theme(studio.color);
  const fg = t.fg;
  const accent = safeHex(studio.accent, '#f2c14e');
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, t.start);
  g.addColorStop(1, t.end);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = fg;
  ctx.fillText(fitText(ctx, studio.name || '', W - pad * 2, 60, 32, 700), pad, 150);
  ctx.fillStyle = accent;
  ctx.fillRect(pad, 190, 120, 12);
  ctx.fillStyle = fg;
  ctx.font = '800 96px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(`Our ${summary.year}`, pad, 330);

  const stats = [
    [summary.totalClasses.toLocaleString('en-US'), 'classes taken'],
    [summary.totalHours.toLocaleString('en-US'), 'hours of moving'],
    [summary.members.toLocaleString('en-US'), 'people in the room'],
  ];
  let y = 520;
  for (const [num, label] of stats) {
    ctx.font = '850 120px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(num, pad, y);
    ctx.globalAlpha = 0.8;
    ctx.font = '600 44px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(label, pad, y + 62);
    ctx.globalAlpha = 1;
    y += 230;
  }
  if (summary.topClasses && summary.topClasses[0]) {
    ctx.globalAlpha = 0.8;
    ctx.font = '600 40px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('Most loved class', pad, y);
    ctx.globalAlpha = 1;
    ctx.fillText(fitText(ctx, summary.topClasses[0][0], W - pad * 2, 70, 36, 800), pad, y + 76);
  }
  if (studio.handle) {
    ctx.fillText(fitText(ctx, '@' + String(studio.handle).replace(/^@/, ''), W - pad * 2, 44, 30, 600), pad, H - 70);
  }
  if (preview) {
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(-Math.PI / 6);
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = fg;
    ctx.font = '900 180px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('PREVIEW', 0, 0);
    ctx.restore();
  }
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
