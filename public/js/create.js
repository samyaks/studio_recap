import { CONFIG } from './config.js';
import { parseCSV, toCSV } from './lib/csv.js';
import { FIELDS, guessMapping, findHeaderRow, applyMapping } from './lib/mapping.js';
import { guessDayFirst } from './lib/dates.js';
import { computeRecaps } from './lib/stats.js';
import { encodePayload, memberPayload } from './lib/codec.js';
import { verifyUnlock, ed25519Supported, normalizeStudioName, cleanCode } from './lib/unlock.js';
import { safeUrl } from './lib/cards.js';
import { pickSampleMembers } from './lib/samples.js';
import { purchaseCovers } from './lib/purchase.js';
import { makeStudioImage } from './share.js';

const $ = (id) => document.getElementById(id);
const state = { header: [], rows: [], mapping: {}, result: null, unlocked: false, unlockCode: '', account: null, selected: null, shown: null, fileName: '' };

document.querySelectorAll('[data-product-name]').forEach((e) => { e.textContent = CONFIG.productName; });
if (safeUrl(CONFIG.paymentLink)) {
  const a = document.createElement('a');
  a.href = CONFIG.paymentLink; a.target = '_blank'; a.rel = 'noopener';
  a.textContent = `Buy for ${CONFIG.price}`;
  $('buyWrap').append('No code yet? ', a, ' and we\'ll email you one for your studio name.');
}

function enable(id, on) { const e = $(id); e.setAttribute('aria-disabled', on ? 'false' : 'true'); e.inert = !on; }
['step2', 'step3', 'step4', 'step5'].forEach((id) => enable(id, false));
function setMsg(id, text, cls = '') { const e = $(id); e.textContent = text; e.className = cls; }

// ---------- Step 1: load a file ----------
function loadText(text, name) {
  const all = parseCSV(text);
  if (all.length < 2) { setMsg('fileMsg', "That file doesn't look like a CSV with visits in it.", 'err'); return; }
  const hi = findHeaderRow(all);
  state.header = all[hi];
  state.rows = all.slice(hi + 1);
  state.mapping = guessMapping(state.header);
  state.fileName = name;
  state.selected = null;
  state.shown = null;
  shownSrc = '';
  shownStamp = '';
  yearsFilled = '';
  $('sYear').textContent = '';
  setMsg('fileMsg', `${name}: ${state.rows.length.toLocaleString('en-US')} rows read.`, 'ok');
  const dateCol = state.mapping.date;
  if (dateCol != null) $('dateOrder').value = guessDayFirst(state.rows.map((r) => r[dateCol])) ? 'dm' : 'md';
  renderMapping();
  enable('step2', true);
  recompute();
}

$('drop').addEventListener('click', () => $('file').click());
$('drop').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('file').click(); } });
$('file').addEventListener('change', (e) => readFile(e.target.files[0]));
$('drop').addEventListener('dragover', (e) => { e.preventDefault(); $('drop').classList.add('over'); });
$('drop').addEventListener('dragleave', () => $('drop').classList.remove('over'));
$('drop').addEventListener('drop', (e) => { e.preventDefault(); $('drop').classList.remove('over'); readFile(e.dataTransfer.files[0]); });

function readFile(f) {
  if (!f) return;
  if (/\.xlsx?$/i.test(f.name)) { setMsg('fileMsg', 'That is an Excel file. Open it and save it as CSV first.', 'err'); return; }
  if (f.size > 50 * 1024 * 1024) { setMsg('fileMsg', 'That file is over 50 MB. Export one year only.', 'err'); return; }
  // Excel on Windows often saves CSV as Windows-1252, which garbles names like José as UTF-8.
  f.arrayBuffer().then((buf) => {
    let text = new TextDecoder('utf-8').decode(buf);
    if (text.includes('\ufffd')) {
      try { text = new TextDecoder('windows-1252').decode(buf); } catch { /* keep utf-8 */ }
    }
    loadText(text, f.name);
  }, () => setMsg('fileMsg', "Couldn't read that file.", 'err'));
}

$('demoBtn').addEventListener('click', async () => {
  setMsg('fileMsg', 'Loading the sample studio...');
  const res = await fetch('samples/demo-studio.csv');
  loadText(await res.text(), 'Sample studio (made-up members)');
  if (!$('sName').value) {
    $('sName').value = 'Juniper Yoga + Pilates';
    $('sHandle').value = 'juniperyoga';
    $('sNote').value = 'Thank you for showing up for yourself this year. We loved every class with you.';
    $('sOffer').value = 'Bring a friend free to any class in January';
    $('sBook').value = 'https://example.com/book';
  }
  recompute();
});

// ---------- Step 2: mapping ----------
function renderMapping() {
  const box = $('mapping');
  box.textContent = '';
  for (const f of FIELDS) {
    const wrap = document.createElement('div');
    const label = document.createElement('label');
    label.textContent = f.label + (f.required ? ' *' : '');
    label.htmlFor = 'map_' + f.key;
    const sel = document.createElement('select');
    sel.id = 'map_' + f.key;
    const none = document.createElement('option');
    none.value = ''; none.textContent = '(none)';
    sel.appendChild(none);
    state.header.forEach((h, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      const sample = (state.rows.find((r) => r[i]) || [])[i] || '';
      o.textContent = `${h || 'Column ' + (i + 1)}${sample ? ' (e.g. ' + sample.slice(0, 24) + ')' : ''}`;
      sel.appendChild(o);
    });
    sel.value = state.mapping[f.key] != null ? String(state.mapping[f.key]) : '';
    sel.addEventListener('change', () => {
      if (sel.value === '') delete state.mapping[f.key];
      else state.mapping[f.key] = Number(sel.value);
      recompute();
    });
    wrap.append(label, sel);
    box.appendChild(wrap);
  }
}
$('dateOrder').addEventListener('change', () => recompute());

// ---------- Step 3: studio settings ----------
function studio() {
  return {
    name: $('sName').value.trim() || 'Your Studio',
    handle: $('sHandle').value.trim().replace(/^@/, ''),
    color: $('sColor').value,
    accent: $('sAccent').value,
    bookingUrl: safeUrl($('sBook').value.trim()) || '',
    note: $('sNote').value.trim(),
    offer: $('sOffer').value.trim(),
    year: Number($('sYear').value) || (state.result && state.result.summary.year),
  };
}
$('sBook').addEventListener('change', () => {
  const v = $('sBook').value.trim();
  const ok = safeUrl(v);
  if (ok) $('sBook').value = ok;
  $('sBook').setCustomValidity(v && !ok ? 'Use a full https:// link to your booking page.' : '');
  $('sBook').reportValidity();
});
['sName', 'sHandle', 'sColor', 'sAccent', 'sBook', 'sNote', 'sOffer', 'sShort'].forEach((id) => $(id).addEventListener('input', () => { refreshPreview(); if (id === 'sName') checkUnlock(); }));
['sMin', 'sMinutes', 'sYear'].forEach((id) => $(id).addEventListener('input', () => recompute()));

// ---------- Compute ----------
let timer = null;
function recompute() {
  clearTimeout(timer);
  timer = setTimeout(doCompute, 120);
}

function doCompute() {
  $('sMinVal').textContent = $('sMin').value;
  const m = state.mapping;
  const hasMember = m.memberId != null || m.email != null || m.fullName != null || m.firstName != null;
  if (m.date == null || !hasMember) {
    setMsg('mapMsg', 'Pick the class date column and at least one of member ID, email or name.', 'err');
    ['step3', 'step4', 'step5'].forEach((s) => enable(s, false));
    return;
  }
  const visits = applyMapping(state.rows, m, state.header);
  const yearPick = Number($('sYear').value) || undefined;
  const result = computeRecaps(visits, {
    year: yearPick,
    threshold: Number($('sMin').value),
    defaultMinutes: Number($('sMinutes').value) || 50,
    dayFirst: $('dateOrder').value === 'dm',
  });
  state.result = result;
  fillYears(visits, result.summary.year);
  const { summary } = result;
  if (!summary.members) {
    setMsg('mapMsg', `No visits in ${summary.year} could be read. Check the date column and date order.`, 'err');
    ['step3', 'step4', 'step5'].forEach((s) => enable(s, false));
    return;
  }
  const noEmail = m.email == null;
  setMsg('mapMsg', `Looks good: ${summary.totalClasses.toLocaleString('en-US')} visits from ${summary.members} members in ${summary.year}.`
    + (noEmail ? ' There is no email column, so the download will list members by ID and name for you to match up in your email tool.' : ''), noEmail ? 'warn' : 'ok');
  ['step3', 'step4', 'step5'].forEach((s) => enable(s, true));
  const samples = pickSampleMembers(result.members);
  const selected = result.members.find((x) => x.key === state.selected);
  const keep = selected && (state.unlocked || samples.some((s) => s.key === selected.key));
  if (!keep) state.selected = samples[0] ? samples[0].key : null;
  renderSplit();
  renderMembers();
  checkUnlock();
  refreshPreview();
}

let yearsFilled = '';
function fillYears(visits, current) {
  const ys = new Set();
  const col = state.mapping.date;
  for (const r of state.rows.slice(0, 20000)) {
    const m = String(r[col] || '').match(/(19|20)\d{2}/);
    if (m) ys.add(Number(m[0]));
  }
  const list = [...ys].sort((a, b) => b - a);
  const key = list.join(',');
  if (key === yearsFilled) return;
  yearsFilled = key;
  const sel = $('sYear');
  sel.textContent = '';
  for (const y of list.length ? list : [current]) {
    const o = document.createElement('option');
    o.value = String(y); o.textContent = String(y);
    sel.appendChild(o);
  }
  sel.value = String(current);
}

function chip(label, n) {
  const c = document.createElement('span');
  c.className = 'chip';
  const b = document.createElement('b');
  b.textContent = n.toLocaleString('en-US');
  c.append(b, ' ' + label);
  return c;
}

function renderSplit() {
  const s = state.result.summary;
  const box = $('split');
  box.textContent = '';
  box.append(chip('get a recap', s.recaps), chip('get the welcome-back note', s.welcomes), chip('on packs or drop-ins (always a recap)', s.packs));
  const p = s.problems;
  const bits = [];
  if (p.skippedStatus) bits.push(`${p.skippedStatus.toLocaleString('en-US')} cancellations or no-shows left out`);
  if (p.otherYear) bits.push(`${p.otherYear.toLocaleString('en-US')} visits from other years left out`);
  if (p.badDate) bits.push(`${p.badDate.toLocaleString('en-US')} rows with a date we couldn't read`);
  if (p.noMember) bits.push(`${p.noMember.toLocaleString('en-US')} rows with no member`);
  if (p.future) bits.push(`${p.future.toLocaleString('en-US')} upcoming bookings left out`);
  $('problems').textContent = bits.length ? bits.join('. ') + '.' : '';
}

function renderMembers() {
  const q = $('search').value.trim().toLowerCase();
  const body = $('members');
  body.textContent = '';
  const list = state.result.members.filter((m) => !q || `${m.firstName} ${m.lastName} ${m.email}`.toLowerCase().includes(q)).slice(0, 300);
  for (const m of list) {
    const tr = document.createElement('tr');
    tr.className = 'pick' + (m.key === state.selected ? ' on' : '');
    const name = document.createElement('td'); name.textContent = `${m.firstName} ${m.lastName}`.trim() || m.email;
    const visits = document.createElement('td'); visits.textContent = String(m.total);
    const pm = document.createElement('td'); pm.textContent = m.perMonth.toFixed(1);
    const gets = document.createElement('td');
    const tag = document.createElement('span');
    tag.className = 'tag ' + (m.kind === 'recap' ? 'r' : 'w');
    tag.textContent = m.kind === 'recap' ? 'Recap' : 'Welcome back';
    gets.appendChild(tag);
    tr.append(name, visits, pm, gets);
    tr.addEventListener('click', () => { state.selected = m.key; renderMembers(); refreshPreview(); });
    body.appendChild(tr);
  }
}
$('search').addEventListener('input', renderMembers);

function linkBase() {
  return new URL('r.html', location.href).href.split('#')[0];
}

function linkOptions() {
  // Sample links stay clean while locked. An unlocked studio is clean too.
  return { preview: false, short: $('sShort').checked, unlockCode: CONFIG.signedLinks ? state.unlockCode : '' };
}

function lockedLine(member) {
  const who = member ? (`${member.firstName} ${member.lastName}`.trim() || member.email) : '';
  return who ? `${who}'s recap is part of the full list.` : 'This recap is part of the full list.';
}

let previewTimer = null;
let previewSeq = 0;
let shownSrc = '';
let shownStamp = '';
function studioStamp() {
  const s = studio();
  return JSON.stringify([s.name, s.handle, s.color, s.accent, s.bookingUrl, s.note, s.offer, s.year, $('sShort').checked, state.unlockCode]);
}
function refreshPreview() {
  clearTimeout(previewTimer);
  const seq = ++previewSeq;
  previewTimer = setTimeout(async () => {
    if (seq !== previewSeq || !state.result) return;
    const samples = pickSampleMembers(state.result.members);
    const isSample = (key) => samples.some((s) => s.key === key);
    const selected = state.result.members.find((x) => x.key === state.selected);
    const open = !!selected && (state.unlocked || isSample(selected.key));
    let m = open ? selected : state.result.members.find((x) => x.key === state.shown && isSample(x.key));
    if (!m) m = samples[0];
    if (!m) return;
    // A locked row that isn't a sample only changes the caption. Rebuilding the
    // link would reload the phone even when the sample on screen is unchanged.
    const stamp = studioStamp();
    if (!open && state.shown === m.key && shownStamp === stamp) {
      $('previewName').textContent = lockedLine(selected);
      return;
    }
    const src = linkBase() + '#' + await encodePayload(memberPayload(m, studio(), linkOptions()));
    if (seq !== previewSeq) return;
    state.shown = m.key;
    shownStamp = stamp;
    if (shownSrc !== src) { shownSrc = src; $('preview').src = src; }
    $('previewName').textContent = open
      ? `${m.firstName || m.email}: ${m.kind === 'recap' ? 'recap' : 'welcome-back note'}`
      : lockedLine(selected);
  }, 150);
}

// ---------- Account, checkout, and the unlock code ----------
function typedStudioName() { return $('sName').value.trim(); }

function paidForThisStudio() {
  const purchases = state.account && state.account.purchases;
  return purchaseCovers(purchases, typedStudioName(), studio().year);
}

function paintAccount() {
  const email = state.account && state.account.email;
  const paid = paidForThisStudio();
  if (email) {
    $('accountMsg').textContent = `Signed in as ${email}.`;
    $('buyerEmail').hidden = true;
    $('signInRow').hidden = true;
  } else {
    $('accountMsg').textContent = '';
    $('buyerEmail').hidden = false;
    $('signInRow').hidden = false;
  }
  const n = state.result && state.result.summary.members;
  $('buyList').textContent = n ? `Unlock all ${n.toLocaleString('en-US')} links` : 'Unlock the rest';
  $('buyRow').hidden = paid;
}

async function refreshAccount() {
  try {
    const res = await fetch('/api/me');
    state.account = res.ok ? await res.json() : null;
  } catch {
    state.account = null;
  }
  paintAccount();
  await checkUnlock();
}

function buyerEmail() {
  return ((state.account && state.account.email) || $('buyerEmail').value || '').trim();
}

function validBuyerEmail(email) {
  return email.length > 0 && email.length <= 200 && !/\s/.test(email) && email.split('@').length === 2 && email[0] !== '@' && !email.endsWith('@');
}

$('buyList').addEventListener('click', async () => {
  if (!state.result) return;
  const name = typedStudioName();
  const year = studio().year;
  const email = buyerEmail();
  if (!normalizeStudioName(name)) { setMsg('buyMsg', 'Add your studio name in step 3 first.', 'err'); return; }
  if (!year) { setMsg('buyMsg', 'Pick a year in step 3 first.', 'err'); return; }
  if (!validBuyerEmail(email)) { setMsg('buyMsg', 'Add the email for the receipt and sign-in.', 'err'); return; }
  $('buyList').disabled = true;
  setMsg('buyMsg', 'Opening checkout...');
  try {
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studioName: name, year, email }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || typeof data.url !== 'string' || !data.url.startsWith('https://')) {
      setMsg('buyMsg', res.status === 500 ? "Checkout isn't set up on this site yet." : "Checkout didn't start. Try again.", 'err');
      $('buyList').disabled = false;
      return;
    }
    location.href = data.url;
  } catch {
    setMsg('buyMsg', "Checkout didn't start. Try again.", 'err');
    $('buyList').disabled = false;
  }
});

$('signInBtn').addEventListener('click', async () => {
  const email = buyerEmail();
  if (!validBuyerEmail(email)) { setMsg('buyMsg', 'Add the email to send the sign-in link to.', 'err'); return; }
  $('signInBtn').disabled = true;
  setMsg('buyMsg', 'Sending a sign-in link...');
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (res.ok) setMsg('buyMsg', `Check ${email} for a sign-in link. It expires in 15 minutes.`, 'ok');
    else if (res.status === 500) setMsg('buyMsg', "Sign-in isn't set up on this site yet.", 'err');
    else setMsg('buyMsg', "The sign-in email didn't send. Try again.", 'err');
  } catch {
    setMsg('buyMsg', "The sign-in email didn't send. Try again.", 'err');
  }
  $('signInBtn').disabled = false;
});

let unlockSeq = 0;
async function checkUnlock() {
  const seq = ++unlockSeq;
  const code = $('code').value.trim();
  const s = studio();
  const paid = paidForThisStudio();
  let codeOk = false, msg = '', cls = '';
  if (paid && !code) {
    msg = `Unlocked for ${s.name}, ${s.year}.`; cls = 'ok';
  } else if (!CONFIG.unlockPublicKey) {
    if (!paid && state.result) { msg = 'Unlocking isn\'t set up on this site yet, so only two sample members are ready to view and send.'; cls = 'hint'; }
  } else if (!code) {
    msg = '';
  } else if (!normalizeStudioName(typedStudioName())) {
    msg = 'Add your studio name in step 3 first.'; cls = 'err';
  } else if (!(await ed25519Supported())) {
    msg = 'This browser is too old to check unlock codes. Update it, or use a current Chrome, Safari, Edge or Firefox.'; cls = 'err';
  } else {
    codeOk = await verifyUnlock(code, s.name, s.year, CONFIG.unlockPublicKey);
    if (codeOk) { msg = `Unlocked for ${s.name}, ${s.year}.`; cls = 'ok'; }
    else if (paid) { msg = `That code doesn't match, but ${s.name} ${s.year} is already paid, so the full list is unlocked.`; cls = 'ok'; }
    else { msg = 'That code doesn\'t match this studio name and year. Check both match your code email: the name as you typed it when you paid, and the year you picked.'; cls = 'err'; }
  }
  if (seq !== unlockSeq) return; // a newer check started while this one ran
  const ok = codeOk || paid;
  const newCode = codeOk ? cleanCode(code) : '';
  if (ok !== state.unlocked || newCode !== state.unlockCode) { state.unlocked = ok; state.unlockCode = newCode; refreshPreview(); }
  setMsg('unlockMsg', msg, cls);
  paintAccount();
}
$('unlockBtn').addEventListener('click', checkUnlock);
$('code').addEventListener('change', checkUnlock);

const checkoutFlag = new URLSearchParams(location.search).get('checkout');
if (checkoutFlag === 'cancel') setMsg('buyMsg', 'Checkout was canceled. Your two samples are still here.', 'hint');
if (checkoutFlag === 'success') setMsg('buyMsg', 'Payment received. Sign in with the same email and the full list unlocks here.', 'ok');

refreshAccount().then(() => {
  if (checkoutFlag !== 'success' || !(state.account && state.account.email)) return;
  let tries = 0;
  const timer = setInterval(async () => {
    tries += 1;
    await refreshAccount();
    if (paidForThisStudio() || tries >= 5) clearInterval(timer);
  }, 2000);
});

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'studio'; }

$('dlLinks').addEventListener('click', async () => {
  if (!state.result) return;
  await checkUnlock();
  const s = studio();
  const short = $('sShort').checked;
  const base = linkBase();
  const rows = [['email', 'first_name', 'last_name', 'member_id', 'message', 'classes', 'link']];
  const list = state.unlocked ? state.result.members : pickSampleMembers(state.result.members);
  for (const m of list) {
    const link = base + '#' + (await encodePayload(memberPayload(m, s, linkOptions())));
    const id = m.key.startsWith('id:') ? m.key.slice(3) : '';
    rows.push([m.email, m.firstName, m.lastName, id, m.kind === 'recap' ? 'recap' : 'welcome_back', m.kind === 'recap' ? m.total : '', link]);
  }
  const noEmail = list.filter((m) => !m.email).length;
  // The BOM makes Excel read accented names correctly.
  download(new Blob(['\ufeff' + toCSV(rows)], { type: 'text/csv;charset=utf-8' }), `${slug(s.name)}-${s.year}-recap-links${state.unlocked ? '' : '-sample'}.csv`);
  const extra = state.unlocked ? '' : ' These are the sample links. The rest download after unlock.';
  setMsg('unlockMsg', `${rows.length - 1} links downloaded${noEmail ? `; ${noEmail} have no email in your export, so match them by member ID or name` : ''}.${extra}`, state.unlocked ? 'ok' : 'warn');
});

$('dlStudio').addEventListener('click', async () => {
  if (!state.result) return;
  await checkUnlock();
  if (!state.unlocked) {
    setMsg('unlockMsg', 'The studio image is part of the full list.', 'warn');
    return;
  }
  const s = studio();
  const blob = await makeStudioImage(state.result.summary, s, { preview: !state.unlocked });
  if (blob) download(blob, `${slug(s.name)}-${s.year}-studio.png`);
});
