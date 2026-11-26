// Sends script errors to /api/client-error so they land in the site's logs.
// Never sends the part of the address after # (that's where member data lives) or any page content.
let sent = 0;

function send(message, source, line, col) {
  if (sent >= 5 || !navigator.sendBeacon) return;
  sent++;
  let file = '';
  try { file = source ? new URL(source, location.href).pathname : ''; } catch { /* ignore */ }
  const body = JSON.stringify({ page: location.pathname, message: String(message || '').slice(0, 300), source: file, line, col });
  try { navigator.sendBeacon('/api/client-error', new Blob([body], { type: 'application/json' })); } catch { /* ignore */ }
}

window.addEventListener('error', (e) => send(e.message, e.filename, e.lineno, e.colno));
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  send(r && r.message ? r.message : 'Unhandled promise rejection', '', 0, 0);
});
