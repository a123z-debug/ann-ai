// Sends one-time login codes by SMS.
// Taqnyat: TAQNYAT_TOKEN + TAQNYAT_SENDER (https://dev.taqnyat.sa/en/doc/sms).
// Any other provider: SMS_WEBHOOK_URL receives POST {to, message} (+ SMS_WEBHOOK_TOKEN as Bearer).

function configured() {
  return Boolean((process.env.TAQNYAT_TOKEN && process.env.TAQNYAT_SENDER) || process.env.SMS_WEBHOOK_URL);
}

async function send(to966, message) {
  if (process.env.TAQNYAT_TOKEN && process.env.TAQNYAT_SENDER) {
    const r = await fetch('https://api.taqnyat.sa/v1/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.TAQNYAT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipients: [to966], body: message, sender: process.env.TAQNYAT_SENDER })
    });
    if (r.status !== 201 && r.status !== 200) throw new Error('sms_failed_' + r.status);
    return true;
  }
  if (process.env.SMS_WEBHOOK_URL) {
    const h = { 'Content-Type': 'application/json' };
    if (process.env.SMS_WEBHOOK_TOKEN) h.Authorization = `Bearer ${process.env.SMS_WEBHOOK_TOKEN}`;
    const r = await fetch(process.env.SMS_WEBHOOK_URL, { method: 'POST', headers: h, body: JSON.stringify({ to: to966, message }) });
    if (!r.ok) throw new Error('sms_failed_' + r.status);
    return true;
  }
  throw new Error('sms_not_configured');
}

module.exports = { configured, send };
