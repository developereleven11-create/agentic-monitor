// src/notifier.ts
import axios from 'axios';
import type { JourneyLog } from './agent.js';

export type Severity = 'OK' | 'WARN' | 'FAIL';

// Details we send to Slack (now allows optional error/screenshot)
type SlackDetails = {
  summary: string;
  log: JourneyLog;
  url: any; // { STORE_URL, PRODUCT_URL }
  error?: string;
  screenshot?: string | null;
};

function formatLog(log: JourneyLog): string {
  return log.steps
    .map(s => {
      const status = s.ok ? '✅' : '❌';
      return `${status} ${s.name} — ${s.ms}ms${s.error ? ` (error: ${s.error})` : ''}`;
    })
    .join('\n');
}

export async function notifySlack(
  title: string,
  details: SlackDetails,
  severity: Severity = 'OK'
) {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) {
    // Fallback to console when webhook isn't set
    console.log('[notifier] No SLACK_WEBHOOK_URL set; printing message instead.');
    console.log({ title, severity, details });
    return;
  }

  const color =
    severity === 'OK' ? '#2eb67d' :
    severity === 'WARN' ? '#f2c744' :
    '#e01e5a';

  const extra =
    (details.error ? `\n\n*Error:* ${details.error}` : '') +
    (details.screenshot ? `\n\n*Screenshot:* saved in Actions artifacts` : '');

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `${severity} · ${title}` } },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Summary:*\n${details.summary}\n\n*Steps:*\n${formatLog(details.log)}${extra}`,
      },
    },
    {
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `<${details.url.STORE_URL}|Store>` },
        { type: 'mrkdwn', text: `<${details.url.PRODUCT_URL}|Product>` },
      ],
    },
  ];

  await axios.post(webhook, { attachments: [{ color, blocks }] });
}
