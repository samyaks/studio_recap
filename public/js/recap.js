import { CONFIG } from './config.js';
import { decodePayload } from './lib/codec.js';
import { linkUnlocked } from './lib/unlock.js';
import { buildCards, safeUrl } from './lib/cards.js';
import { safeHex, textOn, theme } from './lib/color.js';
import { makeShareImage, shareImage } from './share.js';

const story = document.getElementById('story');
const status = document.getElementById('status');
const dialog = document.getElementById('saveimg');
const finePointer = window.matchMedia && window.matchMedia('(pointer: fine)').matches;
let cards = [], index = 0, payload = null, imagePromise = null, sharing = false, objectUrl = null;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function showError(text) {
  story.textContent = '';
  story.appendChild(el('p', 'error', text));
}

function applyTheme(s) {
  const t = theme(s.c);
  const accent = safeHex(s.a, '#f2c14e');
  const root = document.documentElement.style;
  root.setProperty('--bg-start', t.start);
  root.setProperty('--fg', t.fg);
  root.setProperty('--accent', accent);
  root.setProperty('--accent-fg', textOn(accent));
  story.style.background = `linear-gradient(160deg, ${t.start}, ${t.end})`;
}

function render() {
  story.textContent = '';
  const bars = el('div', 'bars');
  bars.setAttribute('aria-hidden', 'true');
  cards.forEach(() => { const b = el('span'); b.appendChild(el('i')); bars.appendChild(b); });
  story.appendChild(bars);
  if (payload.s.p) {
    const r = el('div', 'ribbon', 'PREVIEW');
    r.setAttribute('aria-label', 'Preview only');
    story.appendChild(r);
  }

  const prev = el('button', 'tap prev'); prev.type = 'button'; prev.setAttribute('aria-label', 'Previous');
  const next = el('button', 'tap next'); next.type = 'button'; next.setAttribute('aria-label', 'Next');
  prev.addEventListener('click', () => go(index - 1));
  next.addEventListener('click', () => go(index + 1));
  story.append(prev, next);

  cards.forEach((c, i) => {
    const card = el('section', 'card' + (c.outro ? ' outro' : ''));
    card.setAttribute('aria-label', `Card ${i + 1} of ${cards.length}`);
    card.appendChild(el('div', 'accent'));
    card.appendChild(el('p', 'eyebrow', c.eyebrow)).style.margin = '0 0 14px';
    const big = el('h1', 'big' + (String(c.big).length > 7 ? ' long' : ''), c.big);
    big.tabIndex = -1;
    card.appendChild(big);
    if (c.line) card.appendChild(el('p', 'line', c.line)).style.marginBottom = '0';
    if (c.sub) card.appendChild(el('p', 'sub', c.sub)).style.marginBottom = '0';
    if (c.offer) {
      const o = el('div', 'offer');
      o.appendChild(el('small', null, 'A little something for you'));
      o.appendChild(document.createTextNode(c.offer));
      card.appendChild(o);
    }
    if (c.outro) {
      const actions = el('div', 'actions');
      if (c.share) {
        const b = el('button', 'primary', 'Share my year');
        b.type = 'button';
        b.addEventListener('click', () => onShare(b));
        actions.appendChild(b);
      }
      const book = safeUrl(payload.s.b);
      if (book) {
        const a = el('a', c.share ? 'ghost' : 'primary', 'Book a class');
        a.href = book; a.target = '_blank'; a.rel = 'noopener noreferrer';
        actions.appendChild(a);
        actions.appendChild(el('div', 'host', 'Opens ' + new URL(book).hostname.replace(/^www\./, '')));
      }
      if (c.share) {
        const again = el('button', 'ghost', 'Watch again');
        again.type = 'button';
        again.addEventListener('click', () => go(0));
        actions.appendChild(again);
      }
      card.appendChild(actions);
    }
    story.appendChild(card);
  });
  go(0, true);
}

function go(i, initial = false) {
  if (i < 0 || i >= cards.length || !dialog.hidden) return;
  index = i;
  story.querySelectorAll('.card').forEach((s, j) => {
    const on = j === i;
    s.classList.toggle('on', on);
    s.inert = !on;
    if (on) s.scrollTop = 0;
  });
  story.querySelectorAll('.bars span').forEach((b, j) => {
    b.classList.toggle('done', j < i);
    b.classList.toggle('now', j === i);
  });
  // On the last card the buttons need taps, so the tap zones step aside.
  const last = cards[i].outro;
  story.querySelectorAll('.tap').forEach((t) => { t.hidden = last; });
  status.textContent = `${cards[i].eyebrow}: ${cards[i].big}${cards[i].line ? ', ' + cards[i].line : ''}`;
  if (!initial) {
    const h = story.querySelectorAll('.card')[i].querySelector('.big');
    if (h) h.focus({ preventScroll: true });
  }
  // Draw the share image ahead of time so the share sheet opens straight from the tap.
  if (last && cards[i].share && !imagePromise) imagePromise = makeShareImage(payload);
}

function fileName() {
  return (payload.s.n ? String(payload.s.n).replace(/[^a-z0-9]+/gi, '-').toLowerCase() : 'my') + '-year.png';
}

function openDialog(blob) {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(blob);
  document.getElementById('saveimgPic').src = objectUrl;
  const link = document.getElementById('saveimgLink');
  link.href = objectUrl; link.download = fileName();
  document.getElementById('saveimgText').textContent = finePointer
    ? 'Download the image, then post it to your story from your phone.'
    : 'Press and hold the image to save it, then post it to your story.';
  dialog.hidden = false;
  story.inert = true;
  link.focus();
}

function closeDialog() {
  dialog.hidden = true;
  story.inert = false;
  const b = story.querySelector('.card.on .actions .primary');
  if (b) b.focus();
}

async function onShare(button) {
  if (sharing) return;
  sharing = true;
  button.disabled = true;
  try {
    if (!imagePromise) imagePromise = makeShareImage(payload);
    const blob = await imagePromise;
    if (!blob) return;
    // Desktop share panels often have no Save option, so go straight to download there.
    const result = finePointer ? 'fallback' : await shareImage(blob, fileName(), 'My year');
    if (result === 'fallback') openDialog(blob);
  } finally {
    sharing = false;
    button.disabled = false;
  }
}

document.getElementById('saveimgClose').addEventListener('click', closeDialog);

document.addEventListener('keydown', (e) => {
  if (!dialog.hidden) {
    if (e.key === 'Escape') closeDialog();
    return;
  }
  if (e.target && e.target.closest && e.target.closest('.actions')) return;
  if (e.key === 'ArrowRight') go(index + 1);
  if (e.key === 'ArrowLeft') go(index - 1);
});

let touchX = null;
story.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
story.addEventListener('touchend', (e) => {
  if (touchX == null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  touchX = null;
  if (Math.abs(dx) > 50) go(index + (dx < 0 ? 1 : -1));
});

async function load() {
  imagePromise = null;
  if (typeof DecompressionStream === 'undefined') {
    showError('This recap needs a newer browser. Update your phone, or open the link in Chrome or Safari.');
    return;
  }
  try {
    payload = await decodePayload(location.hash.slice(1));
  } catch {
    showError('This link looks incomplete. Try opening it straight from the email your studio sent, or copy the whole link.');
    return;
  }
  // With signed links on, the PREVIEW mark (here and on the share image) comes from checking
  // the link's code, not from a flag anyone could delete.
  const unlocked = CONFIG.signedLinks ? await linkUnlocked(payload.s, CONFIG.unlockPublicKey) : !payload.s.p;
  payload.s.p = unlocked ? 0 : 1;
  applyTheme(payload.s);
  const studioName = payload.s.n || 'your studio';
  document.title = payload.k === 'w'
    ? `A note from ${studioName}`
    : `${payload.f ? payload.f + "'s" : 'Your'} year at ${studioName}`;
  cards = buildCards(payload);
  render();
}

window.addEventListener('hashchange', load);
load();
