// Sends a plain-text email through Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email).
export async function sendMail(env, { to, subject, text, replyTo }, fetchImpl = fetch) {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) throw new Error('Mail is not set up: RESEND_API_KEY and MAIL_FROM are needed');
  const body = { from: env.MAIL_FROM, to: [to], subject, text };
  if (replyTo) body.reply_to = replyTo;
  const res = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Resend answered ${res.status}`);
}
