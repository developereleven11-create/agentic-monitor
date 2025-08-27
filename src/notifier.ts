
import axios from 'axios';

export type Severity = 'OK' | 'WARN' | 'FAIL';

export async function notifySlack(title: string, details: Record<string, any>, severity: Severity = 'OK') {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) {
    console.log('[notifier] No SLACK_WEBHOOK_URL set; printing message instead.');
    console.log({ title, severity, details });
    return;
  }
  const color = severity === 'OK' ? '#2eb67d' : severity === 'WARN' ? '#f2c744' : '#e01e5a';
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `${severity} · ${title}` } },
    { type: 'section', text: { type: 'mrkdwn', text: '```' + JSON.stringify(details, null, 2) + '```' } },
  ];
  await axios.post(webhook, { attachments: [{ color, blocks }] });
}
