import OpenAI from 'openai';

export interface JourneyLog {
  steps: Array<{ name: string; ok: boolean; ms: number; error?: string }>;
  startedAt: string;
  storeUrl: string;
}

export async function diagnose(log: JourneyLog): Promise<string> {
  const failures = log.steps.filter(s => !s.ok);
  const slow = log.steps.filter(s => s.ms > 5000);
  const bullets: string[] = [];

  // ✅ fixed condition
  if (failures.length === 0 && slow.length === 0) {
    return 'All steps healthy. No action needed.';
  }

  if (slow.length) bullets.push(`Slow steps: ${slow.map(s => `${s.name}(${s.ms}ms)`).join(', ')}`);
  if (failures.length) bullets.push(`Failures: ${failures.map(s => `${s.name}: ${s.error}`).join(' | ')}`);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    bullets.push('AI summary unavailable (OPENAI_API_KEY not set).');
    return bullets.join('\n');
  }

  const client = new OpenAI({ apiKey });
  const system = 'You are a Shopify SRE assistant. Write a concise, actionable diagnosis based on the journey log.';
  const user = `Journey log JSON:\n${JSON.stringify(log)}`;
  const res = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: 0.2,
  });

  const ai = res.choices[0]?.message?.content?.trim() || '';
  return [bullets.join('\n'), ai].filter(Boolean).join('\n\n');
}
