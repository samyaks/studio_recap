import { MONTH_NAMES } from './dates.js';

// Booking links must be https. A bare "www.studio.com/book" gets https:// added.
export function safeUrl(u) {
  let s = String(u || '').trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s) && /^[\w-]+(\.[\w-]+)+/.test(s)) s = 'https://' + s;
  try {
    const url = new URL(s);
    return url.protocol === 'https:' && url.hostname.includes('.') ? url.href : null;
  } catch {
    return null;
  }
}

function hoursLine(minutes) {
  if (minutes < 120) return `That's ${minutes} minutes of moving.`;
  const h = Math.round(minutes / 60);
  return `That's ${h.toLocaleString('en-US')} hours of moving.`;
}

// Turns a decoded link into the list of cards to show. Plain strings only.
export function buildCards(p) {
  const s = p.s || {};
  const studio = s.n || 'your studio';
  const year = Number(s.y) || new Date().getFullYear();
  const first = p.f || '';
  const hi = first ? `Hey ${first}` : 'Hey';
  const cards = [];

  if (p.k === 'w') {
    cards.push({
      id: 'welcome', eyebrow: studio, big: 'Your spot is saved',
      line: `${hi}, ${year + 1} is almost here and we'd love to see you back on the mat.`,
      offer: s.o || '', outro: true, share: false,
    });
    return cards;
  }

  const m = p.m || {};
  // Three stat cards, then the closing card with the booking link.
  cards.push({ id: 'total', eyebrow: `${hi}, in ${year} you showed up for`, big: Number(m.n || 0).toLocaleString('en-US'), line: Number(m.n) === 1 ? 'class' : 'classes', sub: hoursLine(Number(m.mn || 0)) });
  const picks = [];
  if (m.fc) picks.push({ id: 'class', eyebrow: 'Your go-to class', big: m.fc[0], sub: `${m.fc[1]} times this year` });
  if (m.st) picks.push({ id: 'streak', eyebrow: 'Longest streak', big: String(m.st), line: 'weeks in a row', sub: 'Consistency looks good on you.' });
  if (m.fi) picks.push({ id: 'instructor', eyebrow: 'You and your favorite instructor', big: m.fi[0], sub: `${m.fi[1]} classes together` });
  if (m.bm) picks.push({ id: 'month', eyebrow: 'Your biggest month', big: MONTH_NAMES[m.bm[0] - 1], sub: `${m.bm[1]} classes` });
  cards.push(...picks.slice(0, 2));
  cards.push({
    id: 'outro', eyebrow: 'Thank you', big: `See you in ${year + 1}`,
    line: s.t || `Thanks for a great year, ${first || 'friend'}.`,
    offer: s.o || '', outro: true, share: true,
  });
  return cards;
}
