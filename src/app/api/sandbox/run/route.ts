// Real Sandbox Testing - /api/sandbox/run
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const { providerId, modelId, testType, apiKey, customBaseUrl, sandboxMode, prompt } = await request.json();

    const provider = await db.provider.findUnique({ where: { id: providerId } });
    if (!provider) return NextResponse.json({ error: 'Provider not found' }, { status: 404 });

    const actualBase = customBaseUrl || provider.customBaseUrl || provider.baseUrl;
    const actualKey = apiKey || provider.apiKey;

    if (!actualKey) return NextResponse.json({ error: 'API key required' }, { status: 400 });

    const test = await db.sandboxTest.create({
      data: {
        providerId, modelId,
        testType: testType || 'chat',
        status: 'running',
        sandboxMode: sandboxMode || false,
        requestJson: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: prompt || 'Say "Gateway test OK" and nothing else.' }],
          max_tokens: 50,
        }),
      },
    });

    const startTime = Date.now();
    let result: { status: string; latencyMs: number; response: string; error?: string; streamChunks?: number };

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (provider.authType === 'bearer') headers['Authorization'] = `Bearer ${actualKey}`;
      else if (provider.authType === 'header') headers[provider.authHeader] = actualKey;

      let endpoint = actualBase.replace(/\/$/, '');
      if (provider.apiFormat === 'openai') endpoint += '/chat/completions';
      else if (provider.apiFormat === 'anthropic') endpoint += '/messages';
      else if (provider.apiFormat === 'google') endpoint += `/models/${modelId}:generateContent`;
      else endpoint += '/chat/completions';
      if (provider.authType === 'query') endpoint += `?key=${actualKey}`;

      const testPrompt = prompt || 'Say "Gateway test OK" and nothing else.';

      if (testType === 'streaming') {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        const response = await fetch(endpoint, {
          method: 'POST', headers,
          body: JSON.stringify({ model: modelId, messages: [{ role: 'user', content: testPrompt }], max_tokens: 100, stream: true }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        const latencyMs = Date.now() - startTime;
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).substring(0, 300)}`);

        const reader = response.body?.getReader();
        let chunks = 0, fullContent = '';
        const decoder = new TextDecoder();
        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value, { stream: true });
            for (const line of text.split('\n')) {
              if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                chunks++;
                try { fullContent += JSON.parse(line.slice(6)).choices?.[0]?.delta?.content || ''; } catch {}
              }
            }
          }
        }
        result = { status: 'passed', latencyMs, response: fullContent || '(stream received)', streamChunks: chunks };
      } else {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const response = await fetch(endpoint, {
          method: 'POST', headers,
          body: JSON.stringify({ model: modelId, messages: [{ role: 'user', content: testPrompt }], max_tokens: 50 }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        const latencyMs = Date.now() - startTime;
        const data = await response.json();
        if (response.ok) {
          result = { status: 'passed', latencyMs, response: data.choices?.[0]?.message?.content || data.content?.[0]?.text || JSON.stringify(data).substring(0, 500) };
        } else {
          result = { status: 'failed', latencyMs, response: JSON.stringify(data).substring(0, 500), error: `HTTP ${response.status}` };
        }
      }
    } catch (err: any) {
      result = { status: 'timeout', latencyMs: Date.now() - startTime, response: '', error: err.message?.substring(0, 300) || 'Unknown error' };
    }

    await db.sandboxTest.update({
      where: { id: test.id },
      data: { status: result.status, latencyMs: result.latencyMs, responseJson: result.response, error: result.error || '' },
    });

    if (result.status === 'passed') {
      await db.provider.update({
        where: { id: providerId },
        data: { lastChecked: new Date(), avgLatency: provider.avgLatency === 0 ? result.latencyMs : Math.round((provider.avgLatency + result.latencyMs) / 2) },
      });
    }

    return NextResponse.json({ testId: test.id, ...result });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const providerId = searchParams.get('providerId');
  const sandboxOnly = searchParams.get('sandbox') === 'true';
  const where: any = {};
  if (providerId) where.providerId = providerId;
  if (sandboxOnly) where.sandboxMode = true;

  const tests = await db.sandboxTest.findMany({
    where,
    include: { provider: { select: { name: true, slug: true } } },
    orderBy: { createdAt: 'desc' }, take: 100,
  });
  return NextResponse.json({ tests });
}